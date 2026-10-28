// Package config lee la configuración del entorno. Mismos nombres de variable
// y mismos valores por defecto que el ingestor de TypeScript, para que los dos
// puedan arrancar con el mismo `.env`.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL  string
	ClientID     string
	ClientSecret string
	Scope        string
	TokenURL     string
	StreamURL    string
	LatestURL    string

	BootstrapSnapshot    bool
	HistorySampleSeconds int
	HistoryRetentionDays int
	PartitionAheadDays   int
	MaintenanceInterval  time.Duration
	InitialBackoff       time.Duration
	MaxBackoff           time.Duration
	HealthPort           int
}

// defaultHealthPort lo comparten Load y LoadProbe: la sonda tiene que consultar
// el mismo puerto en el que el worker abre su /health.
const defaultHealthPort = 3_001

func required(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func withDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

// positiveInteger rechaza el cero y los negativos en lugar de caer al valor
// por defecto: un `AIS_HISTORY_RETENTION_DAYS=0` es un error de configuración,
// y tratarlo como "usa 3" escondería que alguien quiso decir otra cosa.
func positiveInteger(name string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
}

// Load arma la configuración o devuelve el primer error encontrado.
func Load() (Config, error) {
	var config Config
	var err error

	if config.DatabaseURL, err = required("DATABASE_URL"); err != nil {
		return Config{}, err
	}
	if config.ClientID, err = required("BARENTSWATCH_CLIENT_ID"); err != nil {
		return Config{}, err
	}
	if config.ClientSecret, err = required("BARENTSWATCH_CLIENT_SECRET"); err != nil {
		return Config{}, err
	}

	config.Scope = withDefault("BARENTSWATCH_SCOPE", "ais")
	config.TokenURL = withDefault("BARENTSWATCH_TOKEN_URL", "https://id.barentswatch.no/connect/token")
	config.StreamURL = withDefault("BARENTSWATCH_STREAM_URL", "https://live.ais.barentswatch.no/v1/combined")
	config.LatestURL = withDefault("BARENTSWATCH_LATEST_URL", "https://live.ais.barentswatch.no/v1/latest/combined")

	// Cualquier valor que no sea exactamente "false" activa el snapshot, igual
	// que el `!== "false"` del TypeScript.
	config.BootstrapSnapshot = os.Getenv("AIS_BOOTSTRAP_SNAPSHOT") != "false"

	if config.HistorySampleSeconds, err = positiveInteger("AIS_HISTORY_SAMPLE_SECONDS", 60); err != nil {
		return Config{}, err
	}
	// Tres días completos más el día en curso: garantiza al menos 72 h de
	// histórico a cualquier hora, que es el tope que aceptan /api/ports y
	// /api/encounters.
	if config.HistoryRetentionDays, err = positiveInteger("AIS_HISTORY_RETENTION_DAYS", 3); err != nil {
		return Config{}, err
	}
	// Dos días por delante y no solo el siguiente: una parada larga del worker
	// no deja al sistema sin partición donde insertar al cambiar la fecha.
	if config.PartitionAheadDays, err = positiveInteger("AIS_PARTITION_AHEAD_DAYS", 2); err != nil {
		return Config{}, err
	}

	minutes, err := positiveInteger("AIS_MAINTENANCE_INTERVAL_MINUTES", 30)
	if err != nil {
		return Config{}, err
	}
	config.MaintenanceInterval = time.Duration(minutes) * time.Minute

	initialMs, err := positiveInteger("AIS_INITIAL_BACKOFF_MS", 1_000)
	if err != nil {
		return Config{}, err
	}
	config.InitialBackoff = time.Duration(initialMs) * time.Millisecond

	maxMs, err := positiveInteger("AIS_MAX_BACKOFF_MS", 30_000)
	if err != nil {
		return Config{}, err
	}
	config.MaxBackoff = time.Duration(maxMs) * time.Millisecond

	if config.HealthPort, err = positiveInteger("HEALTH_PORT", defaultHealthPort); err != nil {
		return Config{}, err
	}

	return config, nil
}

// ProbeConfig es lo que necesita el subcomando de sonda. Aparte de Load()
// porque la sonda no habla con la base ni con BarentsWatch: pedirle
// DATABASE_URL para consultar un endpoint local la haría fallar por una razón
// que no tiene nada que ver con la salud del worker.
type ProbeConfig struct {
	HealthPort int
	MaxSilence time.Duration
}

// LoadProbe lee solo el puerto de salud y el silencio máximo tolerado entre
// dos mensajes. HEALTH_MAX_SILENCE_SECONDS queda junto a HEALTH_PORT y fuera de
// la familia AIS_*, que es la que se comparte con el ingestor de TypeScript.
func LoadProbe() (ProbeConfig, error) {
	var probe ProbeConfig
	var err error

	if probe.HealthPort, err = positiveInteger("HEALTH_PORT", defaultHealthPort); err != nil {
		return ProbeConfig{}, err
	}
	seconds, err := positiveInteger("HEALTH_MAX_SILENCE_SECONDS", 300)
	if err != nil {
		return ProbeConfig{}, err
	}
	probe.MaxSilence = time.Duration(seconds) * time.Second

	return probe, nil
}
