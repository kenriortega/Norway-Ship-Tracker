package store

import (
	"context"
	"fmt"
)

// RetentionResult dice qué particiones diarias se crearon y cuáles se
// retiraron en la última pasada.
type RetentionResult struct {
	Created []string
	Dropped []string
}

// Changed indica si la pasada movió algo, para no registrar las pasadas
// silenciosas: con un intervalo de treinta minutos, la inmensa mayoría no
// tiene nada que hacer.
func (r RetentionResult) Changed() bool {
	return len(r.Created) > 0 || len(r.Dropped) > 0
}

const applyRetentionSQL = `
SELECT created, dropped
FROM maintain_vessel_positions_partitions($1::integer, $2::integer)`

// ApplyHistoryRetention aplica la política de retención del histórico: crea
// las particiones diarias que faltan y retira las caducadas.
//
// El trabajo real lo hace `maintain_vessel_positions_partitions`, creada por
// la migración 0003. Tener el DDL en SQL y no aquí mantiene el "qué"
// versionado junto al esquema, y es la razón por la que esta parte del port
// son veinte líneas y no doscientas: el Go solo decide el "cuándo".
//
// Retirar un día caducado es un `DROP TABLE` instantáneo. La alternativa, un
// `DELETE` de los casi tres millones de filas que entran cada día, dejaría
// otras tantas tuplas muertas que recorrer mientras siguen llegando treinta
// inserciones por segundo, y no devolvería el disco sin bloquear la tabla.
func (s *Store) ApplyHistoryRetention(ctx context.Context, retentionDays, aheadDays int) (RetentionResult, error) {
	var result RetentionResult

	row := s.pool.QueryRow(ctx, applyRetentionSQL, retentionDays, aheadDays)
	if err := row.Scan(&result.Created, &result.Dropped); err != nil {
		return RetentionResult{}, fmt.Errorf("store: la retención del histórico falló: %w", err)
	}
	return result, nil
}
