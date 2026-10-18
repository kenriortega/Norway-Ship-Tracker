use std::{env, net::SocketAddr};

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_address: SocketAddr,
    pub database_url: String,
    pub kystverket_host: String,
    pub kystverket_port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let bind_address = env_or("BIND_ADDRESS", "0.0.0.0:8080")
            .parse()
            .context("BIND_ADDRESS must be a valid socket address")?;
        let kystverket_port = env_or("KYSTVERKET_PORT", "5631")
            .parse()
            .context("KYSTVERKET_PORT must be a valid TCP port")?;

        Ok(Self {
            bind_address,
            database_url: env_or(
                "DATABASE_URL",
                "postgres://ship_tracker:ship_tracker@localhost:5432/ship_tracker",
            ),
            kystverket_host: env_or("KYSTVERKET_HOST", "153.44.253.27"),
            kystverket_port,
        })
    }
}

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_owned())
}
