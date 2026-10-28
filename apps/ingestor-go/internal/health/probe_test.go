package health

import (
	"context"
	"net"
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
