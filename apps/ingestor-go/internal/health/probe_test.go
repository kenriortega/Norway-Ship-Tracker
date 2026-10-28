package health

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

const probeSilence = 5 * time.Minute

// probeWith arranca un servidor real con el estado que se le pide y sondea.
func probeWith(t *testing.T, mutate func(*State)) error {
	t.Helper()
	server, tracker := startTestServer(t)
	tracker.Update(mutate)
	return Probe(context.Background(), server.Port, probeSilence, time.Now())
}

func agoText(age time.Duration) *string {
	return Text(timestamp(time.Now().Add(-age)))
}

func TestProbeAcceptsFreshIngestion(t *testing.T) {
	err := probeWith(t, func(state *State) {
		state.StreamConnected = true
		state.LastMessageAt = agoText(10 * time.Second)
	})
	if err != nil {
		t.Errorf("se esperaba nil con ingestión reciente: %v", err)
	}
}

// El servidor real siempre serializa con isoLayout, así que para una marca con
// otro formato hace falta un cuerpo escrito a mano.
func probeRawTimestamp(t *testing.T, stamp string) error {
	t.Helper()
	body := `{"lastMessageAt":"` + stamp + `"}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(body))
	}))
	defer server.Close()
	_, portText, _ := net.SplitHostPort(strings.TrimPrefix(server.URL, "http://"))
	port, _ := strconv.Atoi(portText)
	return Probe(context.Background(), port, probeSilence, time.Now())
}

func TestProbeAcceptsOffsetTimestamp(t *testing.T) {
	stamp := time.Now().UTC().Format("2006-01-02T15:04:05") + ".000+00:00"
	if err := probeRawTimestamp(t, stamp); err != nil {
		t.Errorf("se esperaba nil con marca +00:00: %v", err)
	}
}

// +00:00 no distingue interpretar el desplazamiento de ignorarlo: con cero
// horas los dos dan el mismo instante. Con +05:00 la pared de ahora es un
// instante de hace cinco horas, así que una implementación que tirase el
// sufijo daría por fresco un stream parado.
func TestProbeRejectsStaleOffsetTimestamp(t *testing.T) {
	stamp := time.Now().UTC().Format("2006-01-02T15:04:05") + ".000+05:00"
	if err := probeRawTimestamp(t, stamp); err == nil {
		t.Error("se esperaba error: +05:00 sobre la pared de ahora es hace cinco horas")
	}
}

// Un reloj desbocado o una marca en hora local etiquetada con Z dejarían la
// sonda sana para siempre si solo se mirase la vejez.
func TestProbeRejectsFutureTimestamp(t *testing.T) {
	stamp := time.Now().UTC().Add(2 * time.Hour).Format(isoLayout)
	if err := probeRawTimestamp(t, stamp); err == nil {
		t.Error("se esperaba error con una marca dos horas en el futuro")
	}
}

func TestProbeRejectsStaleIngestion(t *testing.T) {
	err := probeWith(t, func(state *State) {
		state.StreamConnected = true
		state.LastMessageAt = agoText(20 * time.Minute)
	})
	if err == nil {
		t.Error("se esperaba un error con el último mensaje de hace 20 minutos")
	}
}

func TestProbeRejectsDisconnectedStream(t *testing.T) {
	err := probeWith(t, func(state *State) {
		state.StreamConnected = false
		state.LastMessageAt = agoText(10 * time.Second)
	})
	if err == nil {
		t.Error("se esperaba un error con el stream caído (503)")
	}
}

func TestProbeRejectsWorkerThatNeverIngested(t *testing.T) {
	err := probeWith(t, func(state *State) {
		state.StreamConnected = true
		state.LastMessageAt = nil
	})
	if err == nil {
		t.Error("se esperaba un error sin ningún mensaje recibido")
	}
}

func TestProbeRejectsUnreachableServer(t *testing.T) {
	// Se reserva un puerto libre y se suelta: nadie escucha en él.
	// shortcut: entre el Close del listener y el Probe, otro proceso puede tomar
	// el puerto y el caso pasaría por el motivo equivocado; revisar si esta prueba
	// empieza a fallar de forma intermitente.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("no se pudo reservar un puerto: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	if err := Probe(context.Background(), port, probeSilence, time.Now()); err == nil {
		t.Error("se esperaba un error con el puerto sin nadie escuchando")
	}
}
