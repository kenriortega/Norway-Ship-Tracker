BEGIN;

ALTER TABLE vessel_latest_positions
    ALTER COLUMN source_message_type DROP NOT NULL,
    ADD COLUMN provider TEXT NOT NULL DEFAULT 'kystverket_tcp',
    ADD COLUMN raw_payload JSONB;

ALTER TABLE vessel_positions
    ALTER COLUMN source_message_type DROP NOT NULL,
    ADD COLUMN provider TEXT NOT NULL DEFAULT 'kystverket_tcp',
    ADD COLUMN raw_payload JSONB;

CREATE INDEX vessel_positions_mmsi_received_at_idx
    ON vessel_positions (mmsi, received_at DESC);

COMMIT;
