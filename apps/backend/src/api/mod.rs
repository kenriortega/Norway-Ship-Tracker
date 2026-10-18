use std::sync::Arc;

use axum::{Json, Router, extract::State, routing::get};
use serde::Serialize;

#[derive(Debug)]
pub struct AppState {
    source: String,
    database_url: String,
}

impl AppState {
    pub fn new(source: String, database_url: String) -> Self {
        Self {
            source,
            database_url,
        }
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state(state)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    milestone: &'static str,
    ais_source: String,
    database_configured: bool,
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        milestone: "scaffold",
        ais_source: state.source.clone(),
        database_configured: !state.database_url.is_empty(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_state_retains_source() {
        let state = AppState::new("127.0.0.1:5631".into(), "postgres://local".into());
        assert_eq!(state.source, "127.0.0.1:5631");
    }
}
