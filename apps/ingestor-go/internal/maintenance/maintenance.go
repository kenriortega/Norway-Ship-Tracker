// Package maintenance programa las pasadas de retención del histórico.
package maintenance

import (
	"context"
	"sync"
	"time"
)

// Run es una pasada de mantenimiento. Devuelve lo que haya hecho para que el
// llamante lo registre.
type Run[T any] func(context.Context) (T, error)

// Callbacks recoge el resultado de cada pasada.
type Callbacks[T any] struct {
	OnResult func(T)
	OnError  func(error)
}

// Schedule controla el ciclo ya arrancado.
type Schedule struct {
	cancel context.CancelFunc
	done   chan struct{}
	once   sync.Once
}

// Stop detiene el ciclo y espera a que termine la pasada en curso, si la hay.
func (s *Schedule) Stop() {
	s.once.Do(func() {
		s.cancel()
		<-s.done
	})
}

// Start ejecuta una pasada al arrancar y después cada interval.
//
// Vive en el worker y no en un cron del sistema ni en `pg_cron` por dos
// razones. La imagen `postgis/postgis:16-3.5` no trae `pg_cron`, así que
// programarlo dentro de Postgres obligaría a mantener una imagen propia. Y un
// cron externo sería una pieza fuera del repositorio, invisible para
// `compose.yaml`. El worker ya es un proceso persistente con conexión a la
// base: si está caído tampoco entra nada que purgar.
//
// La primera pasada es síncrona a propósito: arranca antes que el stream para
// que nunca falte la partición del día en curso donde aterrizarán las primeras
// posiciones.
//
// Un fallo no interrumpe el ciclo: se avisa y se reintenta en la pasada
// siguiente. Quedarse sin particiones futuras tarda días en volverse un
// problema, así que no hay razón para tumbar la ingestión por ello.
func Start[T any](ctx context.Context, interval time.Duration, run Run[T], callbacks Callbacks[T]) *Schedule {
	ctx, cancel := context.WithCancel(ctx)
	schedule := &Schedule{cancel: cancel, done: make(chan struct{})}

	tick := func() {
		result, err := run(ctx)
		if err != nil {
			if callbacks.OnError != nil {
				callbacks.OnError(err)
			}
			return
		}
		if callbacks.OnResult != nil {
			callbacks.OnResult(result)
		}
	}

	tick()

	go func() {
		defer close(schedule.done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tick()
			}
		}
	}()

	return schedule
}
