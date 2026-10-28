package main

import (
	"strconv"
	"testing"
	"time"

	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/health"
)

// healthcheckWith arranca el servidor real con el último mensaje dado y corre
// el subcomando contra él.
func healthcheckWith(t *testing.T, lastMessageAt *string) int {
	t.Helper()
	tracker := health.NewTracker()
	tracker.Update(func(state *health.State) {
		state.StreamConnected = true
		state.LastMessageAt = lastMessageAt
	})
	server, err := health.Start(0, tracker)
	if err != nil {
		t.Fatalf("no se pudo arrancar el servidor: %v", err)
	}
	t.Cleanup(server.Close)
	t.Setenv("HEALTH_PORT", strconv.Itoa(server.Port))
	t.Setenv("HEALTH_MAX_SILENCE_SECONDS", "300")
	return runHealthcheck()
}

func TestRunHealthcheckSucceedsWhenIngesting(t *testing.T) {
	if code := healthcheckWith(t, health.Now()); code != 0 {
		t.Errorf("código = %d, se esperaba 0", code)
	}
}

func TestRunHealthcheckFailsWhenStale(t *testing.T) {
	stale := health.Text(time.Now().Add(-20 * time.Minute).UTC().Format("2006-01-02T15:04:05.000Z"))
	if code := healthcheckWith(t, stale); code != 1 {
		t.Errorf("código = %d, se esperaba 1", code)
	}
}
