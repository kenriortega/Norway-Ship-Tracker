"use client";

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState } from "react";

import {
  ANALYSIS_COLORS,
  ANALYSIS_LABELS,
  ANALYSIS_LAYERS,
  EMPTY_ANALYSIS_COLLECTION,
  fetchAnalysisLayer,
  type AnalysisCollection,
  type AnalysisLayer,
} from "@/lib/analysis";

interface AnalysisLayersProps {
  map: MapLibreMap | null;
  isMapReady: boolean;
}

type LayerState = "idle" | "loading" | "ready" | "error";

const FILL_SUFFIX = "-fill";
const LINE_SUFFIX = "-line";
const POINT_SUFFIX = "-point";

/**
 * Las tres lecturas analíticas comparten mecánica: una fuente GeoJSON por capa
 * y dos dibujos, el relleno para los fondeaderos, que son polígonos, y el
 * punto para encuentros y barcos mudos. Viven fuera de `VesselMap` porque ese
 * componente ya carga con el stream, la interpolación y los filtros.
 */
export function AnalysisLayers({ map, isMapReady }: AnalysisLayersProps) {
  const [active, setActive] = useState<ReadonlySet<AnalysisLayer>>(() => new Set());
  const [states, setStates] = useState<Record<string, LayerState>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (map === null || !isMapReady) return;

    const controller = new AbortController();
    const added: string[] = [];

    for (const layer of ANALYSIS_LAYERS) {
      if (!active.has(layer)) continue;
      if (map.getSource(layer) !== undefined) continue;

      map.addSource(layer, { type: "geojson", data: EMPTY_ANALYSIS_COLLECTION });
      added.push(layer);

      if (layer === "ports") {
        map.addLayer({
          id: `${layer}${FILL_SUFFIX}`,
          type: "fill",
          source: layer,
          paint: { "fill-color": ANALYSIS_COLORS[layer], "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: `${layer}${LINE_SUFFIX}`,
          type: "line",
          source: layer,
          paint: { "line-color": ANALYSIS_COLORS[layer], "line-width": 1.2, "line-opacity": 0.65 },
        });
      } else {
        map.addLayer({
          id: `${layer}${POINT_SUFFIX}`,
          type: "circle",
          source: layer,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 8, 7, 12, 11],
            "circle-color": ANALYSIS_COLORS[layer],
            "circle-opacity": 0.28,
            "circle-stroke-color": ANALYSIS_COLORS[layer],
            "circle-stroke-width": 1.6,
          },
        });
      }

      void fetchAnalysisLayer(layer, controller.signal)
        .then((collection: AnalysisCollection) => {
          const source = map.getSource<GeoJSONSource>(layer);
          if (source === undefined) return;
          source.setData(collection);
          setCounts((current) => ({ ...current, [layer]: collection.features.length }));
          setStates((current) => ({ ...current, [layer]: "ready" }));
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setStates((current) => ({ ...current, [layer]: "error" }));
        });
    }

    for (const layer of ANALYSIS_LAYERS) {
      if (active.has(layer)) continue;
      for (const suffix of [FILL_SUFFIX, LINE_SUFFIX, POINT_SUFFIX]) {
        if (map.getLayer(`${layer}${suffix}`) !== undefined) map.removeLayer(`${layer}${suffix}`);
      }
      if (map.getSource(layer) !== undefined) map.removeSource(layer);
    }

    return () => {
      controller.abort();
      // Solo se limpian las capas que este efecto añadió: las que siguen
      // activas las vuelve a gestionar la siguiente pasada.
      for (const layer of added) {
        for (const suffix of [FILL_SUFFIX, LINE_SUFFIX, POINT_SUFFIX]) {
          if (map.getLayer(`${layer}${suffix}`) !== undefined) map.removeLayer(`${layer}${suffix}`);
        }
        if (map.getSource(layer) !== undefined) map.removeSource(layer);
      }
    };
  }, [map, isMapReady, active]);

  function toggle(layer: AnalysisLayer) {
    setActive((current) => {
      const next = new Set(current);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }

  return (
    <div className="absolute right-4 top-16 z-10 w-44 rounded-2xl border border-white/15 bg-black/55 p-3 text-xs text-slate-100 shadow-lg backdrop-blur">
      <p className="mb-2 font-medium">Análisis</p>
      <div className="flex flex-col gap-1.5">
        {ANALYSIS_LAYERS.map((layer) => {
          const isActive = active.has(layer);
          // Una capa recién encendida aún no tiene estado propio: se deriva
          // aquí en vez de escribirlo desde el efecto, que dispara renders en
          // cascada.
          const state = states[layer] ?? "loading";
          return (
            <button
              key={layer}
              type="button"
              onClick={() => toggle(layer)}
              aria-pressed={isActive}
              className={`flex items-center justify-between gap-2 rounded-full border px-2.5 py-1 text-left transition ${
                isActive
                  ? "border-white/40 bg-white/15"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: ANALYSIS_COLORS[layer] }}
                />
                {ANALYSIS_LABELS[layer]}
              </span>
              <span className="text-[10px] text-slate-300">
                {!isActive
                  ? ""
                  : state === "loading"
                    ? "…"
                    : state === "error"
                      ? "error"
                      : (counts[layer] ?? 0)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
