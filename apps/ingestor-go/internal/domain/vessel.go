// Package domain contiene el modelo normalizado que cruza la frontera entre la
// ingestión y la persistencia. Es el equivalente de `packages/domain` en el
// monorepo de TypeScript, recortado a lo que el ingestor necesita: los DTO de
// la API los sigue sirviendo la web y no tienen reflejo aquí.
package domain

import (
	"encoding/json"
	"time"
)

// Provider identifica la fuente de los mensajes. Se escribe en cada fila para
// que convivan posiciones de proveedores distintos sin ambigüedad.
const Provider = "barentswatch"

// VesselUpdate es una posición ya validada y lista para persistir.
//
// Los campos opcionales son punteros y no valores cero: un `speedOverGround`
// de 0 significa "parado" y un ausente significa "no lo sabemos", y la base
// distingue ambos. Colapsarlos en 0.0 inventaría datos.
type VesselUpdate struct {
	Provider string

	MMSI       int64
	ObservedAt time.Time
	ReceivedAt time.Time
	Latitude   float64
	Longitude  float64

	Name               *string
	IMONumber          *int64
	CallSign           *string
	ShipType           *int64
	SpeedOverGround    *float64
	CourseOverGround   *float64
	TrueHeading        *int64
	RateOfTurn         *float64
	NavigationalStatus *int64
	Destination        *string
	DraughtMeters      *float64

	// El objeto original tal y como llegó. Se conserva en bytes y no como mapa
	// para no reordenar claves ni perder precisión al volver a serializarlo;
	// solo se guarda en `vessel_latest_positions`, nunca en el histórico.
	RawPayload json.RawMessage
}
