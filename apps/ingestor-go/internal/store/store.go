// Package store escribe en PostgreSQL/PostGIS. Es el equivalente de la mitad
// de escritura de `packages/db`; la mitad de lectura la sigue sirviendo la web
// desde TypeScript y no tiene reflejo aquí.
//
// Las sentencias son las mismas que ejecuta el ingestor de TypeScript, letra
// por letra en lo que toca a condiciones y conflictos. Eso es deliberado: el
// objetivo del port es que las filas resultantes sean indistinguibles, y
// cualquier "mejora" del SQL en esta fase haría imposible atribuir una
// diferencia al port o al cambio.
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/domain"
)

// reportClass marca de qué proveedor salió la ficha estática del barco.
const reportClass = "barentswatch"

// Store es el pool de conexiones contra la base.
type Store struct {
	pool *pgxpool.Pool
}

// Open abre el pool. maxConnections replica el 5 del ingestor de TypeScript:
// las escrituras van en serie, así que el pool no está para paralelizar sino
// para sobrevivir a que una conexión se caiga sin esperar a reconectar.
func Open(ctx context.Context, databaseURL string, maxConnections int32) (*Store, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("store: la cadena de conexión no es válida: %w", err)
	}
	if maxConnections > 0 {
		config.MaxConns = maxConnections
	}
	config.MaxConnIdleTime = 20 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("store: no se pudo crear el pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: la base no responde: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close cierra el pool y espera a que terminen las conexiones en uso.
func (s *Store) Close() {
	s.pool.Close()
}

const upsertVesselSQL = `
INSERT INTO vessels (
    mmsi, imo_number, name, call_sign, ship_type, destination,
    draught_meters, report_class, static_updated_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (mmsi) DO UPDATE SET
    imo_number = COALESCE(EXCLUDED.imo_number, vessels.imo_number),
    name = COALESCE(EXCLUDED.name, vessels.name),
    call_sign = COALESCE(EXCLUDED.call_sign, vessels.call_sign),
    ship_type = COALESCE(EXCLUDED.ship_type, vessels.ship_type),
    destination = COALESCE(EXCLUDED.destination, vessels.destination),
    draught_meters = COALESCE(EXCLUDED.draught_meters, vessels.draught_meters),
    report_class = EXCLUDED.report_class,
    static_updated_at = EXCLUDED.static_updated_at,
    updated_at = EXCLUDED.updated_at`

// Los COALESCE no son adorno: los mensajes de posición traen la ficha estática
// a medias, y sin ellos cada posición sin nombre borraría el nombre que ya
// conocíamos del barco.

const upsertLatestPositionSQL = `
INSERT INTO vessel_latest_positions (
    mmsi, received_at, source_timestamp, location, speed_over_ground,
    course_over_ground, true_heading, rate_of_turn, navigational_status,
    source_message_type, provider, raw_payload, persisted_at
) VALUES (
    $1::bigint, $2::timestamptz, $3::timestamptz,
    ST_SetSRID(ST_MakePoint($4::double precision, $5::double precision), 4326)::geography,
    $6::real, $7::real, $8::smallint, $9::real, $10::smallint,
    NULL, $11::text, $12::jsonb, now()
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
   OR vessel_latest_positions.source_timestamp <= EXCLUDED.source_timestamp`

// El WHERE del DO UPDATE es lo que impide que una posición vieja pise a una
// nueva. El proveedor no garantiza orden, y sin esta guarda un mensaje
// retrasado haría retroceder al barco en el mapa.

const insertHistorySQL = `
INSERT INTO vessel_positions (
    mmsi, received_at, source_timestamp, location, speed_over_ground,
    course_over_ground, true_heading, rate_of_turn, navigational_status,
    source_message_type, provider, persisted_at
)
SELECT
    $1::bigint, $2::timestamptz, $3::timestamptz,
    ST_SetSRID(ST_MakePoint($4::double precision, $5::double precision), 4326)::geography,
    $6::real, $7::real, $8::smallint, $9::real, $10::smallint,
    NULL, $11::text, now()
WHERE NOT EXISTS (
    SELECT 1
    FROM vessel_positions
    WHERE mmsi = $1::bigint
      AND received_at >= $12::timestamptz
)
ON CONFLICT DO NOTHING`

// Los casts no son decorativos. En un `INSERT ... SELECT` los parámetros
// viven en la lista del SELECT, donde Postgres no tiene columna destino de la
// que deducir su tipo, y `ST_MakePoint` está sobrecargada. Sin decir el tipo,
// la resolución queda en manos de la inferencia y falla de formas poco obvias.
//
// El histórico no guarda `raw_payload`: nadie lo lee de aquí y pesaba casi la
// mitad de cada fila. El payload crudo sigue disponible en
// `vessel_latest_positions` para la posición vigente de cada barco.
//
// El NOT EXISTS es el muestreo: una posición por barco y ventana. Depende de
// que las escrituras vayan en serie, porque dos transacciones concurrentes
// pueden pasar la comprobación a la vez y meter dos filas de la misma ventana.
// Si algún día hace falta paralelizar, esto necesita una guarda real y no un
// pool de escritores.

// PersistVesselUpdate escribe la posición en las tres tablas, en una sola
// transacción: la ficha del barco, su última posición conocida y la muestra
// del histórico.
func (s *Store) PersistVesselUpdate(ctx context.Context, update *domain.VesselUpdate, historySampleSeconds int) error {
	historyCutoff := update.ReceivedAt.Add(-time.Duration(historySampleSeconds) * time.Second)

	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, upsertVesselSQL,
			update.MMSI,
			update.IMONumber,
			update.Name,
			update.CallSign,
			update.ShipType,
			update.Destination,
			update.DraughtMeters,
			reportClass,
			update.ObservedAt,
			update.ReceivedAt,
		); err != nil {
			return fmt.Errorf("store: no se pudo guardar la ficha del barco: %w", err)
		}

		if _, err := tx.Exec(ctx, upsertLatestPositionSQL,
			update.MMSI,
			update.ReceivedAt,
			update.ObservedAt,
			update.Longitude,
			update.Latitude,
			update.SpeedOverGround,
			update.CourseOverGround,
			update.TrueHeading,
			update.RateOfTurn,
			update.NavigationalStatus,
			update.Provider,
			string(update.RawPayload),
		); err != nil {
			return fmt.Errorf("store: no se pudo guardar la última posición: %w", err)
		}

		if _, err := tx.Exec(ctx, insertHistorySQL,
			update.MMSI,
			update.ReceivedAt,
			update.ObservedAt,
			update.Longitude,
			update.Latitude,
			update.SpeedOverGround,
			update.CourseOverGround,
			update.TrueHeading,
			update.RateOfTurn,
			update.NavigationalStatus,
			update.Provider,
			historyCutoff,
		); err != nil {
			return fmt.Errorf("store: no se pudo guardar la muestra del histórico: %w", err)
		}

		return nil
	})
}
