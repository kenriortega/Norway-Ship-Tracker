// Package barentswatch cubre todo lo que toca al proveedor: autenticación,
// transporte, framing NDJSON y normalización. La frontera con el dominio la
// marca Normalize, que es lo único que sale de aquí hacia la persistencia.
package barentswatch

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// DefaultMaxBufferBytes limita lo que puede ocupar una línea sin terminar.
// Sin este tope, un stream que dejara de emitir saltos de línea haría crecer
// el buffer hasta agotar la memoria del proceso.
const DefaultMaxBufferBytes = 1 << 20

// ParseNDJSON lee mensajes NDJSON de r y entrega cada uno a onMessage.
//
// El stream llega troceado por la red sin ninguna relación con las fronteras
// de los objetos JSON: un chunk puede cortar un objeto por la mitad y otro
// traer dos y medio. bufio.Scanner reensambla por líneas, que es justo el
// marco que define NDJSON.
//
// Las líneas vacías se ignoran en lugar de tratarse como error: el proveedor
// las usa como keepalive.
//
// Devuelve nil cuando el stream termina de forma ordenada. Un error de
// onMessage interrumpe la lectura y se propaga tal cual.
func ParseNDJSON(r io.Reader, maxBufferBytes int, onMessage func(json.RawMessage) error) error {
	if maxBufferBytes <= 0 {
		maxBufferBytes = DefaultMaxBufferBytes
	}

	// El buffer inicial no puede pasarse del tope: Scanner solo comprueba
	// ErrTooLong cuando necesita crecer, así que un buffer de partida mayor
	// que maxBufferBytes admitiría líneas que el tope debía rechazar.
	initial := 64 * 1024
	if maxBufferBytes < initial {
		initial = maxBufferBytes
	}

	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, initial), maxBufferBytes)

	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}

		// Scanner reutiliza su buffer en la pasada siguiente, así que entregar
		// scanner.Bytes() dejaría al consumidor con memoria que cambia bajo
		// sus pies en cuanto guarde el payload crudo.
		message := make(json.RawMessage, len(line))
		copy(message, line)

		if !json.Valid(message) {
			return fmt.Errorf("barentswatch: línea NDJSON con JSON inválido")
		}
		if err := onMessage(message); err != nil {
			return err
		}
	}

	if err := scanner.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) {
			return fmt.Errorf("barentswatch: línea NDJSON por encima de %d bytes", maxBufferBytes)
		}
		return err
	}
	return nil
}
