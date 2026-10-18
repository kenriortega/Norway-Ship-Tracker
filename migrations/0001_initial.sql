BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE vessels (
    mmsi BIGINT PRIMARY KEY CHECK (mmsi BETWEEN 100000000 AND 999999999),
    imo_number BIGINT,
    name TEXT,
    call_sign TEXT,
    ship_type SMALLINT,
    dimension_to_bow INTEGER,
    dimension_to_stern INTEGER,
    dimension_to_port INTEGER,
    dimension_to_starboard INTEGER,
    destination TEXT,
    eta_raw TEXT,
    draught_meters DOUBLE PRECISION,
    report_class TEXT,
    static_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vessel_latest_positions (
    mmsi BIGINT PRIMARY KEY REFERENCES vessels (mmsi) ON DELETE CASCADE,
    received_at TIMESTAMPTZ NOT NULL,
    source_timestamp TIMESTAMPTZ,
    ais_second SMALLINT,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    speed_over_ground REAL,
    course_over_ground REAL,
    true_heading SMALLINT,
    rate_of_turn REAL,
    navigational_status SMALLINT,
    source_message_type SMALLINT NOT NULL,
    radio_channel CHAR(1),
    persisted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX vessel_latest_positions_location_gix
    ON vessel_latest_positions USING GIST (location);

CREATE INDEX vessel_latest_positions_received_at_idx
    ON vessel_latest_positions (received_at DESC);

CREATE TABLE vessel_positions (
    mmsi BIGINT NOT NULL REFERENCES vessels (mmsi) ON DELETE CASCADE,
    received_at TIMESTAMPTZ NOT NULL,
    source_timestamp TIMESTAMPTZ,
    ais_second SMALLINT,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    speed_over_ground REAL,
    course_over_ground REAL,
    true_heading SMALLINT,
    rate_of_turn REAL,
    navigational_status SMALLINT,
    source_message_type SMALLINT NOT NULL,
    message_hash BYTEA,
    persisted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (mmsi, received_at)
);

CREATE INDEX vessel_positions_location_gix
    ON vessel_positions USING GIST (location);

CREATE INDEX vessel_positions_received_at_idx
    ON vessel_positions (received_at DESC);

CREATE TABLE ais_decode_failures (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL,
    pipeline_stage TEXT NOT NULL,
    reason TEXT NOT NULL,
    sentence_sample TEXT,
    occurrence_count BIGINT NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;

