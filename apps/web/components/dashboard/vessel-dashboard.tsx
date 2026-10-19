"use client";

import type { VesselStatsResponse } from "@norway-ship-tracker/domain";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchVesselStats, STATS_REFRESH_INTERVAL_MS } from "@/lib/stats";
import { buildDashboardView } from "@/lib/stats-view";

import {
  ActivityPanel,
  CategoryPanel,
  FreshnessPanel,
  StatTiles,
  StatusPanel,
  TrafficPanel,
} from "./dashboard-panels";

type Status = "loading" | "ready" | "error";

export function VesselDashboard() {
  const [stats, setStats] = useState<VesselStatsResponse | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function load() {
      try {
        const payload = await fetchVesselStats(controller.signal);
        if (cancelled) return;
        setStats(payload);
        setErrorMessage(null);
        setStatus("ready");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setErrorMessage(error instanceof Error ? error.message : "Error desconocido");
        setStatus("error");
      }
    }

    function tick() {
      if (document.visibilityState === "visible") void load();
    }

    void load();
    interval = setInterval(tick, STATS_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      cancelled = true;
      controller.abort();
      if (interval !== null) clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reloadToken]);

  const view = useMemo(() => (stats === null ? null : buildDashboardView(stats)), [stats]);

  const retry = useCallback(() => {
    setStatus("loading");
    setErrorMessage(null);
    setReloadToken((token) => token + 1);
  }, []);

  if (status === "error") {
    return (
      <section aria-label="Métricas de la flota" role="alert" className="rounded-2xl border border-red-300/60 bg-red-50 p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-red-900">
          <AlertTriangle className="size-4" aria-hidden="true" />
          No se pudieron cargar las métricas
        </p>
        <p className="mt-1 text-xs leading-5 text-red-800">{errorMessage}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-900 transition hover:bg-red-100"
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (view === null || stats === null) {
    return (
      <section
        aria-label="Métricas de la flota"
        aria-busy="true"
        className="flex items-center gap-2 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Cargando métricas…
      </section>
    );
  }

  return (
    <section aria-label="Métricas de la flota" className="flex flex-col gap-4">
      <StatTiles
        tiles={[
          { label: "Embarcaciones", value: view.totalVessels, hint: "Con posición conocida" },
          { label: "Navegando", value: view.movingVessels, hint: "Por encima de 0,5 nudos" },
          { label: "Faenando", value: view.fishingVessels, hint: "Estado AIS de pesca" },
          { label: "Dato reciente", value: view.freshVessels, hint: "Visto hace menos de 5 min" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryPanel categories={view.categories} />
        <StatusPanel statuses={view.statuses} />
        <ActivityPanel activity={stats.activity} />
        <TrafficPanel traffic={stats.traffic} />
      </div>

      <FreshnessPanel freshness={stats.freshness} coverage={stats.coverage} />
    </section>
  );
}
