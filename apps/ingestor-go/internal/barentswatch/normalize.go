package barentswatch

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/domain"
)

// Rango válido de un MMSI de embarcación. Lo comprueba también la base con un
// CHECK en `vessels.mmsi`; filtrar aquí evita que un mensaje corrupto llegue a
// provocar un error de transacción por cada posición de ese barco.
const (
	minMMSI = 100_000_000
	maxMMSI = 999_999_999
)

// asObject decodifica el mensaje a un mapa, rechazando lo que no sea un objeto
// JSON. UseNumber conserva los números sin convertirlos a float64 por defecto,
// que es lo que permite distinguir después un entero de un decimal.
func asObject(raw json.RawMessage) (map[string]any, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()

	var payload map[string]any
	if err := decoder.Decode(&payload); err != nil || payload == nil {
		return nil, false
	}
	return payload, true
}

// finiteNumber acepta solo números finitos, como el `Number.isFinite` del
// normalizador de TypeScript. Una cadena "33" no es un número y se rechaza.
func finiteNumber(value any) (float64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	parsed, err := number.Float64()
	if err != nil || math.IsInf(parsed, 0) || math.IsNaN(parsed) {
		return 0, false
	}
	return parsed, true
}

// integer exige además que el número no tenga parte decimal, igual que
// `Number.isInteger`. Un `shipType` de 1.5 se descarta en lugar de truncarse:
// truncar inventaría un tipo de barco que el mensaje no dijo.
func integer(value any) (int64, bool) {
	number, ok := finiteNumber(value)
	if !ok || number != math.Trunc(number) {
		return 0, false
	}
	return int64(number), true
}

// optionalString recorta los espacios y trata la cadena vacía como ausencia,
// de modo que un `name` de "   " acaba en NULL y no en cadena vacía.
func optionalString(value any) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return "", false
	}
	return trimmed, true
}

func optionalStringPtr(value any) *string {
	if text, ok := optionalString(value); ok {
		return &text
	}
	return nil
}

func optionalIntPtr(value any) *int64 {
	if number, ok := integer(value); ok {
		return &number
	}
	return nil
}

func optionalFloatPtr(value any) *float64 {
	if number, ok := finiteNumber(value); ok {
		return &number
	}
	return nil
}

// Normalize convierte un mensaje crudo del proveedor en el modelo de dominio.
//
// Devuelve ok=false para todo lo que no sea una posición utilizable, sin
// distinguir el motivo: el llamante solo cuenta descartes. Un mensaje sin
// coordenada válida no es un error del sistema, es ruido esperable en un
// stream abierto, y tumbar la ingestión por él sería desproporcionado.
//
// Se exige RFC 3339 en `msgtime`, que es lo que emite el proveedor. Es más
// estricto que el `new Date()` de JavaScript, que acepta formatos adicionales;
// la diferencia es deliberada, porque aquí un formato inesperado es una señal
// de que el contrato cambió y preferimos contarlo como descarte visible en
// `/health` antes que adivinar la fecha.
func Normalize(raw json.RawMessage, receivedAt time.Time) (*domain.VesselUpdate, bool) {
	payload, ok := asObject(raw)
	if !ok {
		return nil, false
	}

	mmsi, mmsiOK := integer(payload["mmsi"])
	latitude, latitudeOK := finiteNumber(payload["latitude"])
	longitude, longitudeOK := finiteNumber(payload["longitude"])
	msgtime, msgtimeOK := optionalString(payload["msgtime"])

	if !mmsiOK || mmsi < minMMSI || mmsi > maxMMSI ||
		!latitudeOK || latitude < -90 || latitude > 90 ||
		!longitudeOK || longitude < -180 || longitude > 180 ||
		!msgtimeOK {
		return nil, false
	}

	observedAt, err := time.Parse(time.RFC3339, msgtime)
	if err != nil {
		return nil, false
	}

	return &domain.VesselUpdate{
		Provider:           domain.Provider,
		MMSI:               mmsi,
		ObservedAt:         observedAt,
		ReceivedAt:         receivedAt,
		Latitude:           latitude,
		Longitude:          longitude,
		Name:               optionalStringPtr(payload["name"]),
		IMONumber:          optionalIntPtr(payload["imoNumber"]),
		CallSign:           optionalStringPtr(payload["callSign"]),
		ShipType:           optionalIntPtr(payload["shipType"]),
		SpeedOverGround:    optionalFloatPtr(payload["speedOverGround"]),
		CourseOverGround:   optionalFloatPtr(payload["courseOverGround"]),
		TrueHeading:        optionalIntPtr(payload["trueHeading"]),
		RateOfTurn:         optionalFloatPtr(payload["rateOfTurn"]),
		NavigationalStatus: optionalIntPtr(payload["navigationalStatus"]),
		Destination:        optionalStringPtr(payload["destination"]),
		DraughtMeters:      optionalFloatPtr(payload["draught"]),
		RawPayload:         raw,
	}, true
}
