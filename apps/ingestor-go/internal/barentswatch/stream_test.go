package barentswatch

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/domain"
)

const samplePosition = `{"mmsi":257011940,"msgtime":"2026-10-18T20:32:37+00:00","latitude":69.5,"longitude":17.7,"name":"BALDER"}`

// recorder acumula lo que el transporte reporta. Los contadores van con mutex
// porque el stream corre en su propia goroutine durante los tests.
type recorder struct {
	mu          sync.Mutex
	connected   int
	disconnects int
	reconnects  int
	invalid     int
	updates     []*domain.VesselUpdate
	errs        []error
	updateErr   error
}

func (r *recorder) callbacks() StreamCallbacks {
	return StreamCallbacks{
		OnConnected:      func() { r.mu.Lock(); r.connected++; r.mu.Unlock() },
		OnDisconnected:   func() { r.mu.Lock(); r.disconnects++; r.mu.Unlock() },
		OnReconnect:      func() { r.mu.Lock(); r.reconnects++; r.mu.Unlock() },
		OnInvalidMessage: func() { r.mu.Lock(); r.invalid++; r.mu.Unlock() },
		OnError:          func(err error) { r.mu.Lock(); r.errs = append(r.errs, err); r.mu.Unlock() },
		OnUpdate: func(update *domain.VesselUpdate) error {
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.updateErr != nil {
				return r.updateErr
			}
			r.updates = append(r.updates, update)
			return nil
		},
	}
}

func (r *recorder) counts() (connected, disconnects, reconnects, invalid, updates int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.connected, r.disconnects, r.reconnects, r.invalid, len(r.updates)
}

// testClient monta un Client apuntando al servidor dado, con un token servido
// por el mismo servidor en /token y retrocesos de milisegundos.
func testClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	tokens := NewTokenManager(server.URL+"/token", "id", "secret", "ais", nil)
	return NewClient(tokens, StreamOptions{
		StreamURL:      server.URL + "/stream",
		LatestURL:      server.URL + "/latest",
		InitialBackoff: time.Millisecond,
		MaxBackoff:     4 * time.Millisecond,
	})
}

func handleToken(w http.ResponseWriter) {
	w.Header().Set("content-type", "application/json")
	fmt.Fprint(w, `{"access_token":"token","expires_in":3600,"token_type":"Bearer"}`)
}

// Un stream que se corta solo no es un final válido: es un flujo sin fin, así
// que el cliente tiene que reconectar en lugar de darse por terminado.
func TestRunLiveStreamReconnectsAfterStreamEnds(t *testing.T) {
	var streamRequests atomic.Int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			handleToken(w)
			return
		}
		if r.Header.Get("authorization") != "Bearer token" {
			t.Errorf("falta la cabecera de autorización: %q", r.Header.Get("authorization"))
		}
		streamRequests.Add(1)
		fmt.Fprint(w, samplePosition+"\n")
	}))
	defer server.Close()

	rec := &recorder{}
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan error, 1)
	go func() { done <- testClient(t, server).RunLiveStream(ctx, rec.callbacks()) }()

	// Tres posiciones solo pueden venir de tres conexiones completadas, así
	// que esperar por ellas evita cancelar con una conexión a medias.
	deadline := time.After(3 * time.Second)
	for {
		if _, _, _, _, updates := rec.counts(); updates >= 3 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("el stream no reconectó a tiempo")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("RunLiveStream no paró al cancelar el contexto")
	}

	connected, disconnects, reconnects, _, updates := rec.counts()
	if connected < 3 {
		t.Errorf("conexiones = %d, se esperaban al menos 3", connected)
	}
	if disconnects < 2 {
		t.Errorf("desconexiones = %d, se esperaban al menos 2", disconnects)
	}
	if reconnects < 2 {
		t.Errorf("reconexiones = %d", reconnects)
	}
	if updates < 3 {
		t.Errorf("posiciones = %d, se esperaba una por conexión", updates)
	}
	if got := streamRequests.Load(); got < 3 {
		t.Errorf("peticiones al stream = %d", got)
	}
}

// Un 401 a mitad de camino tiene que invalidar el token: el proveedor puede
// revocarlo antes de su caducidad declarada, y sin esto el ingestor
// reintentaría en bucle con una credencial muerta.
func TestRunLiveStreamRefreshesTokenAfterUnauthorized(t *testing.T) {
	var tokenRequests atomic.Int64
	var streamRequests atomic.Int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			tokenRequests.Add(1)
			handleToken(w)
			return
		}
		// El primer intento recibe un 401; los siguientes van bien.
		if streamRequests.Add(1) == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		fmt.Fprint(w, samplePosition+"\n")
	}))
	defer server.Close()

	rec := &recorder{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- testClient(t, server).RunLiveStream(ctx, rec.callbacks()) }()

	deadline := time.After(3 * time.Second)
	for {
		if _, _, _, _, updates := rec.counts(); updates >= 1 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("el stream no se recuperó del 401")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	<-done

	if got := tokenRequests.Load(); got < 2 {
		t.Errorf("peticiones de token = %d, el 401 debía forzar una renovación", got)
	}
}

// Los mensajes que no normalizan se cuentan y se saltan: en un stream abierto
// el ruido es esperable y tumbar la ingestión por él sería desproporcionado.
func TestRunLiveStreamCountsInvalidMessages(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			handleToken(w)
			return
		}
		fmt.Fprint(w, `{"mmsi":1}`+"\n"+samplePosition+"\n")
	}))
	defer server.Close()

	rec := &recorder{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- testClient(t, server).RunLiveStream(ctx, rec.callbacks()) }()

	deadline := time.After(3 * time.Second)
	for {
		if _, _, _, invalid, updates := rec.counts(); invalid >= 1 && updates >= 1 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("no llegaron los mensajes esperados")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	<-done
}

// Un fallo al persistir corta la lectura y provoca reconexión: si la base no
// acepta escrituras, seguir leyendo solo tira mensajes que no podemos guardar.
func TestRunLiveStreamSurfacesPersistenceFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			handleToken(w)
			return
		}
		fmt.Fprint(w, samplePosition+"\n")
	}))
	defer server.Close()

	rec := &recorder{updateErr: fmt.Errorf("la base no acepta escrituras")}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- testClient(t, server).RunLiveStream(ctx, rec.callbacks()) }()

	deadline := time.After(3 * time.Second)
	for {
		rec.mu.Lock()
		errs := len(rec.errs)
		rec.mu.Unlock()
		if errs >= 1 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("el fallo de persistencia no se reportó")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	<-done

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if rec.errs[0].Error() != "la base no acepta escrituras" {
		t.Errorf("error = %v, se esperaba el de persistencia", rec.errs[0])
	}
}

func TestIngestLatestSnapshot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			handleToken(w)
			return
		}
		fmt.Fprint(w, `[`+samplePosition+`,{"mmsi":1},`+samplePosition+`]`)
	}))
	defer server.Close()

	rec := &recorder{}
	accepted, err := testClient(t, server).IngestLatestSnapshot(context.Background(), rec.callbacks())
	if err != nil {
		t.Fatalf("IngestLatestSnapshot devolvió error: %v", err)
	}

	if accepted != 2 {
		t.Errorf("aceptadas = %d, se esperaban 2", accepted)
	}
	if _, _, _, invalid, _ := rec.counts(); invalid != 1 {
		t.Errorf("descartes = %d, se esperaba 1", invalid)
	}
	// Todas las posiciones del snapshot comparten instante de recepción:
	// llegaron juntas y escalonarlas fingiría algo que no ocurrió.
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if !rec.updates[0].ReceivedAt.Equal(rec.updates[1].ReceivedAt) {
		t.Error("las posiciones del snapshot deberían compartir receivedAt")
	}
}

func TestIngestLatestSnapshotRejectsNonArray(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			handleToken(w)
			return
		}
		fmt.Fprint(w, `{"not":"an array"}`)
	}))
	defer server.Close()

	rec := &recorder{}
	if _, err := testClient(t, server).IngestLatestSnapshot(context.Background(), rec.callbacks()); err == nil {
		t.Fatal("se esperaba un error por respuesta que no es una lista")
	}
}
