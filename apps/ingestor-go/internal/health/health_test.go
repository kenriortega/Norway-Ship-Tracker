package health

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"testing"
)

func startTestServer(t *testing.T) (*Server, *Tracker) {
	t.Helper()
	tracker := NewTracker()
	server, err := Start(0, tracker)
	if err != nil {
		t.Fatalf("no se pudo arrancar el servidor: %v", err)
	}
	t.Cleanup(server.Close)
	return server, tracker
}

func get(t *testing.T, server *Server, path string) (*http.Response, []byte) {
	t.Helper()
	response, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d%s", server.Port, path))
	if err != nil {
		t.Fatalf("la petición falló: %v", err)
	}
	t.Cleanup(func() { response.Body.Close() })
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("no se pudo leer el cuerpo: %v", err)
	}
	return response, body
}

// 503 mientras el stream esté caído: es lo que permite a un orquestador
// reiniciar un worker que sigue vivo pero no ingiere.
func TestHealthIsUnavailableUntilStreamConnects(t *testing.T) {
	server, tracker := startTestServer(t)

	response, _ := get(t, server, "/health")
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("código = %d, se esperaba 503", response.StatusCode)
	}

	tracker.Update(func(state *State) { state.StreamConnected = true })

	response, _ = get(t, server, "/health")
	if response.StatusCode != http.StatusOK {
		t.Errorf("código = %d, se esperaba 200", response.StatusCode)
	}
	if got := response.Header.Get("cache-control"); got != "no-store" {
		t.Errorf("cache-control = %q", got)
	}
}

func TestHealthRejectsOtherPaths(t *testing.T) {
	server, _ := startTestServer(t)

	response, _ := get(t, server, "/otra-cosa")
	if response.StatusCode != http.StatusNotFound {
		t.Errorf("código = %d, se esperaba 404", response.StatusCode)
	}
}

// El cuerpo es el contrato observable del worker y lo que permite comparar las
// dos implementaciones en caliente: los nombres de campo tienen que ser
// exactamente los que emite el ingestor de TypeScript.
func TestHealthBodyMatchesTypeScriptContract(t *testing.T) {
	server, tracker := startTestServer(t)
	tracker.Update(func(state *State) {
		state.StreamConnected = true
		state.ProcessedMessages = 42
	})

	_, body := get(t, server, "/health")

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("el cuerpo no es JSON: %v", err)
	}

	expected := []string{
		"provider", "authenticated", "streamConnected", "startedAt",
		"lastMessageAt", "lastSourceTimestamp", "processedMessages",
		"invalidMessages", "persistenceFailures", "reconnects", "lastError",
		"lastMaintenanceAt", "lastMaintenanceError", "partitionsCreated",
		"partitionsDropped",
	}
	for _, field := range expected {
		if _, ok := decoded[field]; !ok {
			t.Errorf("falta el campo %q", field)
		}
	}
	if len(decoded) != len(expected) {
		t.Errorf("campos = %d, se esperaban %d: %v", len(decoded), len(expected), decoded)
	}
	if decoded["provider"] != "barentswatch" {
		t.Errorf("provider = %v", decoded["provider"])
	}
	// Los opcionales sin valor van como null, no ausentes ni como cadena vacía.
	if decoded["lastError"] != nil {
		t.Errorf("lastError = %v, se esperaba null", decoded["lastError"])
	}
}

// Las marcas llevan el formato de `toISOString()`: UTC y siempre tres
// decimales, no la precisión variable de RFC3339Nano.
func TestHealthTimestampsUseIsoLayout(t *testing.T) {
	server, _ := startTestServer(t)
	_, body := get(t, server, "/health")

	var decoded struct {
		StartedAt string `json:"startedAt"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("el cuerpo no es JSON: %v", err)
	}

	iso := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`)
	if !iso.MatchString(decoded.StartedAt) {
		t.Errorf("startedAt = %q, no tiene el formato esperado", decoded.StartedAt)
	}
}

// Start devuelve con el puerto ya abierto: un fallo de bind se reporta al
// arrancar en vez de dejar un worker corriendo con /health inaccesible.
func TestStartReportsBindFailure(t *testing.T) {
	first, tracker := startTestServer(t)

	if _, err := Start(first.Port, tracker); err == nil {
		t.Error("se esperaba un error al reusar un puerto ocupado")
	}
}
