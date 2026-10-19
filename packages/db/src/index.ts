import type {
  ActivitySample,
  CoverageCounts,
  EncountersResponse,
  FreshnessBuckets,
  PortClustersResponse,
  TrafficCell,
  VesselBreakdownRow,
  VesselPositionDto,
  VesselStatsResponse,
  VesselUpdate,
} from "@norway-ship-tracker/domain";
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

interface BreakdownQueryRow {
  ship_type: number | null;
  navigational_status: number | null;
  vessels: string | number;
  moving: string | number;
  average_speed: string | number | null;
}

interface ActivityQueryRow {
  minute: Date | string;
  positions: string | number;
}

interface TrafficQueryRow {
  longitude: string | number;
  latitude: string | number;
  vessels: string | number;
}

interface FreshnessQueryRow {
  under_five_minutes: string | number;
  under_one_hour: string | number;
  under_six_hours: string | number;
  older: string | number;
  terrestrial: string | number;
  satellite: string | number;
}

/** `postgres` devuelve los enteros grandes como texto para no perder precisión. */
function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function toNullableNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Agregados para el panel de métricas. Las cuatro consultas son independientes
 * y se lanzan a la vez: en serie suman unos 315 ms y en paralelo las domina la
 * más lenta.
 *
 * La ventana de actividad es de una hora fija, así que su coste no crece con
 * la antigüedad de la tabla, y cuenta posiciones en lugar de barcos distintos
 * porque el `count(DISTINCT mmsi)` cuadruplica el tiempo sin decir más sobre
 * el pulso del pipeline.
 */
export async function getVesselStats(
  connection: DatabaseConnection,
): Promise<Omit<VesselStatsResponse, "generatedAt">> {
  const [breakdownResult, activityResult, trafficResult, freshnessResult] = await Promise.all([
    connection.db.execute(sql`
      SELECT
        vessel.ship_type,
        latest.navigational_status,
        count(*) AS vessels,
        count(*) FILTER (WHERE latest.speed_over_ground > 0.5) AS moving,
        avg(latest.speed_over_ground) FILTER (WHERE latest.speed_over_ground > 0.5) AS average_speed
      FROM vessel_latest_positions AS latest
      JOIN vessels AS vessel USING (mmsi)
      GROUP BY vessel.ship_type, latest.navigational_status
    `),
    connection.db.execute(sql`
      SELECT
        date_trunc('minute', received_at) AS minute,
        count(*) AS positions
      FROM vessel_positions
      WHERE received_at > now() - interval '1 hour'
        -- El minuto en curso está a medio llenar y dibujaría una caída que no
        -- ha ocurrido, así que la serie termina en el último minuto cerrado.
        AND received_at < date_trunc('minute', now())
      GROUP BY 1
      ORDER BY 1
    `),
    connection.db.execute(sql`
      SELECT
        ST_X(ST_SnapToGrid(location::geometry, 0.5)) AS longitude,
        ST_Y(ST_SnapToGrid(location::geometry, 0.5)) AS latitude,
        count(*) AS vessels
      FROM vessel_latest_positions
      GROUP BY 1, 2
      ORDER BY vessels DESC
      LIMIT 8
    `),
    connection.db.execute(sql`
      SELECT
        count(*) FILTER (WHERE age < interval '5 minutes') AS under_five_minutes,
        count(*) FILTER (WHERE age >= interval '5 minutes' AND age < interval '1 hour') AS under_one_hour,
        count(*) FILTER (WHERE age >= interval '1 hour' AND age < interval '6 hours') AS under_six_hours,
        count(*) FILTER (WHERE age >= interval '6 hours' OR age IS NULL) AS older,
        count(*) FILTER (WHERE stream = 'terra') AS terrestrial,
        count(*) FILTER (WHERE stream IS DISTINCT FROM 'terra') AS satellite
      FROM (
        SELECT
          now() - source_timestamp AS age,
          raw_payload->>'stream' AS stream
        FROM vessel_latest_positions
      ) AS positions
    `),
  ]);

  const breakdownRows = breakdownResult as unknown as BreakdownQueryRow[];
  const activityRows = activityResult as unknown as ActivityQueryRow[];
  const trafficRows = trafficResult as unknown as TrafficQueryRow[];
  const [freshnessRow] = freshnessResult as unknown as FreshnessQueryRow[];

  const breakdown: VesselBreakdownRow[] = breakdownRows.map((row) => ({
    shipType: row.ship_type,
    navigationalStatus: row.navigational_status,
    vessels: toNumber(row.vessels),
    moving: toNumber(row.moving),
    averageSpeed: toNullableNumber(row.average_speed),
  }));

  const activity: ActivitySample[] = activityRows.map((row) => ({
    minute: toIsoString(row.minute),
    positions: toNumber(row.positions),
  }));

  const traffic: TrafficCell[] = trafficRows.map((row) => ({
    longitude: toNumber(row.longitude),
    latitude: toNumber(row.latitude),
    vessels: toNumber(row.vessels),
  }));

  const freshness: FreshnessBuckets = {
    underFiveMinutes: toNumber(freshnessRow?.under_five_minutes ?? 0),
    underOneHour: toNumber(freshnessRow?.under_one_hour ?? 0),
    underSixHours: toNumber(freshnessRow?.under_six_hours ?? 0),
    older: toNumber(freshnessRow?.older ?? 0),
  };

  const coverage: CoverageCounts = {
    terrestrial: toNumber(freshnessRow?.terrestrial ?? 0),
    satellite: toNumber(freshnessRow?.satellite ?? 0),
  };

  const totalVessels = breakdown.reduce((sum, row) => sum + row.vessels, 0);
  const movingVessels = breakdown.reduce((sum, row) => sum + row.moving, 0);

  return { totalVessels, movingVessels, breakdown, activity, traffic, freshness, coverage };
}

interface PortClusterQueryRow {
  cluster_id: string | number;
  latitude: string | number;
  longitude: string | number;
  radius_meters: string | number | null;
  moored_vessels: string | number;
  recent_arrivals: string | number;
  ship_types: (number | null)[] | null;
}

export interface PortClusterOptions {
  /** Distancia máxima entre barcos del mismo fondeadero, en metros. */
  epsMeters: number;
  /** Barcos mínimos para considerar que hay fondeadero y no un atraque suelto. */
  minVessels: number;
  /** Ventana hacia atrás para contar escalas recientes. */
  windowHours: number;
}

/**
 * Descubre fondeaderos agrupando los barcos amarrados por cercanía. El
 * clustering trabaja sobre ETRS89 / UTM 33N y no sobre grados: en Noruega un
 * grado de longitud vale un tercio que uno de latitud, así que agrupar en
 * grados deformaría los fondeaderos del norte hasta partirlos.
 */
export async function getPortClusters(
  connection: DatabaseConnection,
  options: PortClusterOptions,
): Promise<Omit<PortClustersResponse, "generatedAt">> {
  const result = await connection.db.execute(sql`
    WITH moored AS (
      SELECT latest.mmsi, vessel.ship_type,
             ST_Transform(latest.location::geometry, 25833) AS geom
      FROM vessel_latest_positions AS latest
      JOIN vessels AS vessel USING (mmsi)
      WHERE latest.navigational_status = 5
    ),
    clustered AS (
      SELECT mmsi, ship_type, geom,
             ST_ClusterDBSCAN(geom, eps := ${options.epsMeters}, minpoints := ${options.minVessels})
               OVER () AS cluster_id
      FROM moored
    ),
    -- Un amarrado que en la ventana estuvo navegando es un barco que acaba de
    -- llegar; el que nunca se movió llevaba ahí desde antes y no es una escala.
    arrived AS (
      SELECT DISTINCT mmsi
      FROM vessel_positions
      WHERE received_at > now() - make_interval(hours => ${options.windowHours})
        AND speed_over_ground > 3
    )
    SELECT
      clustered.cluster_id,
      count(*) AS moored_vessels,
      count(*) FILTER (WHERE arrived.mmsi IS NOT NULL) AS recent_arrivals,
      ST_Y(ST_Transform(ST_Centroid(ST_Collect(clustered.geom)), 4326)) AS latitude,
      ST_X(ST_Transform(ST_Centroid(ST_Collect(clustered.geom)), 4326)) AS longitude,
      ST_MaxDistance(ST_Collect(clustered.geom), ST_Centroid(ST_Collect(clustered.geom))) AS radius_meters,
      array_agg(DISTINCT clustered.ship_type) FILTER (WHERE clustered.ship_type IS NOT NULL) AS ship_types
    FROM clustered
    LEFT JOIN arrived USING (mmsi)
    WHERE clustered.cluster_id IS NOT NULL
    GROUP BY clustered.cluster_id
    ORDER BY moored_vessels DESC
  `);

  const rows = result as unknown as PortClusterQueryRow[];
  const ports = rows.map((row) => ({
    id: toNumber(row.cluster_id),
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    radiusMeters: Math.round(toNumber(row.radius_meters ?? 0)),
    mooredVessels: toNumber(row.moored_vessels),
    recentArrivals: toNumber(row.recent_arrivals),
    shipTypes: (row.ship_types ?? []).filter((type): type is number => type !== null),
  }));

  return { ports, count: ports.length, windowHours: options.windowHours };
}

interface EncounterQueryRow {
  mmsi_a: string | number;
  name_a: string | null;
  mmsi_b: string | number;
  name_b: string | null;
  latitude: string | number;
  longitude: string | number;
  meters: string | number;
  still_minutes: string | number;
}

export interface EncounterOptions {
  /** Separación máxima entre los dos cascos, en metros. */
  maxMeters: number;
  /** Ventana hacia atrás para exigir que ambos llegasen navegando. */
  windowHours: number;
  /** Duración mínima del encuentro; por debajo es un cruce, no una cita. */
  minMinutes: number;
}

/**
 * Encuentra parejas de barcos detenidas juntas lejos de puerto.
 *
 * Dos filtros hacen todo el trabajo de separar la señal del ruido. El primero
 * descarta lo que caiga dentro de un fondeadero conocido, porque en un muelle
 * los barcos hermanos aparecen pegados sin que signifique nada. El segundo
 * exige que ambos hayan estado navegando en la ventana: un barco amarrado
 * desde siempre no se ha encontrado con nadie, simplemente vive ahí.
 *
 * El `JOIN` va contra la tabla base y no contra un CTE a propósito: un CTE se
 * materializa y pierde el índice GiST, lo que llevaba la consulta de 0,2 s a
 * más de un minuto.
 */
export async function getEncounters(
  connection: DatabaseConnection,
  options: EncounterOptions,
): Promise<Omit<EncountersResponse, "generatedAt">> {
  const result = await connection.db.execute(sql`
    WITH pairs AS (
      SELECT
        a.mmsi AS mmsi_a,
        b.mmsi AS mmsi_b,
        ST_Distance(a.location, b.location) AS meters,
        ST_Y(a.location::geometry) AS latitude,
        ST_X(a.location::geometry) AS longitude,
        ST_Transform(a.location::geometry, 25833) AS geom
      FROM vessel_latest_positions AS a
      JOIN vessel_latest_positions AS b
        ON b.mmsi > a.mmsi
       AND ST_DWithin(a.location, b.location, ${options.maxMeters})
      WHERE coalesce(a.speed_over_ground, 0) < 1
        AND a.navigational_status IS DISTINCT FROM 5
        AND coalesce(b.speed_over_ground, 0) < 1
        AND b.navigational_status IS DISTINCT FROM 5
    ),
    moored AS (
      SELECT ST_Transform(location::geometry, 25833) AS geom
      FROM vessel_latest_positions
      WHERE navigational_status = 5
    ),
    clustered AS (
      SELECT geom, ST_ClusterDBSCAN(geom, eps := 1500, minpoints := 4) OVER () AS cluster_id
      FROM moored
    ),
    harbours AS (
      SELECT
        ST_Centroid(ST_Collect(geom)) AS centre,
        ST_MaxDistance(ST_Collect(geom), ST_Centroid(ST_Collect(geom))) AS radius
      FROM clustered
      WHERE cluster_id IS NOT NULL
      GROUP BY cluster_id
    ),
    under_way AS (
      SELECT mmsi, max(received_at) AS last_moving
      FROM vessel_positions
      WHERE received_at > now() - make_interval(hours => ${options.windowHours})
        AND speed_over_ground > 3
      GROUP BY mmsi
    )
    SELECT
      pairs.mmsi_a,
      vessel_a.name AS name_a,
      pairs.mmsi_b,
      vessel_b.name AS name_b,
      pairs.latitude,
      pairs.longitude,
      pairs.meters,
      extract(epoch FROM (now() - greatest(moving_a.last_moving, moving_b.last_moving))) / 60
        AS still_minutes
    FROM pairs
    JOIN under_way AS moving_a ON moving_a.mmsi = pairs.mmsi_a
    JOIN under_way AS moving_b ON moving_b.mmsi = pairs.mmsi_b
    JOIN vessels AS vessel_a ON vessel_a.mmsi = pairs.mmsi_a
    JOIN vessels AS vessel_b ON vessel_b.mmsi = pairs.mmsi_b
    WHERE NOT EXISTS (
      SELECT 1 FROM harbours
      WHERE ST_DWithin(pairs.geom, harbours.centre, harbours.radius + 1000)
    )
      AND now() - greatest(moving_a.last_moving, moving_b.last_moving)
          > make_interval(mins => ${options.minMinutes})
    ORDER BY still_minutes DESC
  `);

  const rows = result as unknown as EncounterQueryRow[];
  const encounters = rows.map((row) => ({
    mmsiA: toNumber(row.mmsi_a),
    nameA: row.name_a,
    mmsiB: toNumber(row.mmsi_b),
    nameB: row.name_b,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    meters: Math.round(toNumber(row.meters)),
    stillMinutes: Math.round(toNumber(row.still_minutes)),
  }));

  return { encounters, count: encounters.length, windowHours: options.windowHours };
}
