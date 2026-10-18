use std::time::Duration;

use anyhow::{Result, bail};
use chrono::{DateTime, Utc};
use tokio::{
    io::AsyncReadExt,
    net::TcpStream,
    sync::{mpsc, watch},
    time::{sleep, timeout},
};

use super::{Backoff, Endpoint, FrameBatch, LineFramer};

#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub endpoint: Endpoint,
    pub connect_timeout: Duration,
    pub stall_timeout: Duration,
    pub initial_backoff: Duration,
    pub maximum_backoff: Duration,
    pub jitter_percent: u8,
    pub read_buffer_size: usize,
    pub maximum_line_length: usize,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            endpoint: Endpoint::default(),
            connect_timeout: Duration::from_secs(10),
            stall_timeout: Duration::from_secs(60),
            initial_backoff: Duration::from_secs(1),
            maximum_backoff: Duration::from_secs(30),
            jitter_percent: 20,
            read_buffer_size: 16 * 1024,
            maximum_line_length: 4_096,
        }
    }
}

impl ClientConfig {
    fn validate(&self) -> Result<()> {
        if self.endpoint.host.is_empty() {
            bail!("TCP endpoint host cannot be empty");
        }
        if self.read_buffer_size == 0 {
            bail!("TCP read buffer size must be positive");
        }
        if self.maximum_line_length == 0 {
            bail!("maximum NMEA line length must be positive");
        }
        if self.connect_timeout.is_zero() || self.stall_timeout.is_zero() {
            bail!("TCP timeouts must be positive");
        }
        if self.initial_backoff.is_zero() || self.maximum_backoff < self.initial_backoff {
            bail!("invalid reconnect backoff range");
        }
        if self.jitter_percent > 100 {
            bail!("jitter percentage cannot exceed 100");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceivedSentence {
    pub received_at: DateTime<Utc>,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceEvent {
    Connected {
        address: String,
    },
    Disconnected {
        reason: String,
        retry_in: Duration,
    },
    Sentence(ReceivedSentence),
    FramingIssue {
        dropped_oversized: usize,
        invalid_utf8: usize,
    },
}

pub async fn run_source(
    config: ClientConfig,
    sender: mpsc::Sender<SourceEvent>,
    mut shutdown: watch::Receiver<bool>,
) -> Result<()> {
    config.validate()?;
    let mut backoff = Backoff::new(
        config.initial_backoff,
        config.maximum_backoff,
        config.jitter_percent,
    );

    loop {
        if shutdown_requested(&shutdown) {
            return Ok(());
        }

        let address = config.endpoint.address();
        let connection = tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || shutdown_requested(&shutdown) {
                    return Ok(());
                }
                continue;
            }
            result = timeout(config.connect_timeout, TcpStream::connect(&address)) => result,
        };

        let report = match connection {
            Ok(Ok(stream)) => {
                if !send_event(
                    &sender,
                    SourceEvent::Connected {
                        address: address.clone(),
                    },
                    &mut shutdown,
                )
                .await
                {
                    return Ok(());
                }

                match read_connection(stream, &config, &sender, &mut shutdown).await {
                    ConnectionEnd::Stop => return Ok(()),
                    ConnectionEnd::Retry(report) => report,
                }
            }
            Ok(Err(error)) => ConnectionReport {
                reason: format!("connection failed: {error}"),
                received_data: false,
            },
            Err(_) => ConnectionReport {
                reason: format!("connection timed out after {:?}", config.connect_timeout),
                received_data: false,
            },
        };

        if report.received_data {
            backoff.reset();
        }
        let retry_in = backoff.next_delay();
        if !send_event(
            &sender,
            SourceEvent::Disconnected {
                reason: report.reason,
                retry_in,
            },
            &mut shutdown,
        )
        .await
        {
            return Ok(());
        }

        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || shutdown_requested(&shutdown) {
                    return Ok(());
                }
            }
            _ = sleep(retry_in) => {}
        }
    }
}

#[derive(Debug)]
struct ConnectionReport {
    reason: String,
    received_data: bool,
}

enum ConnectionEnd {
    Stop,
    Retry(ConnectionReport),
}

async fn read_connection(
    mut stream: TcpStream,
    config: &ClientConfig,
    sender: &mpsc::Sender<SourceEvent>,
    shutdown: &mut watch::Receiver<bool>,
) -> ConnectionEnd {
    let mut framer = LineFramer::new(config.maximum_line_length);
    let mut buffer = vec![0_u8; config.read_buffer_size];
    let mut received_data = false;

    loop {
        let read = tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || shutdown_requested(shutdown) {
                    return ConnectionEnd::Stop;
                }
                continue;
            }
            result = timeout(config.stall_timeout, stream.read(&mut buffer)) => result,
        };

        match read {
            Ok(Ok(0)) => {
                if !emit_batch(framer.finish(), sender, shutdown).await {
                    return ConnectionEnd::Stop;
                }
                return ConnectionEnd::Retry(ConnectionReport {
                    reason: "remote endpoint closed the connection".to_owned(),
                    received_data,
                });
            }
            Ok(Ok(read)) => {
                received_data = true;
                if !emit_batch(framer.push(&buffer[..read]), sender, shutdown).await {
                    return ConnectionEnd::Stop;
                }
            }
            Ok(Err(error)) => {
                return ConnectionEnd::Retry(ConnectionReport {
                    reason: format!("TCP read failed: {error}"),
                    received_data,
                });
            }
            Err(_) => {
                return ConnectionEnd::Retry(ConnectionReport {
                    reason: format!("stream stalled for {:?}", config.stall_timeout),
                    received_data,
                });
            }
        }
    }
}

async fn emit_batch(
    batch: FrameBatch,
    sender: &mpsc::Sender<SourceEvent>,
    shutdown: &mut watch::Receiver<bool>,
) -> bool {
    if (batch.dropped_oversized > 0 || batch.invalid_utf8 > 0)
        && !send_event(
            sender,
            SourceEvent::FramingIssue {
                dropped_oversized: batch.dropped_oversized,
                invalid_utf8: batch.invalid_utf8,
            },
            shutdown,
        )
        .await
    {
        return false;
    }

    for value in batch.lines {
        if !send_event(
            sender,
            SourceEvent::Sentence(ReceivedSentence {
                received_at: Utc::now(),
                value,
            }),
            shutdown,
        )
        .await
        {
            return false;
        }
    }

    true
}

async fn send_event(
    sender: &mpsc::Sender<SourceEvent>,
    event: SourceEvent,
    shutdown: &mut watch::Receiver<bool>,
) -> bool {
    tokio::select! {
        result = sender.send(event) => result.is_ok(),
        changed = shutdown.changed() => changed.is_ok() && !shutdown_requested(shutdown),
    }
}

fn shutdown_requested(shutdown: &watch::Receiver<bool>) -> bool {
    *shutdown.borrow()
}

#[cfg(test)]
mod tests {
    use tokio::{
        io::AsyncWriteExt,
        net::TcpListener,
        time::{Duration, timeout},
    };

    use super::*;

    const SENTENCE: &str = "!AIVDM,1,1,,A,15Muq?P0000G?t@E>4p@0?vN0<0u,0*49\r\n";

    #[tokio::test]
    async fn reconnects_and_frames_sentences_split_across_reads() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener should bind");
        let address = listener
            .local_addr()
            .expect("listener should have an address");

        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.expect("client should connect");
                let split = SENTENCE.len() / 2;
                stream
                    .write_all(&SENTENCE.as_bytes()[..split])
                    .await
                    .expect("first half should be written");
                stream
                    .write_all(&SENTENCE.as_bytes()[split..])
                    .await
                    .expect("second half should be written");
                stream.shutdown().await.expect("stream should close");
            }
        });

        let config = ClientConfig {
            endpoint: Endpoint {
                host: address.ip().to_string(),
                port: address.port(),
            },
            connect_timeout: Duration::from_secs(1),
            stall_timeout: Duration::from_secs(1),
            initial_backoff: Duration::from_millis(5),
            maximum_backoff: Duration::from_millis(10),
            jitter_percent: 0,
            read_buffer_size: 16,
            maximum_line_length: 256,
        };
        let (event_sender, mut event_receiver) = mpsc::channel(8);
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let client = tokio::spawn(run_source(config, event_sender, shutdown_receiver));

        let mut connections = 0;
        let mut sentences = 0;
        while connections < 2 || sentences < 2 {
            let event = timeout(Duration::from_secs(2), event_receiver.recv())
                .await
                .expect("event should arrive before timeout")
                .expect("event channel should remain open");
            match event {
                SourceEvent::Connected { .. } => connections += 1,
                SourceEvent::Sentence(sentence) => {
                    assert_eq!(sentence.value, SENTENCE.trim_end());
                    sentences += 1;
                }
                _ => {}
            }
        }

        shutdown_sender
            .send(true)
            .expect("shutdown should be delivered");
        timeout(Duration::from_secs(1), client)
            .await
            .expect("client should stop")
            .expect("client task should not panic")
            .expect("client should stop cleanly");
        server.await.expect("server task should not panic");
    }
}
