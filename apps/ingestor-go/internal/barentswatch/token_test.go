package barentswatch

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// tokenServer devuelve un servidor que cuenta peticiones y entrega tokens
// numerados, para poder distinguir una renovación de una reutilización.
func tokenServer(t *testing.T, expiresIn int64) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var requests atomic.Int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := requests.Add(1)
		if err := r.ParseForm(); err != nil {
			t.Errorf("el cuerpo no se pudo leer: %v", err)
		}
		if got := r.PostForm.Get("grant_type"); got != "client_credentials" {
			t.Errorf("grant_type = %q", got)
		}
		w.Header().Set("content-type", "application/json")
		fmt.Fprintf(w, `{"access_token":"token-%d","expires_in":%d,"token_type":"Bearer"}`, count, expiresIn)
	}))
	t.Cleanup(server.Close)
	return server, &requests
}

func TestTokenManagerReusesCachedToken(t *testing.T) {
	server, requests := tokenServer(t, 3600)
	manager := NewTokenManager(server.URL, "id", "secret", "ais", nil)

	for i := 0; i < 3; i++ {
		token, err := manager.Token(context.Background())
		if err != nil {
			t.Fatalf("Token devolvió error: %v", err)
		}
		if token != "token-1" {
			t.Fatalf("token = %q, se esperaba el cacheado", token)
		}
	}

	if got := requests.Load(); got != 1 {
		t.Errorf("peticiones de token = %d, se esperaba 1", got)
	}
}

// Un token que caduca dentro del margen de renovación no se reutiliza: pedirlo
// de nuevo es más barato que comerse un 401 a mitad de stream.
func TestTokenManagerRefreshesInsideMargin(t *testing.T) {
	server, requests := tokenServer(t, 30)
	manager := NewTokenManager(server.URL, "id", "secret", "ais", nil)

	if _, err := manager.Token(context.Background()); err != nil {
		t.Fatalf("Token devolvió error: %v", err)
	}
	token, err := manager.Token(context.Background())
	if err != nil {
		t.Fatalf("Token devolvió error: %v", err)
	}

	if token != "token-2" {
		t.Errorf("token = %q, se esperaba uno renovado", token)
	}
	if got := requests.Load(); got != 2 {
		t.Errorf("peticiones de token = %d, se esperaba 2", got)
	}
}

func TestTokenManagerInvalidateForcesRefresh(t *testing.T) {
	server, requests := tokenServer(t, 3600)
	manager := NewTokenManager(server.URL, "id", "secret", "ais", nil)

	if _, err := manager.Token(context.Background()); err != nil {
		t.Fatalf("Token devolvió error: %v", err)
	}
	manager.Invalidate()
	token, err := manager.Token(context.Background())
	if err != nil {
		t.Fatalf("Token devolvió error: %v", err)
	}

	if token != "token-2" {
		t.Errorf("token = %q, se esperaba uno nuevo tras invalidar", token)
	}
	if got := requests.Load(); got != 2 {
		t.Errorf("peticiones de token = %d, se esperaba 2", got)
	}
}

// El cuerpo de un error de token puede repetir el client_secret enviado, así
// que el mensaje solo debe llevar el código de estado.
func TestTokenManagerErrorOmitsResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":"invalid_client","client_secret":"super-secreto"}`)
	}))
	defer server.Close()

	manager := NewTokenManager(server.URL, "id", "super-secreto", "ais", nil)
	_, err := manager.Token(context.Background())

	if err == nil {
		t.Fatal("se esperaba un error")
	}
	if !strings.Contains(err.Error(), "HTTP 401") {
		t.Errorf("el error debería nombrar el código: %v", err)
	}
	if strings.Contains(err.Error(), "super-secreto") {
		t.Errorf("el error filtra la credencial: %v", err)
	}
}

func TestTokenManagerRejectsIncompleteResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"token_type":"Bearer"}`)
	}))
	defer server.Close()

	manager := NewTokenManager(server.URL, "id", "secret", "ais", nil)
	if _, err := manager.Token(context.Background()); err == nil {
		t.Fatal("se esperaba un error por respuesta incompleta")
	}
}
