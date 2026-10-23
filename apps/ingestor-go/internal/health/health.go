// Package health expone el estado del ingestor en un puerto aparte.
package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

// State es el cuerpo que devuelve /health. Los nombres de campo son los mismos
// que los del ingestor de TypeScript: es el contrato observable del worker y
// lo que permite comparar las dos implementaciones en caliente.
type State struct {
	Provider             string  `json:"provider"`
	Authenticated        bool    `json:"authenticated"`
	StreamConnected      bool    `json:"streamConnected"`
	StartedAt            string  `json:"startedAt"`
	LastMessageAt        *string `json:"lastMessageAt"`
	LastSourceTimestamp  *string `json:"lastSourceTimestamp"`
	ProcessedMessages    int64   `json:"processedMessages"`
	InvalidMessages      int64   `json:"invalidMessages"`
	PersistenceFailures  int64   `json:"persistenceFailures"`
	Reconnects           int64   `json:"reconnects"`
	LastError            *string `json:"lastError"`
	LastMaintenanceAt    *string `json:"lastMaintenanceAt"`
	LastMaintenanceError *string `json:"lastMaintenanceError"`
	PartitionsCreated    int64   `json:"partitionsCreated"`
	PartitionsDropped    int64   `json:"partitionsDropped"`
}

// Tracker guarda el estado. Lo escribe la goroutine del stream y lo lee la del
// servidor HTTP, así que todo pasa por el mutex.
type Tracker struct {
	mu    sync.RWMutex
	state State
}

func NewTracker() *Tracker {
	return &Tracker{state: State{
		Provider:  "barentswatch",
		StartedAt: timestamp(time.Now()),
	}}
}

// isoLayout reproduce el `toISOString()` de JavaScript: UTC y siempre tres
// decimales. RFC3339Nano recorta los ceros finales y daría marcas de longitud
// variable, que es justo lo que no se quiere en un contrato observable que se
// compara entre las dos implementaciones.
const isoLayout = "2006-01-02T15:04:05.000Z"

func timestamp(instant time.Time) string {
	return instant.UTC().Format(isoLayout)
}

// Update aplica un cambio sobre el estado bajo el candado.
func (t *Tracker) Update(mutate func(*State)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	mutate(&t.state)
}

// Snapshot devuelve una copia del estado.
func (t *Tracker) Snapshot() State {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.state
}

// Text facilita guardar en el estado los campos que son opcionales.
func Text(value string) *string { return &value }

// Now devuelve el instante actual con el mismo formato que usa el ingestor de
// TypeScript para sus marcas.
func Now() *string {
	return Text(timestamp(time.Now()))
}

// Timestamp da ese mismo formato a un instante cualquiera.
func Timestamp(instant time.Time) string {
	return timestamp(instant)
}

// Server es el servidor de /health ya escuchando.
type Server struct {
	server *http.Server
	Port   int
}

// Start abre el puerto y empieza a servir.
//
// Devuelve con el puerto ya abierto y no cuando el servidor acepte la primera
// conexión: así un fallo de bind se reporta al arrancar, en vez de dejar al
// worker corriendo con un /health que nadie puede consultar.
//
// El puerto 0 pide uno libre, que es lo que usan las pruebas.
func Start(port int, tracker *Tracker) (*Server, error) {
	listener, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		return nil, fmt.Errorf("health: no se pudo abrir el puerto %d: %w", port, err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		state := tracker.Snapshot()
		w.Header().Set("content-type", "application/json; charset=utf-8")
		w.Header().Set("cache-control", "no-store")

		// 503 mientras el stream esté caído: es lo que permite a un
		// orquestador reiniciar un worker que sigue vivo pero no ingiere.
		if !state.StreamConnected {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(state)
	})

	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.Serve(listener) }()

	return &Server{server: server, Port: listener.Addr().(*net.TCPAddr).Port}, nil
}

// Close cierra el servidor sin esperar indefinidamente a las conexiones vivas.
func (s *Server) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = s.server.Shutdown(ctx)
}
