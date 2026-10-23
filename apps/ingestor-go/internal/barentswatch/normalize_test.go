package barentswatch

import (
	"encoding/json"
	"testing"
	"time"
)

func TestNormalizePosition(t *testing.T) {
	receivedAt := time.Date(2026, 10, 18, 20, 33, 0, 0, time.UTC)
	raw := json.RawMessage(`{
		"mmsi": 257011940,
		"msgtime": "2026-10-18T20:32:37+00:00",
		"latitude": 69.543985,
		"longitude": 17.769428,
		"name": " BALDER ",
		"shipType": 33,
		"speedOverGround": 0,
		"courseOverGround": 356.7
	}`)

	update, ok := Normalize(raw, receivedAt)
	if !ok {
		t.Fatal("se esperaba una posición válida")
	}

	if update.Provider != "barentswatch" {
		t.Errorf("provider = %q", update.Provider)
	}
	// El nombre llega con espacios alrededor y tiene que salir recortado.
	if update.Name == nil || *update.Name != "BALDER" {
		t.Errorf("name = %v, se esperaba \"BALDER\"", update.Name)
	}
	if !update.ReceivedAt.Equal(receivedAt) {
		t.Errorf("receivedAt = %v, se esperaba %v", update.ReceivedAt, receivedAt)
	}
	if got := update.ObservedAt.UTC().Format(time.RFC3339); got != "2026-10-18T20:32:37Z" {
		t.Errorf("observedAt = %q", got)
	}
	// Un 0 explícito es "parado", no "sin dato": tiene que llegar como puntero
	// a 0 y no como ausencia.
	if update.SpeedOverGround == nil || *update.SpeedOverGround != 0 {
		t.Errorf("speedOverGround = %v, se esperaba 0", update.SpeedOverGround)
	}
	// Lo que el mensaje no trae queda nulo, sin valores cero inventados.
	if update.TrueHeading != nil {
		t.Errorf("trueHeading = %v, se esperaba nulo", *update.TrueHeading)
	}
}

func TestNormalizeRejectsInvalidMessages(t *testing.T) {
	receivedAt := time.Date(2026, 10, 18, 20, 33, 0, 0, time.UTC)

	cases := []struct {
		name string
		raw  string
	}{
		{"latitud fuera de rango y fecha ilegible", `{"mmsi":257011940,"msgtime":"not-a-date","latitude":95,"longitude":17}`},
		{"latitud fuera de rango", `{"mmsi":257011940,"msgtime":"2026-10-18T20:32:37+00:00","latitude":95,"longitude":17}`},
		{"longitud fuera de rango", `{"mmsi":257011940,"msgtime":"2026-10-18T20:32:37+00:00","latitude":69,"longitude":181}`},
		{"mmsi por debajo del rango", `{"mmsi":99999999,"msgtime":"2026-10-18T20:32:37+00:00","latitude":69,"longitude":17}`},
		{"mmsi por encima del rango", `{"mmsi":1000000000,"msgtime":"2026-10-18T20:32:37+00:00","latitude":69,"longitude":17}`},
		{"mmsi con parte decimal", `{"mmsi":257011940.5,"msgtime":"2026-10-18T20:32:37+00:00","latitude":69,"longitude":17}`},
		{"mmsi como cadena", `{"mmsi":"257011940","msgtime":"2026-10-18T20:32:37+00:00","latitude":69,"longitude":17}`},
		{"sin msgtime", `{"mmsi":257011940,"latitude":69,"longitude":17}`},
		{"msgtime en blanco", `{"mmsi":257011940,"msgtime":"   ","latitude":69,"longitude":17}`},
		{"sin coordenadas", `{"mmsi":257011940,"msgtime":"2026-10-18T20:32:37+00:00"}`},
		{"no es un objeto", `[{"mmsi":257011940}]`},
		{"nulo", `null`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, ok := Normalize(json.RawMessage(testCase.raw), receivedAt); ok {
				t.Error("se esperaba un descarte")
			}
		})
	}
}

// Los campos opcionales siguen las mismas reglas que las obligatorias: un
// decimal donde se espera un entero se descarta en lugar de truncarse, y una
// cadena en blanco cuenta como ausencia. Perder esto en la traducción cambia
// en silencio lo que acaba viendo la web.
func TestNormalizeOptionalFieldRules(t *testing.T) {
	receivedAt := time.Date(2026, 10, 18, 20, 33, 0, 0, time.UTC)
	raw := json.RawMessage(`{
		"mmsi": 257011940,
		"msgtime": "2026-10-18T20:32:37+00:00",
		"latitude": 69.5,
		"longitude": 17.7,
		"name": "   ",
		"shipType": 1.5,
		"trueHeading": 314,
		"draught": 4.2
	}`)

	update, ok := Normalize(raw, receivedAt)
	if !ok {
		t.Fatal("se esperaba una posición válida")
	}
	if update.Name != nil {
		t.Errorf("name = %q, una cadena en blanco debe quedar nula", *update.Name)
	}
	if update.ShipType != nil {
		t.Errorf("shipType = %d, un decimal debe descartarse", *update.ShipType)
	}
	if update.TrueHeading == nil || *update.TrueHeading != 314 {
		t.Errorf("trueHeading = %v, se esperaba 314", update.TrueHeading)
	}
	// `draught` en el mensaje es `draughtMeters` en el dominio: es el único
	// campo cuyo nombre cambia al cruzar la frontera.
	if update.DraughtMeters == nil || *update.DraughtMeters != 4.2 {
		t.Errorf("draughtMeters = %v, se esperaba 4.2", update.DraughtMeters)
	}
}

// El payload crudo se conserva tal cual para guardarlo en
// `vessel_latest_positions`: volver a serializarlo desde el mapa reordenaría
// las claves y podría perder precisión numérica.
func TestNormalizeKeepsRawPayload(t *testing.T) {
	receivedAt := time.Date(2026, 10, 18, 20, 33, 0, 0, time.UTC)
	raw := json.RawMessage(`{"mmsi":257011940,"msgtime":"2026-10-18T20:32:37+00:00","latitude":69.5,"longitude":17.7}`)

	update, ok := Normalize(raw, receivedAt)
	if !ok {
		t.Fatal("se esperaba una posición válida")
	}
	if string(update.RawPayload) != string(raw) {
		t.Errorf("rawPayload = %s", update.RawPayload)
	}
}
