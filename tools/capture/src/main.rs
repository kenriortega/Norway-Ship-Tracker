mod writer;

use std::{env, path::PathBuf, str::FromStr, time::Duration};

use anyhow::{Context, Result};
use norway_ship_tracker_backend::{
    nmea::parse_sentence,
    tcp::{ClientConfig, Endpoint, SourceEvent, run_source},
};
use tokio::{
    signal,
    sync::{mpsc, watch},
    time::sleep,
};
use writer::RotatingCapture;

#[derive(Debug)]
struct Settings {
    client: ClientConfig,
    channel_capacity: usize,
    capture_directory: PathBuf,
    maximum_file_bytes: u64,
    maximum_files: usize,
    run_seconds: Option<u64>,
}

impl Settings {
    fn from_env() -> Result<Self> {
        let mut client = ClientConfig::default();
        client.endpoint = Endpoint {
            host: env_or("KYSTVERKET_HOST", &client.endpoint.host),
            port: parse_env_or("KYSTVERKET_PORT", client.endpoint.port)?,
        };
        client.connect_timeout = Duration::from_secs(parse_env_or(
            "AIS_CONNECT_TIMEOUT_SECONDS",
            client.connect_timeout.as_secs(),
        )?);
        client.stall_timeout = Duration::from_secs(parse_env_or(
            "AIS_STALL_TIMEOUT_SECONDS",
            client.stall_timeout.as_secs(),
        )?);
        client.initial_backoff = Duration::from_millis(parse_env_or(
            "AIS_INITIAL_BACKOFF_MS",
            client.initial_backoff.as_millis() as u64,
        )?);
        client.maximum_backoff = Duration::from_millis(parse_env_or(
            "AIS_MAX_BACKOFF_MS",
            client.maximum_backoff.as_millis() as u64,
        )?);
        client.jitter_percent = parse_env_or("AIS_JITTER_PERCENT", client.jitter_percent)?;

        Ok(Self {
            client,
            channel_capacity: parse_env_or("AIS_CHANNEL_CAPACITY", 1_024)?,
            capture_directory: PathBuf::from(env_or("CAPTURE_DIRECTORY", "captures")),
            maximum_file_bytes: parse_env_or("CAPTURE_MAX_FILE_BYTES", 64 * 1024 * 1024)?,
            maximum_files: parse_env_or("CAPTURE_MAX_FILES", 24)?,
            run_seconds: parse_optional_env("CAPTURE_RUN_SECONDS")?,
        })
    }
}

#[derive(Debug, Default)]
struct Metrics {
    valid: u64,
    invalid: u64,
    dropped_oversized: u64,
    invalid_utf8: u64,
    connections: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let settings = Settings::from_env()?;
    if settings.channel_capacity == 0 {
        anyhow::bail!("AIS_CHANNEL_CAPACITY must be positive");
    }

    let mut capture = RotatingCapture::new(
        &settings.capture_directory,
        settings.maximum_file_bytes,
        settings.maximum_files,
    )
    .await?;
    let (event_sender, mut event_receiver) = mpsc::channel(settings.channel_capacity);
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let client = tokio::spawn(run_source(settings.client, event_sender, shutdown_receiver));
    let stop = wait_for_stop(settings.run_seconds);
    tokio::pin!(stop);

    let mut metrics = Metrics::default();
    let mut reported_parse_errors = 0_usize;
    println!(
        "capturing validated AIS sentences into {}",
        settings.capture_directory.display()
    );

    loop {
        tokio::select! {
            result = &mut stop => {
                result?;
                break;
            }
            event = event_receiver.recv() => {
                let Some(event) = event else { break };
                handle_event(
                    event,
                    &mut capture,
                    &mut metrics,
                    &mut reported_parse_errors,
                ).await?;
            }
        }
    }

    let _ = shutdown_sender.send(true);
    while let Some(event) = event_receiver.recv().await {
        handle_event(
            event,
            &mut capture,
            &mut metrics,
            &mut reported_parse_errors,
        )
        .await?;
    }
    client
        .await
        .context("AIS source task panicked")?
        .context("AIS source stopped with an error")?;
    capture.flush().await?;

    println!(
        "connections={} valid={} invalid={} dropped_oversized={} invalid_utf8={}",
        metrics.connections,
        metrics.valid,
        metrics.invalid,
        metrics.dropped_oversized,
        metrics.invalid_utf8
    );
    Ok(())
}

async fn handle_event(
    event: SourceEvent,
    capture: &mut RotatingCapture,
    metrics: &mut Metrics,
    reported_parse_errors: &mut usize,
) -> Result<()> {
    match event {
        SourceEvent::Connected { address } => {
            metrics.connections += 1;
            eprintln!("connected to {address}");
        }
        SourceEvent::Disconnected { reason, retry_in } => {
            eprintln!("disconnected: {reason}; retrying in {retry_in:?}");
        }
        SourceEvent::Sentence(sentence) => match parse_sentence(&sentence.value) {
            Ok(_) => {
                capture.write_sentence(&sentence.value).await?;
                metrics.valid += 1;
            }
            Err(error) => {
                metrics.invalid += 1;
                if *reported_parse_errors < 10 {
                    eprintln!("invalid NMEA sentence: {error}");
                    *reported_parse_errors += 1;
                }
            }
        },
        SourceEvent::FramingIssue {
            dropped_oversized,
            invalid_utf8,
        } => {
            metrics.dropped_oversized += dropped_oversized as u64;
            metrics.invalid_utf8 += invalid_utf8 as u64;
        }
    }
    Ok(())
}

async fn wait_for_stop(run_seconds: Option<u64>) -> Result<()> {
    if let Some(seconds) = run_seconds {
        tokio::select! {
            result = signal::ctrl_c() => result.context("failed to listen for Ctrl+C")?,
            _ = sleep(Duration::from_secs(seconds)) => {}
        }
    } else {
        signal::ctrl_c()
            .await
            .context("failed to listen for Ctrl+C")?;
    }
    Ok(())
}

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_owned())
}

fn parse_env_or<T>(key: &str, default: T) -> Result<T>
where
    T: FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match env::var(key) {
        Ok(value) => value
            .parse()
            .with_context(|| format!("{key} has invalid value '{value}'")),
        Err(env::VarError::NotPresent) => Ok(default),
        Err(error) => Err(error).with_context(|| format!("failed to read {key}")),
    }
}

fn parse_optional_env<T>(key: &str) -> Result<Option<T>>
where
    T: FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match env::var(key) {
        Ok(value) => value
            .parse()
            .map(Some)
            .with_context(|| format!("{key} has invalid value '{value}'")),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(error).with_context(|| format!("failed to read {key}")),
    }
}
