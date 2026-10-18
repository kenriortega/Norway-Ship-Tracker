import type { VesselFeatureProperties } from "@/lib/vessels";
import { isVesselCategory, VESSEL_CATEGORY_LABELS } from "@/lib/vessel-types";

function formatSpeed(speedOverGround: number | null): string {
  if (speedOverGround === null) return "—";
  return `${speedOverGround.toLocaleString("es-ES", { maximumFractionDigits: 1 })} nudos`;
}

/**
 * AIS reserva 511 en `trueHeading` y 360 en `courseOverGround` para "no
 * disponible", así que preferimos el rumbo real y caemos al rumbo sobre el
 * fondo solo cuando el primero falta.
 */
function formatHeading(properties: VesselFeatureProperties): string {
  const { trueHeading, courseOverGround } = properties;

  if (trueHeading !== null && trueHeading >= 0 && trueHeading < 360) {
    return `${Math.round(trueHeading)}°`;
  }

  if (courseOverGround !== null && courseOverGround >= 0 && courseOverGround < 360) {
    return `${Math.round(courseOverGround)}° (sobre el fondo)`;
  }

  return "—";
}

function formatTimestamp(isoTimestamp: string | null): string {
  if (isoTimestamp === null) return "—";

  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// El nombre llega del AIS abierto, así que lo tratamos como texto no confiable
// antes de insertarlo en el HTML del popup.
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRow(label: string, value: string): string {
  return `<div class="flex items-baseline justify-between gap-4"><dt class="text-slate-400">${label}</dt><dd class="font-medium text-slate-100">${escapeHtml(value)}</dd></div>`;
}

export function renderVesselPopup(properties: VesselFeatureProperties): string {
  return [
    '<div class="min-w-[13rem] space-y-2 text-xs">',
    `<p class="text-sm font-semibold text-cyan-300">${escapeHtml(properties.name)}</p>`,
    '<dl class="space-y-1">',
    renderRow("MMSI", String(properties.mmsi)),
    renderRow("Tipo", VESSEL_CATEGORY_LABELS[properties.category]),
    renderRow("Velocidad", formatSpeed(properties.speedOverGround)),
    renderRow("Rumbo", formatHeading(properties)),
    renderRow("Última posición", formatTimestamp(properties.observedAt)),
    "</dl>",
    "</div>",
  ].join("");
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * MapLibre devuelve las propiedades de la feature como un objeto plano sin
 * tipar y puede omitir las claves nulas, así que las normalizamos antes de
 * pintarlas.
 */
export function readVesselProperties(
  raw: Record<string, unknown> | null,
): VesselFeatureProperties | null {
  if (raw === null) return null;

  const mmsi = readNumber(raw.mmsi);
  if (mmsi === null) return null;

  return {
    mmsi,
    name: typeof raw.name === "string" ? raw.name : `MMSI ${mmsi}`,
    shipType: readNumber(raw.shipType),
    category: isVesselCategory(raw.category) ? raw.category : "unknown",
    speedOverGround: readNumber(raw.speedOverGround),
    courseOverGround: readNumber(raw.courseOverGround),
    trueHeading: readNumber(raw.trueHeading),
    observedAt: typeof raw.observedAt === "string" ? raw.observedAt : null,
  };
}
