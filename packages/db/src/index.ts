import type { VesselPositionDto, VesselUpdate } from "@norway-ship-tracker/domain";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { vessels } from "@norway-ship-tracker/db/schema";

export interface DatabaseConnection {
  client: ReturnType<typeof postgres>;
  db: ReturnType<typeof drizzle>;
}

export interface VesselBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface VesselQueryRow {
  mmsi: number;
  name: string | null;
  ship_type: number | null;
  latitude: number;
  longitude: number;
  speed_over_ground: number | null;
  course_over_ground: number | null;
  true_heading: number | null;
  source_timestamp: Date | string | null;
  received_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function createDatabase(databaseUrl: string, maxConnections = 5): DatabaseConnection {
  const client = postgres(databaseUrl, {
    max: maxConnections,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  return { client, db: drizzle(client) };
}

export async function closeDatabase(connection: DatabaseConnection): Promise<void> {
  await connection.client.end({ timeout: 5 });
}

export async function persistVesselUpdate(
  connection: DatabaseConnection,
  update: VesselUpdate,
  historySampleSeconds: number,
): Promise<void> {
  const historyCutoff = new Date(update.receivedAt.getTime() - historySampleSeconds * 1_000);
  const receivedAt = update.receivedAt.toISOString();
  const observedAt = update.observedAt.toISOString();

  await connection.db.transaction(async (tx) => {
    await tx
      .insert(vessels)
      .values({
        mmsi: update.mmsi,
        imoNumber: update.imoNumber,
        name: update.name,
        callSign: update.callSign,
        shipType: update.shipType,
        destination: update.destination,
        draughtMeters: update.draughtMeters,
        reportClass: "barentswatch",
        staticUpdatedAt: update.observedAt,
        updatedAt: update.receivedAt,
      })
      .onConflictDoUpdate({
        target: vessels.mmsi,
        set: {
          imoNumber: sql`COALESCE(EXCLUDED.imo_number, ${vessels.imoNumber})`,
          name: sql`COALESCE(EXCLUDED.name, ${vessels.name})`,
          callSign: sql`COALESCE(EXCLUDED.call_sign, ${vessels.callSign})`,
          shipType: sql`COALESCE(EXCLUDED.ship_type, ${vessels.shipType})`,
          destination: sql`COALESCE(EXCLUDED.destination, ${vessels.destination})`,
          draughtMeters: sql`COALESCE(EXCLUDED.draught_meters, ${vessels.draughtMeters})`,
          reportClass: "barentswatch",
          staticUpdatedAt: update.observedAt,
          updatedAt: update.receivedAt,
        },
      });

    await tx.execute(sql`
      INSERT INTO vessel_latest_positions (
        mmsi, received_at, source_timestamp, location, speed_over_ground,
        course_over_ground, true_heading, rate_of_turn, navigational_status,
        source_message_type, provider, raw_payload, persisted_at
      ) VALUES (
        ${update.mmsi}, ${receivedAt}, ${observedAt},
        ST_SetSRID(ST_MakePoint(${update.longitude}, ${update.latitude}), 4326)::geography,
        ${update.speedOverGround}, ${update.courseOverGround}, ${update.trueHeading},
        ${update.rateOfTurn}, ${update.navigationalStatus}, NULL,
        ${update.provider}, ${JSON.stringify(update.rawPayload)}::jsonb, now()
      )
      ON CONFLICT (mmsi) DO UPDATE SET
        received_at = EXCLUDED.received_at,
        source_timestamp = EXCLUDED.source_timestamp,
        location = EXCLUDED.location,
        speed_over_ground = EXCLUDED.speed_over_ground,
        course_over_ground = EXCLUDED.course_over_ground,
        true_heading = EXCLUDED.true_heading,
        rate_of_turn = EXCLUDED.rate_of_turn,
        navigational_status = EXCLUDED.navigational_status,
        source_message_type = EXCLUDED.source_message_type,
        provider = EXCLUDED.provider,
        raw_payload = EXCLUDED.raw_payload,
        persisted_at = now()
      WHERE vessel_latest_positions.source_timestamp IS NULL
         OR vessel_latest_positions.source_timestamp <= EXCLUDED.source_timestamp
    `);

    await tx.execute(sql`
      INSERT INTO vessel_positions (
        mmsi, received_at, source_timestamp, location, speed_over_ground,
        course_over_ground, true_heading, rate_of_turn, navigational_status,
        source_message_type, provider, raw_payload, persisted_at
      )
      SELECT
        ${update.mmsi}, ${receivedAt}, ${observedAt},
        ST_SetSRID(ST_MakePoint(${update.longitude}, ${update.latitude}), 4326)::geography,
        ${update.speedOverGround}, ${update.courseOverGround}, ${update.trueHeading},
        ${update.rateOfTurn}, ${update.navigationalStatus}, NULL,
        ${update.provider}, ${JSON.stringify(update.rawPayload)}::jsonb, now()
      WHERE NOT EXISTS (
        SELECT 1
        FROM vessel_positions
        WHERE mmsi = ${update.mmsi}
          AND received_at >= ${historyCutoff.toISOString()}
      )
      ON CONFLICT DO NOTHING
    `);
  });
}

export async function getLatestVessels(
  connection: DatabaseConnection,
  bounds: VesselBounds,
  limit: number,
): Promise<VesselPositionDto[]> {
  const result = await connection.db.execute(sql`
    SELECT
      latest.mmsi,
      vessel.name,
      vessel.ship_type,
      ST_Y(latest.location::geometry) AS latitude,
      ST_X(latest.location::geometry) AS longitude,
      latest.speed_over_ground,
      latest.course_over_ground,
      latest.true_heading,
      latest.source_timestamp,
      latest.received_at
    FROM vessel_latest_positions AS latest
    JOIN vessels AS vessel USING (mmsi)
    WHERE ST_Intersects(
      latest.location,
      ST_MakeEnvelope(${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326)::geography
    )
    ORDER BY latest.received_at DESC
    LIMIT ${limit}
  `);

  const rows = result as unknown as VesselQueryRow[];
  return rows.map((row) => ({
    mmsi: Number(row.mmsi),
    name: row.name,
    shipType: row.ship_type,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speedOverGround: row.speed_over_ground,
    courseOverGround: row.course_over_ground,
    trueHeading: row.true_heading,
    observedAt: row.source_timestamp ? toIsoString(row.source_timestamp) : null,
    receivedAt: toIsoString(row.received_at),
  }));
}
