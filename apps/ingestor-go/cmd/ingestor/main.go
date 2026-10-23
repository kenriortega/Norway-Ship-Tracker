// Comando ingestor: mantiene el stream AIS de BarentsWatch y lo persiste en
// PostgreSQL/PostGIS.
//
// Es el equivalente en Go de `apps/ingestor`. Los dos pueden arrancar con el
// mismo `.env` y escriben las mismas filas; mientras dure el periodo de
// convivencia, esa equivalencia es el criterio que manda sobre cualquier otra
// consideración.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/barentswatch"
	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/config"
	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/domain"
	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/health"
	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/maintenance"
	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/store"
)

// log escribe una línea JSON por evento, el mismo formato que el ingestor de
// TypeScript, para que una instalación pueda cambiar de uno a otro sin tocar
// la recolección de logs.
func log(destination *os.File, fields map[string]any) {
	encoded, err := json.Marshal(fields)
	if err != nil {
		fmt.Fprintf(os.Stderr, `{"event":"log_failed"}%s`, "\n")
		return
	}
	fmt.Fprintf(destination, "%s\n", encoded)
}

func info(fields map[string]any) { log(os.Stdout, fields) }
func fail(fields map[string]any) { log(os.Stderr, fields) }

// describeError recorre la cadena de causas y las une, para que un fallo de
// red envuelto en tres capas no se reporte como un genérico inservible.
func describeError(err error) string {
	messages := []string{}
	for current := err; current != nil; current = errors.Unwrap(current) {
		messages = append(messages, current.Error())
	}
	if len(messages) == 0 {
		return "unknown"
	}
	return messages[0]
}

func main() {
	if err := run(); err != nil {
		fail(map[string]any{"event": "ingestor_failed", "error": describeError(err)})
		os.Exit(1)
	}
}

func run() error {
	settings, err := config.Load()
	if err != nil {
		return err
	}

	// El contexto se cancela con SIGINT o SIGTERM y es lo que ordena el cierre
	// de todas las piezas.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := store.Open(ctx, settings.DatabaseURL, 5)
	if err != nil {
		return err
	}
	defer database.Close()

	tracker := health.NewTracker()
	healthServer, err := health.Start(settings.HealthPort, tracker)
	if err != nil {
		return err
	}
	defer healthServer.Close()
	info(map[string]any{"event": "health_server_started", "port": healthServer.Port})

	tokens := barentswatch.NewTokenManager(
		settings.TokenURL, settings.ClientID, settings.ClientSecret, settings.Scope, nil)
	client := barentswatch.NewClient(tokens, barentswatch.StreamOptions{
		StreamURL:      settings.StreamURL,
		LatestURL:      settings.LatestURL,
		InitialBackoff: settings.InitialBackoff,
		MaxBackoff:     settings.MaxBackoff,
	})

	// El mantenimiento arranca antes que el stream para que nunca falte la
	// partición del día en curso donde aterrizarán las primeras posiciones.
	schedule := maintenance.Start(ctx, settings.MaintenanceInterval,
		func(ctx context.Context) (store.RetentionResult, error) {
			return database.ApplyHistoryRetention(ctx, settings.HistoryRetentionDays, settings.PartitionAheadDays)
		},
		maintenance.Callbacks[store.RetentionResult]{
			OnResult: func(result store.RetentionResult) {
				tracker.Update(func(state *health.State) {
					state.LastMaintenanceAt = health.Now()
					state.LastMaintenanceError = nil
					state.PartitionsCreated += int64(len(result.Created))
					state.PartitionsDropped += int64(len(result.Dropped))
				})
				if result.Changed() {
					info(map[string]any{
						"event":   "history_retention_applied",
						"created": result.Created,
						"dropped": result.Dropped,
					})
				}
			},
			OnError: func(err error) {
				described := describeError(err)
				tracker.Update(func(state *health.State) { state.LastMaintenanceError = &described })
				fail(map[string]any{"event": "history_retention_failed", "error": described})
			},
		})
	// Antes de cerrar la conexión: una pasada a medias moriría con un error de
	// conexión cerrada que no significa nada.
	defer schedule.Stop()

	callbacks := barentswatch.StreamCallbacks{
		OnConnected: func() {
			tracker.Update(func(state *health.State) {
				state.Authenticated = true
				state.StreamConnected = true
				state.LastError = nil
			})
			info(map[string]any{"event": "ais_stream_connected"})
		},
		OnDisconnected: func() {
			tracker.Update(func(state *health.State) { state.StreamConnected = false })
		},
		OnInvalidMessage: func() {
			tracker.Update(func(state *health.State) { state.InvalidMessages++ })
		},
		OnReconnect: func() {
			tracker.Update(func(state *health.State) { state.Reconnects++ })
		},
		OnError: func(err error) {
			described := describeError(err)
			tracker.Update(func(state *health.State) { state.LastError = &described })
			fail(map[string]any{"event": "ais_stream_error", "error": described})
		},
		OnUpdate: func(update *domain.VesselUpdate) error {
			if err := database.PersistVesselUpdate(ctx, update, settings.HistorySampleSeconds); err != nil {
				tracker.Update(func(state *health.State) { state.PersistenceFailures++ })
				return err
			}
			tracker.Update(func(state *health.State) {
				state.ProcessedMessages++
				state.LastMessageAt = health.Now()
				state.LastSourceTimestamp = health.Text(health.Timestamp(update.ObservedAt))
			})
			return nil
		},
	}

	if _, err := tokens.Token(ctx); err != nil {
		return err
	}
	tracker.Update(func(state *health.State) { state.Authenticated = true })

	// El snapshot es un adelanto, no un requisito: si falla, el stream llena
	// el mapa igual, solo que más despacio. Tumbar el arranque por esto
	// dejaría al worker sin ingerir nada.
	if settings.BootstrapSnapshot {
		count, err := client.IngestLatestSnapshot(ctx, callbacks)
		if err != nil {
			callbacks.OnError(err)
			info(map[string]any{"event": "ais_snapshot_skipped"})
		} else {
			info(map[string]any{"event": "ais_snapshot_ingested", "count": count})
		}
	}

	err = client.RunLiveStream(ctx, callbacks)

	tracker.Update(func(state *health.State) { state.StreamConnected = false })
	if errors.Is(err, context.Canceled) {
		info(map[string]any{"event": "ingestor_stopped"})
		return nil
	}
	return err
}
