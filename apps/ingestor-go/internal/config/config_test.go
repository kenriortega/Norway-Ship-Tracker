package config

import (
	"testing"
	"time"
)

// withRequired deja el entorno con lo mínimo para que Load tenga éxito.
func withRequired(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("BARENTSWATCH_CLIENT_ID", "id")
	t.Setenv("BARENTSWATCH_CLIENT_SECRET", "secret")
}

func TestLoadDefaults(t *testing.T) {
	withRequired(t)

	settings, err := Load()
	if err != nil {
		t.Fatalf("Load devolvió error: %v", err)
	}

	if settings.Scope != "ais" {
		t.Errorf("scope = %q", settings.Scope)
	}
	if settings.HistoryRetentionDays != 3 || settings.PartitionAheadDays != 2 {
		t.Errorf("retención = %d/%d, se esperaba 3/2",
			settings.HistoryRetentionDays, settings.PartitionAheadDays)
	}
	if settings.HistorySampleSeconds != 60 {
		t.Errorf("muestreo = %d", settings.HistorySampleSeconds)
	}
	if settings.MaintenanceInterval != 30*time.Minute {
		t.Errorf("intervalo = %v", settings.MaintenanceInterval)
	}
	if settings.InitialBackoff != time.Second || settings.MaxBackoff != 30*time.Second {
		t.Errorf("retrocesos = %v/%v", settings.InitialBackoff, settings.MaxBackoff)
	}
	if settings.HealthPort != 3001 {
		t.Errorf("puerto = %d", settings.HealthPort)
	}
	// El snapshot va activado salvo que se diga exactamente "false".
	if !settings.BootstrapSnapshot {
		t.Error("el snapshot debería venir activado por defecto")
	}
}

func TestLoadRequiresCredentials(t *testing.T) {
	for _, missing := range []string{"DATABASE_URL", "BARENTSWATCH_CLIENT_ID", "BARENTSWATCH_CLIENT_SECRET"} {
		t.Run(missing, func(t *testing.T) {
			withRequired(t)
			t.Setenv(missing, "")

			if _, err := Load(); err == nil {
				t.Errorf("se esperaba un error por %s ausente", missing)
			}
		})
	}
}

// Un cero o un negativo es un error de configuración, no una petición de usar
// el valor por defecto: tratarlo así escondería que alguien quiso otra cosa.
func TestLoadRejectsNonPositiveIntegers(t *testing.T) {
	for _, value := range []string{"0", "-1", "tres", "3.5"} {
		t.Run(value, func(t *testing.T) {
			withRequired(t)
			t.Setenv("AIS_HISTORY_RETENTION_DAYS", value)

			if _, err := Load(); err == nil {
				t.Errorf("se esperaba un error con AIS_HISTORY_RETENTION_DAYS=%q", value)
			}
		})
	}
}

func TestLoadBootstrapSnapshotOnlyDisabledByExactFalse(t *testing.T) {
	cases := map[string]bool{"false": false, "true": true, "FALSE": true, "0": true, "": true}

	for value, expected := range cases {
		t.Run("valor="+value, func(t *testing.T) {
			withRequired(t)
			t.Setenv("AIS_BOOTSTRAP_SNAPSHOT", value)

			settings, err := Load()
			if err != nil {
				t.Fatalf("Load devolvió error: %v", err)
			}
			if settings.BootstrapSnapshot != expected {
				t.Errorf("snapshot = %v, se esperaba %v", settings.BootstrapSnapshot, expected)
			}
		})
	}
}

func TestLoadOverridesFromEnvironment(t *testing.T) {
	withRequired(t)
	t.Setenv("AIS_HISTORY_RETENTION_DAYS", "7")
	t.Setenv("AIS_MAINTENANCE_INTERVAL_MINUTES", "5")
	t.Setenv("BARENTSWATCH_SCOPE", "ais-extended")

	settings, err := Load()
	if err != nil {
		t.Fatalf("Load devolvió error: %v", err)
	}
	if settings.HistoryRetentionDays != 7 {
		t.Errorf("retención = %d", settings.HistoryRetentionDays)
	}
	if settings.MaintenanceInterval != 5*time.Minute {
		t.Errorf("intervalo = %v", settings.MaintenanceInterval)
	}
	if settings.Scope != "ais-extended" {
		t.Errorf("scope = %q", settings.Scope)
	}
}

func TestLoadProbeDefaultsWithoutCredentials(t *testing.T) {
	// La sonda no debe exigir nada de lo que exige Load.
	t.Setenv("DATABASE_URL", "")
	t.Setenv("BARENTSWATCH_CLIENT_ID", "")
	t.Setenv("BARENTSWATCH_CLIENT_SECRET", "")
	t.Setenv("HEALTH_PORT", "")
	t.Setenv("HEALTH_MAX_SILENCE_SECONDS", "")

	probe, err := LoadProbe()
	if err != nil {
		t.Fatalf("LoadProbe devolvió error: %v", err)
	}
	if probe.HealthPort != 3001 {
		t.Errorf("puerto = %d", probe.HealthPort)
	}
	if probe.MaxSilence != 300*time.Second {
		t.Errorf("silencio máximo = %v", probe.MaxSilence)
	}
}

func TestLoadProbeOverridesFromEnvironment(t *testing.T) {
	t.Setenv("HEALTH_PORT", "4010")
	t.Setenv("HEALTH_MAX_SILENCE_SECONDS", "90")

	probe, err := LoadProbe()
	if err != nil {
		t.Fatalf("LoadProbe devolvió error: %v", err)
	}
	if probe.HealthPort != 4010 || probe.MaxSilence != 90*time.Second {
		t.Errorf("sonda = %+v", probe)
	}
}

func TestLoadProbeRejectsNonPositiveIntegers(t *testing.T) {
	for _, name := range []string{"HEALTH_PORT", "HEALTH_MAX_SILENCE_SECONDS"} {
		for _, value := range []string{"0", "-5", "abc"} {
			t.Run(name+"="+value, func(t *testing.T) {
				t.Setenv(name, value)

				if _, err := LoadProbe(); err == nil {
					t.Errorf("se esperaba un error por %s=%s", name, value)
				}
			})
		}
	}
}
