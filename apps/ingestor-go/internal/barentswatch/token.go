package barentswatch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Margen con el que se renueva el token antes de que caduque. Sin él, un token
// que expira entre la comprobación y la llegada de la petición al proveedor
// provocaría un 401 evitable.
const tokenRefreshMargin = time.Minute

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int64  `json:"expires_in"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
}

// TokenManager mantiene el token de cliente del proveedor y lo renueva cuando
// se acerca su caducidad.
//
// El mutex se sostiene durante la petición HTTP a propósito: si varios
// llamantes se encuentran con el token caducado a la vez, solo uno pide uno
// nuevo y el resto espera a reutilizarlo, en lugar de abrir una petición de
// token por cada uno.
type TokenManager struct {
	tokenURL     string
	clientID     string
	clientSecret string
	scope        string
	httpClient   *http.Client

	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

func NewTokenManager(tokenURL, clientID, clientSecret, scope string, httpClient *http.Client) *TokenManager {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &TokenManager{
		tokenURL:     tokenURL,
		clientID:     clientID,
		clientSecret: clientSecret,
		scope:        scope,
		httpClient:   httpClient,
	}
}

// Invalidate descarta el token en memoria para que la próxima llamada pida uno
// nuevo. Lo usa el cliente al recibir un 401: el proveedor puede revocar un
// token antes de su caducidad declarada, y sin esto el ingestor reintentaría
// en bucle con una credencial muerta.
func (m *TokenManager) Invalidate() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.accessToken = ""
	m.expiresAt = time.Time{}
}

// Token devuelve un token vigente, pidiendo uno nuevo si hace falta.
func (m *TokenManager) Token(ctx context.Context) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.accessToken != "" && time.Now().Before(m.expiresAt.Add(-tokenRefreshMargin)) {
		return m.accessToken, nil
	}

	form := url.Values{
		"client_id":     {m.clientID},
		"client_secret": {m.clientSecret},
		"scope":         {m.scope},
		"grant_type":    {"client_credentials"},
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, m.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("barentswatch: no se pudo construir la petición de token: %w", err)
	}
	request.Header.Set("content-type", "application/x-www-form-urlencoded")

	response, err := m.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("barentswatch: la petición de token falló: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		// El cuerpo puede repetir el client_secret enviado: solo el código.
		return "", fmt.Errorf("barentswatch: la petición de token devolvió HTTP %d", response.StatusCode)
	}

	var payload tokenResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("barentswatch: la respuesta de token no se pudo leer: %w", err)
	}
	if payload.AccessToken == "" || payload.ExpiresIn <= 0 {
		return "", fmt.Errorf("barentswatch: la respuesta de token no trae los campos obligatorios")
	}

	m.accessToken = payload.AccessToken
	m.expiresAt = time.Now().Add(time.Duration(payload.ExpiresIn) * time.Second)
	return m.accessToken, nil
}
