//! Models shared by ingestion, persistence and the public API.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VesselPosition {
    pub mmsi: u32,
    pub received_at: DateTime<Utc>,
    pub latitude: f64,
    pub longitude: f64,
    pub speed_over_ground: Option<f32>,
    pub course_over_ground: Option<f32>,
    pub true_heading: Option<u16>,
    pub navigational_status: Option<u8>,
    pub source_message_type: u8,
}
