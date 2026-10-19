import { applyHistoryRetention, type DatabaseConnection, type RetentionResult } from "@norway-ship-tracker/db";

export interface MaintenanceCallbacks {
  onResult(result: RetentionResult): void;
  onError(error: unknown): void;
}

export interface MaintenanceSchedule {
  /** Detiene el ciclo y espera a que termine la pasada en curso, si la hay. */
  stop(): Promise<void>;
}

export interface MaintenanceOptions {
  intervalMs: number;
  run: () => Promise<RetentionResult>;
  callbacks: MaintenanceCallbacks;
}

/**
 * Ejecuta el mantenimiento del histórico al arrancar y después cada
 * `intervalMs`.
 *
 * Vive en el worker y no en un cron del sistema ni en `pg_cron` por dos
 * razones. La imagen `postgis/postgis:16-3.5` no trae `pg_cron`, así que
 * programarlo dentro de Postgres obligaría a mantener una imagen propia. Y un
 * cron externo sería una pieza fuera del repositorio, invisible para
 * `compose.yaml`. El worker ya es un proceso persistente con conexión a la
 * base: si está caído tampoco entra nada que purgar.
 *
 * Un fallo no interrumpe el ciclo: se avisa y se reintenta en la pasada
 * siguiente. Quedarse sin particiones futuras tarda días en volverse un
 * problema, así que no hay razón para tumbar la ingestión por ello.
 */
export function startHistoryMaintenance(options: MaintenanceOptions): MaintenanceSchedule {
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const tick = (): void => {
    if (stopped) return;

    running = (async () => {
      try {
        options.callbacks.onResult(await options.run());
      } catch (error) {
        options.callbacks.onError(error);
      }
    })();
  };

  tick();
  const timer = setInterval(tick, options.intervalMs);
  // El mantenimiento no es razón para que el proceso siga vivo.
  timer.unref?.();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

export interface HistoryMaintenanceOptions {
  database: DatabaseConnection;
  retentionDays: number;
  aheadDays: number;
  intervalMinutes: number;
  callbacks: MaintenanceCallbacks;
}

export function startDatabaseHistoryMaintenance(
  options: HistoryMaintenanceOptions,
): MaintenanceSchedule {
  return startHistoryMaintenance({
    intervalMs: options.intervalMinutes * 60_000,
    run: () =>
      applyHistoryRetention(options.database, {
        retentionDays: options.retentionDays,
        aheadDays: options.aheadDays,
      }),
    callbacks: options.callbacks,
  });
}
