package barentswatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/kenriortega/Norway-Ship-Tracker/apps/ingestor-go/internal/domain"
)

// StreamCallbacks recoge lo que el ingestor quiere saber del transporte. Se
// pasan como funciones y no como interfaz para que el llamante declare solo lo
// que le interesa; las que falten se ignoran.
type StreamCallbacks struct {
	OnConnected      func()
	OnDisconnected   func()
	OnInvalidMessage func()
	OnReconnect      func()
	OnError          func(error)
	// OnUpdate persiste la posición. Su error aborta la lectura del stream y
	// dispara una reconexión: si la base no acepta escrituras, seguir leyendo
	// solo tiraría mensajes que no podemos guardar.
	OnUpdate func(*domain.VesselUpdate) error
}

func (c StreamCallbacks) connected() {
	if c.OnConnected != nil {
		c.OnConnected()
	}
}

func (c StreamCallbacks) disconnected() {
	if c.OnDisconnected != nil {
		c.OnDisconnected()
	}
}

func (c StreamCallbacks) invalidMessage() {
	if c.OnInvalidMessage != nil {
		c.OnInvalidMessage()
	}
}

func (c StreamCallbacks) reconnect() {
	if c.OnReconnect != nil {
		c.OnReconnect()
	}
}

func (c StreamCallbacks) failed(err error) {
	if c.OnError != nil {
		c.OnError(err)
	}
}

func (c StreamCallbacks) update(value *domain.VesselUpdate) error {
	if c.OnUpdate == nil {
		return nil
	}
	return c.OnUpdate(value)
}

// StreamOptions configura el transporte del proveedor.
type StreamOptions struct {
	StreamURL      string
	LatestURL      string
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
	MaxLineBytes   int
}

// Client habla con el proveedor: pide el snapshot inicial y sostiene el stream.
type Client struct {
	tokens  *TokenManager
	options StreamOptions
	// Dos clientes HTTP a propósito. El del stream no puede llevar Timeout:
	// en Go ese plazo cubre también la lectura del cuerpo, así que cortaría
	// una conexión sana a los pocos minutos. El límite que sí tiene es
	// ResponseHeaderTimeout, que protege el establecimiento sin tocar la
	// lectura. El del snapshot es una petición corta y sí lleva plazo total.
	streamClient   *http.Client
	snapshotClient *http.Client
}

func NewClient(tokens *TokenManager, options StreamOptions) *Client {
	if options.MaxLineBytes <= 0 {
		options.MaxLineBytes = DefaultMaxBufferBytes
	}
	return &Client{
		tokens:         tokens,
		options:        options,
		snapshotClient: &http.Client{Timeout: 2 * time.Minute},
		streamClient: &http.Client{
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				ResponseHeaderTimeout: 30 * time.Second,
				IdleConnTimeout:       90 * time.Second,
			},
		},
	}
}

// authorizedGet hace la petición con el token vigente. Un 401 invalida el
// token en memoria para que el intento siguiente pida uno nuevo.
func (c *Client) authorizedGet(ctx context.Context, client *http.Client, url string) (*http.Response, error) {
	token, err := c.tokens.Token(ctx)
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("barentswatch: no se pudo construir la petición: %w", err)
	}
	request.Header.Set("authorization", "Bearer "+token)

	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusUnauthorized {
		c.tokens.Invalidate()
	}
	return response, nil
}

// IngestLatestSnapshot carga de una vez la última posición conocida de cada
// barco, para que el mapa tenga contenido desde el primer momento en lugar de
// irse llenando según reporte cada uno.
//
// Todas las posiciones comparten el instante de recepción: llegaron juntas, y
// darles marcas distintas fingiría un escalonado que no existió.
func (c *Client) IngestLatestSnapshot(ctx context.Context, callbacks StreamCallbacks) (int, error) {
	response, err := c.authorizedGet(ctx, c.snapshotClient, c.options.LatestURL)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("barentswatch: el snapshot devolvió HTTP %d", response.StatusCode)
	}

	var payload []json.RawMessage
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return 0, fmt.Errorf("barentswatch: el snapshot no devolvió una lista: %w", err)
	}

	accepted := 0
	receivedAt := time.Now().UTC()
	for _, raw := range payload {
		update, ok := Normalize(raw, receivedAt)
		if !ok {
			callbacks.invalidMessage()
			continue
		}
		if err := callbacks.update(update); err != nil {
			return accepted, err
		}
		accepted++
	}
	return accepted, nil
}

// RunLiveStream sostiene el stream hasta que se cancele el contexto,
// reconectando con retroceso exponencial.
//
// El retroceso se reinicia en cada conexión buena: si no, una racha de cortes
// espaciados acabaría esperando el máximo aunque entre ellos el stream hubiera
// funcionado durante horas.
//
// Devuelve el error del contexto cuando para por cancelación, que es la
// salida esperada.
func (c *Client) RunLiveStream(ctx context.Context, callbacks StreamCallbacks) error {
	initial := c.options.InitialBackoff
	if initial <= 0 {
		initial = time.Second
	}
	maxBackoff := c.options.MaxBackoff
	if maxBackoff < initial {
		maxBackoff = initial
	}
	backoff := initial

	for attempt := 0; ctx.Err() == nil; attempt++ {
		if attempt > 0 {
			callbacks.reconnect()
		}

		err := c.consume(ctx, callbacks, func() { backoff = initial })
		if ctx.Err() != nil {
			break
		}

		callbacks.disconnected()
		callbacks.failed(err)

		if !sleep(ctx, backoff) {
			break
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
	return ctx.Err()
}

// consume abre una conexión y la lee hasta que falla o termina. Que el stream
// termine por sí solo es un error: es un flujo sin fin, así que un final
// ordenado significa que el proveedor cortó.
func (c *Client) consume(ctx context.Context, callbacks StreamCallbacks, onConnected func()) error {
	response, err := c.authorizedGet(ctx, c.streamClient, c.options.StreamURL)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("barentswatch: el stream devolvió HTTP %d", response.StatusCode)
	}

	onConnected()
	callbacks.connected()

	err = ParseNDJSON(response.Body, c.options.MaxLineBytes, func(raw json.RawMessage) error {
		update, ok := Normalize(raw, time.Now().UTC())
		if !ok {
			callbacks.invalidMessage()
			return nil
		}
		return callbacks.update(update)
	})
	if err != nil {
		return err
	}
	return errors.New("barentswatch: el stream terminó de forma inesperada")
}

// sleep espera d respetando la cancelación. Devuelve false si el contexto se
// canceló mientras esperaba.
func sleep(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
