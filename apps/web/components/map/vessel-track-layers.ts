import type { AddLayerObject, MapLibreMap } from "maplibre-gl";

import { EMPTY_TRACK_COLLECTION } from "@/lib/vessel-track";

export const TRACK_SOURCE_ID = "vessel-track";
export const TRACK_CASING_LAYER_ID = "vessel-track-casing";
export const TRACK_LINE_LAYER_ID = "vessel-track-line";
export const TRACK_ARROW_LAYER_ID = "vessel-track-arrows";

type LineLayer = Extract<AddLayerObject, { type: "line" }>;
type SymbolLayer = Extract<AddLayerObject, { type: "symbol" }>;
type WidthExpression = NonNullable<LineLayer["paint"]>["line-width"];

const CASING_WIDTH: WidthExpression = ["interpolate", ["linear"], ["zoom"], 4, 2.4, 10, 5.5];
const LINE_WIDTH: WidthExpression = ["interpolate", ["linear"], ["zoom"], 4, 1.2, 10, 3];

/**
 * El degradado recorre el tramo de lo más antiguo (gris casi transparente) a
 * lo más reciente (azul), que es el mismo azul del barco en movimiento. Como
 * `line-progress` se reinicia en cada feature, el degradado se lee por tramo:
 * a cambio no inventamos una recta sobre los huecos de cobertura.
 */
const AGE_GRADIENT: NonNullable<LineLayer["paint"]>["line-gradient"] = [
  "interpolate",
  ["linear"],
  ["line-progress"],
  0,
  "rgba(133, 199, 255, 0.45)",
  0.6,
  "rgba(133, 199, 255, 0.8)",
  1,
  "#85c7ff",
];

/**
 * Añade el recorrido por debajo de `beforeId` (la capa de puntos): así los
 * barcos quedan siempre encima y la línea no entra en `queryRenderedFeatures`,
 * que solo consulta las capas interactivas.
 */
export function addVesselTrackLayers(
  map: MapLibreMap,
  arrowIconId: string,
  beforeId: string,
): void {
  map.addSource(TRACK_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_TRACK_COLLECTION,
    // Imprescindible para `line-gradient`: sin métricas de línea MapLibre no
    // sabe calcular `line-progress`.
    lineMetrics: true,
  });

  const casing: LineLayer = {
    id: TRACK_CASING_LAYER_ID,
    type: "line",
    source: TRACK_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#06202f",
      "line-opacity": 0.65,
      "line-width": CASING_WIDTH,
    },
  };

  const line: LineLayer = {
    id: TRACK_LINE_LAYER_ID,
    type: "line",
    source: TRACK_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-gradient": AGE_GRADIENT,
      "line-width": LINE_WIDTH,
    },
  };

  // La flecha del icono apunta al norte, pero con `symbol-placement: "line"`
  // MapLibre la alinea con la dirección de avance tomando el este como 0°, así
  // que hay que girarla un cuarto de vuelta para que mire hacia la proa.
  const arrows: SymbolLayer = {
    id: TRACK_ARROW_LAYER_ID,
    type: "symbol",
    source: TRACK_SOURCE_ID,
    minzoom: 6,
    layout: {
      "icon-image": arrowIconId,
      "icon-rotate": 90,
      "icon-rotation-alignment": "map",
      "symbol-placement": "line",
      "symbol-spacing": 70,
      "icon-size": 0.8,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      // Flecha oscura recortada sobre la propia línea: se lee igual de bien
      // sobre el mar oscuro que sobre los fiordos claros de Kartverket, donde
      // una flecha clara desaparecía dentro del trazo.
      "icon-color": "#06202f",
    },
  };

  map.addLayer(casing, beforeId);
  map.addLayer(line, beforeId);
  map.addLayer(arrows, beforeId);
}
