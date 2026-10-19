import type { VesselStatsResponse } from "@norway-ship-tracker/domain";

/**
 * Los agregados cambian despacio comparados con las posiciones, así que el
 * panel se refresca cada minuto en lugar de seguir el ritmo del mapa.
 */
export const STATS_REFRESH_INTERVAL_MS = 60_000;

export async function fetchVesselStats(signal: AbortSignal): Promise<VesselStatsResponse> {
  const response = await fetch("/api/stats", { signal, cache: "no-store" });

  if (!response.ok) {
    throw new Error(`La API respondió ${response.status}`);
  }

  return (await response.json()) as VesselStatsResponse;
}
