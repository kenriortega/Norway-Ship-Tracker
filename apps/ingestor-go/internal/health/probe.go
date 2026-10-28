package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Probe consulta el /health local y decide si el worker está ingiriendo.
// Devuelve nil si lo está y un error que explica por qué no, si no.
//
// La vejez de lastMessageAt se mide aquí y no en el handler: un stream abierto
// y silencioso responde 200, y cambiar cuándo el endpoint devuelve 503 rompería
// la equivalencia con el ingestor de TypeScript. `now` entra por parámetro para
// que las pruebas no dependan del reloj.
func Probe(ctx context.Context, port int, maxSilence time.Duration, now time.Time) error {
	// IP literal: en `scratch` no hay quien resuelva nombres.
	url := fmt.Sprintf("http://127.0.0.1:%d/health", port)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("health: petición inválida: %w", err)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("health: el servidor de salud no responde: %w", err)
	}
	defer response.Body.Close()

	switch response.StatusCode {
	case http.StatusOK:
	case http.StatusServiceUnavailable:
		return fmt.Errorf("health: el stream está caído (503)")
	default:
		return fmt.Errorf("health: código inesperado %d", response.StatusCode)
	}

	var state State
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil {
		return fmt.Errorf("health: cuerpo ilegible: %w", err)
	}
	if state.LastMessageAt == nil {
		return fmt.Errorf("health: todavía no ha entrado ninguna posición")
	}
	// isoLayout es lo que escribe el worker, y va primero. RFC3339 es
	// tolerancia y no contrato: hoy no hay ningún productor que emita
	// desplazamiento, pero una marca válida con +00:00 no debe dejar el
	// contenedor unhealthy para siempre.
	last, err := time.Parse(isoLayout, *state.LastMessageAt)
	if err != nil {
		var retryErr error
		if last, retryErr = time.Parse(time.RFC3339, *state.LastMessageAt); retryErr != nil {
			return fmt.Errorf("health: lastMessageAt ilegible %q: %w", *state.LastMessageAt, err)
		}
	}
	// Sin tope por arriba, un reloj desbocado o una marca en hora local
	// etiquetada con Z dejarían el contenedor sano con la ingestión parada.
	if last.After(now.Add(maxSilence)) {
		return fmt.Errorf("health: lastMessageAt está %d s en el futuro, el reloj o el formato no cuadran",
			int(last.Sub(now).Seconds()))
	}
	if last.Before(now.Add(-maxSilence)) {
		return fmt.Errorf("health: último mensaje hace %d s, el máximo es %d s",
			int(now.Sub(last).Seconds()), int(maxSilence.Seconds()))
	}
	return nil
}
