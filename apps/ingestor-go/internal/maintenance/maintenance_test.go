package maintenance

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type counter struct {
	mu      sync.Mutex
	runs    int
	results int
	errs    int
}

func (c *counter) run(context.Context) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.runs++
	return c.runs, nil
}

func (c *counter) snapshot() (runs, results, errs int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.runs, c.results, c.errs
}

func (c *counter) callbacks() Callbacks[int] {
	return Callbacks[int]{
		OnResult: func(int) { c.mu.Lock(); c.results++; c.mu.Unlock() },
		OnError:  func(error) { c.mu.Lock(); c.errs++; c.mu.Unlock() },
	}
}

// La primera pasada no espera al intervalo: tiene que haber partición para el
// día en curso antes de que entre la primera posición.
func TestStartRunsImmediately(t *testing.T) {
	c := &counter{}
	schedule := Start(context.Background(), time.Hour, c.run, c.callbacks())
	defer schedule.Stop()

	runs, results, _ := c.snapshot()
	if runs != 1 || results != 1 {
		t.Errorf("pasadas = %d, resultados = %d, se esperaba 1 de cada antes del intervalo", runs, results)
	}
}

func TestStartRepeatsEveryInterval(t *testing.T) {
	c := &counter{}
	schedule := Start(context.Background(), time.Millisecond, c.run, c.callbacks())
	defer schedule.Stop()

	deadline := time.After(2 * time.Second)
	for {
		if runs, _, _ := c.snapshot(); runs >= 3 {
			return
		}
		select {
		case <-deadline:
			runs, _, _ := c.snapshot()
			t.Fatalf("pasadas = %d, se esperaban al menos 3", runs)
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

// Un fallo se reporta y el ciclo continúa: quedarse sin particiones futuras
// tarda días en doler, así que no es razón para tumbar la ingestión.
func TestStartKeepsGoingAfterFailure(t *testing.T) {
	c := &counter{}
	failing := func(ctx context.Context) (int, error) {
		c.mu.Lock()
		c.runs++
		runs := c.runs
		c.mu.Unlock()
		if runs == 1 {
			return 0, errors.New("la base no responde")
		}
		return runs, nil
	}

	schedule := Start(context.Background(), time.Millisecond, failing, c.callbacks())
	defer schedule.Stop()

	deadline := time.After(2 * time.Second)
	for {
		if _, results, errs := c.snapshot(); errs >= 1 && results >= 1 {
			return
		}
		select {
		case <-deadline:
			_, results, errs := c.snapshot()
			t.Fatalf("resultados = %d, errores = %d", results, errs)
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

// Stop espera a que termine la pasada en curso y no lanza más: cerrar el pool
// con una pasada a medias daría un error de conexión cerrada que no significa
// nada.
func TestStopWaitsForRunningPass(t *testing.T) {
	var mu sync.Mutex
	running := false
	finished := false

	slow := func(ctx context.Context) (int, error) {
		mu.Lock()
		running = true
		mu.Unlock()
		time.Sleep(50 * time.Millisecond)
		mu.Lock()
		running = false
		finished = true
		mu.Unlock()
		return 1, nil
	}

	schedule := Start(context.Background(), 10*time.Millisecond, slow, Callbacks[int]{})
	time.Sleep(15 * time.Millisecond)
	schedule.Stop()

	mu.Lock()
	defer mu.Unlock()
	if running {
		t.Error("Stop volvió con una pasada todavía en curso")
	}
	if !finished {
		t.Error("la pasada en curso no llegó a terminar")
	}
}

// Stop es idempotente: main lo llama en el cierre ordenado y no debe
// bloquearse si ya se llamó antes.
func TestStopIsIdempotent(t *testing.T) {
	c := &counter{}
	schedule := Start(context.Background(), time.Hour, c.run, c.callbacks())
	schedule.Stop()
	schedule.Stop()
}
