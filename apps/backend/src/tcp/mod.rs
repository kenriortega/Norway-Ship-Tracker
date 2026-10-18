//! Connection lifecycle and byte transport for the Kystverket stream.
//!
//! This module must not decode AIS or write directly to PostgreSQL.

mod backoff;
mod client;
mod line_framer;

pub use backoff::Backoff;
pub use client::{ClientConfig, ReceivedSentence, SourceEvent, run_source};
pub use line_framer::{FrameBatch, LineFramer};

pub const KYSTVERKET_HOST: &str = "153.44.253.27";
pub const KYSTVERKET_PORT: u16 = 5631;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
}

impl Endpoint {
    pub fn address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

impl Default for Endpoint {
    fn default() -> Self {
        Self {
            host: KYSTVERKET_HOST.to_owned(),
            port: KYSTVERKET_PORT,
        }
    }
}
