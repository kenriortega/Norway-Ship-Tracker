use std::sync::Arc;

use anyhow::Context;
use norway_ship_tracker_backend::{
    api::{self, AppState},
    config::Config,
    telemetry,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    telemetry::init()?;

    let config = Config::from_env()?;
    let listener = tokio::net::TcpListener::bind(config.bind_address)
        .await
        .with_context(|| format!("failed to bind API to {}", config.bind_address))?;

    let source = format!("{}:{}", config.kystverket_host, config.kystverket_port);
    let state = Arc::new(AppState::new(source, config.database_url));
    let app = api::router(state);

    tracing::info!(address = %config.bind_address, "API scaffold listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("API server stopped unexpectedly")?;

    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "failed to install shutdown signal handler");
    }
}
