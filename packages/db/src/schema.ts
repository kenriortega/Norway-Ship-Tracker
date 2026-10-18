import {
  bigint,
  bigserial,
  char,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Point, 4326)";
  },
});

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

export const vessels = pgTable("vessels", {
  mmsi: bigint("mmsi", { mode: "number" }).primaryKey(),
  imoNumber: bigint("imo_number", { mode: "number" }),
  name: text("name"),
  callSign: text("call_sign"),
  shipType: smallint("ship_type"),
  dimensionToBow: integer("dimension_to_bow"),
  dimensionToStern: integer("dimension_to_stern"),
  dimensionToPort: integer("dimension_to_port"),
  dimensionToStarboard: integer("dimension_to_starboard"),
  destination: text("destination"),
  etaRaw: text("eta_raw"),
  draughtMeters: real("draught_meters"),
  reportClass: text("report_class"),
  staticUpdatedAt: timestamp("static_updated_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const vesselLatestPositions = pgTable(
  "vessel_latest_positions",
  {
    mmsi: bigint("mmsi", { mode: "number" })
      .primaryKey()
      .references(() => vessels.mmsi, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull(),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true, mode: "date" }),
    aisSecond: smallint("ais_second"),
    location: geographyPoint("location").notNull(),
    speedOverGround: real("speed_over_ground"),
    courseOverGround: real("course_over_ground"),
    trueHeading: smallint("true_heading"),
    rateOfTurn: real("rate_of_turn"),
    navigationalStatus: smallint("navigational_status"),
    sourceMessageType: smallint("source_message_type"),
    radioChannel: char("radio_channel", { length: 1 }),
    provider: text("provider").notNull().default("barentswatch"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    persistedAt: timestamp("persisted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("vessel_latest_positions_location_gix").using("gist", table.location),
    index("vessel_latest_positions_received_at_idx").on(table.receivedAt),
  ],
);

export const vesselPositions = pgTable(
  "vessel_positions",
  {
    mmsi: bigint("mmsi", { mode: "number" })
      .notNull()
      .references(() => vessels.mmsi, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull(),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true, mode: "date" }),
    aisSecond: smallint("ais_second"),
    location: geographyPoint("location").notNull(),
    speedOverGround: real("speed_over_ground"),
    courseOverGround: real("course_over_ground"),
    trueHeading: smallint("true_heading"),
    rateOfTurn: real("rate_of_turn"),
    navigationalStatus: smallint("navigational_status"),
    sourceMessageType: smallint("source_message_type"),
    radioChannel: char("radio_channel", { length: 1 }),
    messageHash: bytea("message_hash"),
    provider: text("provider").notNull().default("barentswatch"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    persistedAt: timestamp("persisted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.mmsi, table.receivedAt] }),
    index("vessel_positions_location_gix").using("gist", table.location),
    index("vessel_positions_received_at_idx").on(table.receivedAt),
    index("vessel_positions_mmsi_received_at_idx").on(table.mmsi, table.receivedAt),
  ],
);

export const aisDecodeFailures = pgTable("ais_decode_failures", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }).notNull(),
  pipelineStage: text("pipeline_stage").notNull(),
  reason: text("reason").notNull(),
  sentenceSample: text("sentence_sample"),
  occurrenceCount: bigint("occurrence_count", { mode: "number" }).notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
