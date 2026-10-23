package barentswatch

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// chunkReader entrega el contenido en trozos fijos, uno por Read, para
// reproducir lo que hace la red: los cortes no respetan las fronteras de los
// objetos JSON.
type chunkReader struct {
	data   []byte
	splits []int
	offset int
	next   int
}

func (r *chunkReader) Read(p []byte) (int, error) {
	if r.offset >= len(r.data) {
		return 0, io.EOF
	}
	end := len(r.data)
	if r.next < len(r.splits) {
		end = r.splits[r.next]
		r.next++
	}
	n := copy(p, r.data[r.offset:end])
	r.offset += n
	return n, nil
}

func fixturePath(t *testing.T) string {
	t.Helper()
	return filepath.Join("..", "..", "..", "..", "fixtures", "barentswatch", "positions.ndjson")
}

func TestParseNDJSONReassemblesSplitChunks(t *testing.T) {
	contents, err := os.ReadFile(fixturePath(t))
	if err != nil {
		t.Fatalf("no se pudo leer el fixture: %v", err)
	}

	reader := &chunkReader{data: contents, splits: []int{17, 83, 211}}

	var messages []json.RawMessage
	if err := ParseNDJSON(reader, DefaultMaxBufferBytes, func(message json.RawMessage) error {
		messages = append(messages, message)
		return nil
	}); err != nil {
		t.Fatalf("ParseNDJSON devolvió error: %v", err)
	}

	if len(messages) != 2 {
		t.Fatalf("se esperaban 2 mensajes, llegaron %d", len(messages))
	}

	var first struct {
		MMSI int64 `json:"mmsi"`
	}
	if err := json.Unmarshal(messages[0], &first); err != nil {
		t.Fatalf("el primer mensaje no decodifica: %v", err)
	}
	if first.MMSI != 257011940 {
		t.Errorf("mmsi = %d, se esperaba 257011940", first.MMSI)
	}

	var second struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(messages[1], &second); err != nil {
		t.Fatalf("el segundo mensaje no decodifica: %v", err)
	}
	if second.Name != "SARPEN" {
		t.Errorf("name = %q, se esperaba \"SARPEN\"", second.Name)
	}
}

func TestParseNDJSONSkipsBlankKeepalives(t *testing.T) {
	input := strings.NewReader("\n  \n{\"mmsi\":257011940}\n\n")

	var messages []json.RawMessage
	if err := ParseNDJSON(input, DefaultMaxBufferBytes, func(message json.RawMessage) error {
		messages = append(messages, message)
		return nil
	}); err != nil {
		t.Fatalf("ParseNDJSON devolvió error: %v", err)
	}

	if len(messages) != 1 {
		t.Fatalf("se esperaba 1 mensaje, llegaron %d", len(messages))
	}
}

func TestParseNDJSONRejectsOversizedLine(t *testing.T) {
	input := strings.NewReader("{\"padding\":\"" + strings.Repeat("x", 512) + "\"}\n")

	err := ParseNDJSON(input, 64, func(json.RawMessage) error { return nil })
	if err == nil {
		t.Fatal("se esperaba un error por línea demasiado larga")
	}
	if !strings.Contains(err.Error(), "por encima de 64 bytes") {
		t.Errorf("error inesperado: %v", err)
	}
}

func TestParseNDJSONRejectsInvalidJSON(t *testing.T) {
	input := strings.NewReader("{\"mmsi\":\n")

	err := ParseNDJSON(input, DefaultMaxBufferBytes, func(json.RawMessage) error { return nil })
	if err == nil {
		t.Fatal("se esperaba un error por JSON inválido")
	}
}
