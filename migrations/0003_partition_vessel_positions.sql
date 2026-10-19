BEGIN;

-- Retención del histórico de posiciones.
--
-- `vessel_positions` recibe unas 121.000 filas por hora (~2,9 M al día) y no
-- tenía ninguna política: solo crecía. Esta migración la convierte en una
-- tabla particionada por rango diario sobre `received_at`, de modo que retirar
-- un día caducado sea un `DROP TABLE` instantáneo en lugar de un `DELETE` de
-- millones de filas que dejaría la tabla llena de tuplas muertas y nunca
-- devolvería el disco sin un `VACUUM FULL` bloqueante.
--
-- De paso se recorta lo que no se lee nunca:
--
--   * `raw_payload` se escribía en cada fila del histórico (342 B de media,
--     casi la mitad del tamaño) y no la consulta ningún endpoint; la copia que
--     sí se lee vive en `vessel_latest_positions`.
--   * `vessel_positions_location_gix` acumulaba 0 escaneos: ninguna consulta
--     del histórico filtra por geometría, solo por `received_at` y `mmsi`.
--   * `vessel_positions_mmsi_received_at_idx` es redundante con la clave
--     primaria `(mmsi, received_at)`, que tiene el mismo prefijo y sirve igual
--     al filtro de deduplicado.
--
-- Una tabla normal no se puede convertir en particionada in situ, así que se
-- reconstruye y se copian los datos. Todo ocurre dentro de la transacción que
-- abre el runner de migraciones: si algo falla, la tabla original queda
-- intacta. Con medio millón de filas el copiado son segundos, pero toma un
-- lock exclusivo, así que conviene aplicarla con el worker parado. A partir de
-- unos 20 M de filas este enfoque dejaría de ser aceptable y habría que pasar
-- la tabla antigua con `ATTACH PARTITION` en vez de copiarla.

ALTER TABLE vessel_positions RENAME TO vessel_positions_legacy;

ALTER INDEX vessel_positions_pkey RENAME TO vessel_positions_legacy_pkey;
ALTER INDEX vessel_positions_location_gix RENAME TO vessel_positions_legacy_location_gix;
ALTER INDEX vessel_positions_received_at_idx RENAME TO vessel_positions_legacy_received_at_idx;
ALTER INDEX vessel_positions_mmsi_received_at_idx RENAME TO vessel_positions_legacy_mmsi_idx;

-- Liberar también el nombre de la clave ajena: si sigue ocupado, la tabla
-- nueva hereda un `..._fkey1` que no dice nada.
ALTER TABLE vessel_positions_legacy
    RENAME CONSTRAINT vessel_positions_mmsi_fkey TO vessel_positions_legacy_mmsi_fkey;

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
    source_message_type SMALLINT,
    message_hash BYTEA,
    provider TEXT NOT NULL DEFAULT 'barentswatch',
    persisted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- La columna de particionado tiene que formar parte de la clave primaria;
    -- la que ya había cumple ese requisito sin cambios.
    PRIMARY KEY (mmsi, received_at)
) PARTITION BY RANGE (received_at);

-- Declarado en la tabla padre: Postgres lo propaga a cada partición, también a
-- las que cree después la tarea de mantenimiento.
CREATE INDEX vessel_positions_received_at_idx
    ON vessel_positions (received_at DESC);

/*
 * Aplica la política de retención: crea las particiones que faltan y retira
 * las que han caducado.
 *
 * Conserva el día en curso más `retention_days` anteriores, de forma que
 * siempre haya al menos `retention_days * 24` horas de histórico disponible
 * sea cual sea la hora del día. Aprovisiona `ahead_days` días por delante y no
 * solo el siguiente: así una parada larga del worker no deja al sistema sin
 * partición donde insertar en cuanto cambie la fecha.
 *
 * Es idempotente y se puede llamar tan a menudo como se quiera.
 */
CREATE OR REPLACE FUNCTION maintain_vessel_positions_partitions(
    retention_days INTEGER,
    ahead_days INTEGER
)
RETURNS TABLE (created TEXT[], dropped TEXT[])
LANGUAGE plpgsql
AS $function$
DECLARE
    today DATE;
    cutoff DATE;
    day DATE;
    partition_name TEXT;
    partition_day DATE;
    created_names TEXT[] := ARRAY[]::TEXT[];
    dropped_names TEXT[] := ARRAY[]::TEXT[];
BEGIN
    IF retention_days < 1 THEN
        RAISE EXCEPTION 'retention_days must be at least 1, got %', retention_days;
    END IF;
    IF ahead_days < 1 THEN
        RAISE EXCEPTION 'ahead_days must be at least 1, got %', ahead_days;
    END IF;

    -- Las particiones se cortan por días UTC, igual que los `received_at` que
    -- guardamos; usar la zona horaria del servidor movería las fronteras según
    -- dónde corra Postgres.
    today := (now() AT TIME ZONE 'UTC')::DATE;
    cutoff := today - retention_days;

    FOR day IN SELECT generate_series(cutoff, today + ahead_days, INTERVAL '1 day')::DATE
    LOOP
        partition_name := 'vessel_positions_' || to_char(day, 'YYYYMMDD');

        IF to_regclass(format('public.%I', partition_name)) IS NULL THEN
            EXECUTE format(
                'CREATE TABLE %I PARTITION OF vessel_positions FOR VALUES FROM (%L) TO (%L)',
                partition_name,
                -- Las fronteras se fijan como instantes UTC explícitos: un
                -- `date::timestamptz` las interpretaría en la zona horaria de
                -- la sesión y movería el corte según quién ejecute esto.
                day::TIMESTAMP AT TIME ZONE 'UTC',
                (day + 1)::TIMESTAMP AT TIME ZONE 'UTC'
            );
            created_names := created_names || partition_name;
        END IF;
    END LOOP;

    FOR partition_name IN
        SELECT child.relname
        FROM pg_inherits
        JOIN pg_class AS child ON child.oid = pg_inherits.inhrelid
        WHERE pg_inherits.inhparent = 'public.vessel_positions'::REGCLASS
          AND child.relname ~ '^vessel_positions_\d{8}$'
    LOOP
        partition_day := to_date(right(partition_name, 8), 'YYYYMMDD');

        -- La partición del día `cutoff` todavía entra en la ventana: cubre
        -- [cutoff, cutoff + 1) y solo se retira cuando queda entera por detrás.
        IF partition_day < cutoff THEN
            EXECUTE format('DROP TABLE %I', partition_name);
            dropped_names := dropped_names || partition_name;
        END IF;
    END LOOP;

    RETURN QUERY SELECT created_names, dropped_names;
END;
$function$;

-- Particiones que cubren lo que ya había guardado, para que la copia tenga
-- dónde caer aunque el histórico actual sea más ancho que la retención.
DO $migrate$
DECLARE
    day DATE;
    partition_name TEXT;
    first_day DATE;
    last_day DATE;
BEGIN
    SELECT min(received_at AT TIME ZONE 'UTC')::DATE,
           max(received_at AT TIME ZONE 'UTC')::DATE
      INTO first_day, last_day
      FROM vessel_positions_legacy;

    IF first_day IS NULL THEN
        RETURN;
    END IF;

    FOR day IN SELECT generate_series(first_day, last_day, INTERVAL '1 day')::DATE
    LOOP
        partition_name := 'vessel_positions_' || to_char(day, 'YYYYMMDD');

        IF to_regclass(format('public.%I', partition_name)) IS NULL THEN
            EXECUTE format(
                'CREATE TABLE %I PARTITION OF vessel_positions FOR VALUES FROM (%L) TO (%L)',
                partition_name,
                day::TIMESTAMP AT TIME ZONE 'UTC',
                (day + 1)::TIMESTAMP AT TIME ZONE 'UTC'
            );
        END IF;
    END LOOP;
END;
$migrate$;

INSERT INTO vessel_positions (
    mmsi, received_at, source_timestamp, ais_second, location,
    speed_over_ground, course_over_ground, true_heading, rate_of_turn,
    navigational_status, source_message_type, message_hash, provider, persisted_at
)
SELECT
    mmsi, received_at, source_timestamp, ais_second, location,
    speed_over_ground, course_over_ground, true_heading, rate_of_turn,
    navigational_status, source_message_type, message_hash, provider, persisted_at
FROM vessel_positions_legacy;

DROP TABLE vessel_positions_legacy;

-- Deja el estado consistente con la política desde el primer momento, en lugar
-- de esperar a que el worker arranque: crea los días futuros y retira lo que
-- ya cayó fuera de la ventana.
SELECT maintain_vessel_positions_partitions(3, 2);

COMMIT;
