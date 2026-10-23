package store

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/domain"
)

// Estas pruebas necesitan PostgreSQL con PostGIS y el esquema ya migrado.
// Sin SHIPS_TEST_DATABASE_URL se saltan, para que `go test ./...` siga siendo
// ejecutable sin infraestructura.
func testStore(t *testing.T) *Store {
	t.Helper()

	databaseURL := os.Getenv("SHIPS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("SHIPS_TEST_DATABASE_URL no está definida")
	}

	ctx := context.Background()
	store, err := Open(ctx, databaseURL, 5)
	if err != nil {
		t.Fatalf("no se pudo abrir la base: %v", err)
	}
	t.Cleanup(store.Close)

	// Cada prueba parte de una base limpia. El CASCADE arrastra las posiciones
	// por la clave ajena, incluidas las de las particiones del histórico.
	if _, err := store.pool.Exec(ctx, "TRUNCATE vessels CASCADE"); err != nil {
		t.Fatalf("no se pudo limpiar la base: %v", err)
	}
	return store
}

func textPtr(value string) *string    { return &value }
func intPtr(value int64) *int64       { return &value }
func floatPtr(value float64) *float64 { return &value }

func sampleUpdate(observedAt, receivedAt time.Time) *domain.VesselUpdate {
	return &domain.VesselUpdate{
		Provider:         domain.Provider,
		MMSI:             257011940,
		ObservedAt:       observedAt,
		ReceivedAt:       receivedAt,
		Latitude:         69.543985,
		Longitude:        17.769428,
		Name:             textPtr("BALDER"),
		CallSign:         textPtr("LM1234"),
		ShipType:         intPtr(33),
		SpeedOverGround:  floatPtr(0),
		CourseOverGround: floatPtr(356.7),
		DraughtMeters:    floatPtr(4.2),
		RawPayload:       json.RawMessage(`{"mmsi":257011940,"name":"BALDER"}`),
	}
}

func TestPersistVesselUpdateWritesAllThreeTables(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	if err := store.PersistVesselUpdate(ctx, sampleUpdate(now.Add(-3*time.Second), now), 60); err != nil {
		t.Fatalf("PersistVesselUpdate devolvió error: %v", err)
	}

	var name string
	var shipType int16
	if err := store.pool.QueryRow(ctx, "SELECT name, ship_type FROM vessels WHERE mmsi = 257011940").
		Scan(&name, &shipType); err != nil {
		t.Fatalf("no se guardó la ficha del barco: %v", err)
	}
	if name != "BALDER" || shipType != 33 {
		t.Errorf("ficha = %q/%d", name, shipType)
	}

	// La geografía tiene que volver con las coordenadas en el orden correcto:
	// ST_MakePoint toma longitud primero, y cambiarlas pondría los barcos
	// noruegos en mitad del océano.
	var longitude, latitude float64
	if err := store.pool.QueryRow(ctx, `
		SELECT ST_X(location::geometry), ST_Y(location::geometry)
		FROM vessel_latest_positions WHERE mmsi = 257011940`).Scan(&longitude, &latitude); err != nil {
		t.Fatalf("no se guardó la última posición: %v", err)
	}
	if longitude != 17.769428 || latitude != 69.543985 {
		t.Errorf("coordenadas = %v, %v (lon, lat)", longitude, latitude)
	}

	var history int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM vessel_positions WHERE mmsi = 257011940").
		Scan(&history); err != nil {
		t.Fatalf("no se pudo contar el histórico: %v", err)
	}
	if history != 1 {
		t.Errorf("filas de histórico = %d, se esperaba 1", history)
	}
}

// Los mensajes de posición traen la ficha estática a medias. Sin los COALESCE,
// cada posición sin nombre borraría el que ya conocíamos.
func TestPersistVesselUpdateKeepsKnownStaticData(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	if err := store.PersistVesselUpdate(ctx, sampleUpdate(now.Add(-10*time.Second), now.Add(-10*time.Second)), 60); err != nil {
		t.Fatalf("primera escritura: %v", err)
	}

	bare := sampleUpdate(now, now)
	bare.Name = nil
	bare.CallSign = nil
	bare.ShipType = nil
	if err := store.PersistVesselUpdate(ctx, bare, 60); err != nil {
		t.Fatalf("segunda escritura: %v", err)
	}

	var name, callSign string
	var shipType int16
	if err := store.pool.QueryRow(ctx, "SELECT name, call_sign, ship_type FROM vessels WHERE mmsi = 257011940").
		Scan(&name, &callSign, &shipType); err != nil {
		t.Fatalf("no se pudo leer la ficha: %v", err)
	}
	if name != "BALDER" || callSign != "LM1234" || shipType != 33 {
		t.Errorf("la ficha se perdió: %q/%q/%d", name, callSign, shipType)
	}
}

// El proveedor no garantiza orden. Una posición retrasada no puede hacer
// retroceder al barco en el mapa.
func TestPersistVesselUpdateIgnoresStalePosition(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	recent := sampleUpdate(now, now)
	recent.Latitude = 69.5
	if err := store.PersistVesselUpdate(ctx, recent, 60); err != nil {
		t.Fatalf("escritura reciente: %v", err)
	}

	stale := sampleUpdate(now.Add(-time.Hour), now)
	stale.Latitude = 60.0
	if err := store.PersistVesselUpdate(ctx, stale, 60); err != nil {
		t.Fatalf("escritura retrasada: %v", err)
	}

	var latitude float64
	if err := store.pool.QueryRow(ctx,
		"SELECT ST_Y(location::geometry) FROM vessel_latest_positions WHERE mmsi = 257011940").
		Scan(&latitude); err != nil {
		t.Fatalf("no se pudo leer la posición: %v", err)
	}
	if latitude != 69.5 {
		t.Errorf("latitud = %v, la posición vieja pisó a la nueva", latitude)
	}
}

// El muestreo del histórico: una posición por barco y ventana. Es lo que
// sostiene el presupuesto de disco de la ADR 0003.
func TestPersistVesselUpdateSamplesHistory(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	for _, offset := range []time.Duration{0, 10 * time.Second, 20 * time.Second} {
		if err := store.PersistVesselUpdate(ctx, sampleUpdate(now.Add(offset), now.Add(offset)), 60); err != nil {
			t.Fatalf("escritura en +%v: %v", offset, err)
		}
	}

	var withinWindow int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM vessel_positions WHERE mmsi = 257011940").
		Scan(&withinWindow); err != nil {
		t.Fatalf("no se pudo contar: %v", err)
	}
	if withinWindow != 1 {
		t.Errorf("filas dentro de la ventana = %d, se esperaba 1", withinWindow)
	}

	// Pasada la ventana sí entra una muestra nueva.
	if err := store.PersistVesselUpdate(ctx, sampleUpdate(now.Add(90*time.Second), now.Add(90*time.Second)), 60); err != nil {
		t.Fatalf("escritura fuera de ventana: %v", err)
	}

	var afterWindow int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM vessel_positions WHERE mmsi = 257011940").
		Scan(&afterWindow); err != nil {
		t.Fatalf("no se pudo contar: %v", err)
	}
	if afterWindow != 2 {
		t.Errorf("filas tras la ventana = %d, se esperaban 2", afterWindow)
	}
}

// El payload crudo solo vive en la última posición. En el histórico pesaba
// casi la mitad de cada fila y no lo lee nadie.
func TestPersistVesselUpdateStoresRawPayloadOnlyInLatest(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	if err := store.PersistVesselUpdate(ctx, sampleUpdate(now, now), 60); err != nil {
		t.Fatalf("PersistVesselUpdate devolvió error: %v", err)
	}

	var payload []byte
	if err := store.pool.QueryRow(ctx,
		"SELECT raw_payload FROM vessel_latest_positions WHERE mmsi = 257011940").Scan(&payload); err != nil {
		t.Fatalf("no se guardó el payload: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("el payload no es jsonb válido: %v", err)
	}
	if decoded["name"] != "BALDER" {
		t.Errorf("payload = %s", payload)
	}

	var columns int
	if err := store.pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_name = 'vessel_positions' AND column_name = 'raw_payload'`).Scan(&columns); err != nil {
		t.Fatalf("no se pudo inspeccionar el esquema: %v", err)
	}
	if columns != 0 {
		t.Error("el histórico no debería tener columna raw_payload")
	}
}

func TestApplyHistoryRetention(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()

	// Idempotente: la segunda pasada seguida no debería mover nada.
	if _, err := store.ApplyHistoryRetention(ctx, 3, 2); err != nil {
		t.Fatalf("primera pasada: %v", err)
	}
	second, err := store.ApplyHistoryRetention(ctx, 3, 2)
	if err != nil {
		t.Fatalf("segunda pasada: %v", err)
	}
	if second.Changed() {
		t.Errorf("la segunda pasada movió particiones: creadas=%v retiradas=%v", second.Created, second.Dropped)
	}

	// Ampliar la ventana crea los días que faltan por detrás.
	wider, err := store.ApplyHistoryRetention(ctx, 6, 2)
	if err != nil {
		t.Fatalf("pasada ampliada: %v", err)
	}
	if len(wider.Created) != 3 {
		t.Errorf("particiones creadas = %v, se esperaban 3 días nuevos", wider.Created)
	}

	// Y reducirla retira las que quedaron fuera.
	narrower, err := store.ApplyHistoryRetention(ctx, 3, 2)
	if err != nil {
		t.Fatalf("pasada reducida: %v", err)
	}
	if len(narrower.Dropped) != 3 {
		t.Errorf("particiones retiradas = %v, se esperaban 3", narrower.Dropped)
	}
}
