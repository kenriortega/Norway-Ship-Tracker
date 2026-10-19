import type { VesselBreakdownRow, VesselStatsResponse } from "@norway-ship-tracker/domain";

import {
  categorizeShipType,
  VESSEL_CATEGORY_LABELS,
  type VesselCategory,
} from "./vessel-types";

/**
 * Etiquetas del campo "Navigational status" del mensaje AIS. Los códigos 9 a
 * 14 están reservados o son para transpondedores de emergencia y apenas
 * aparecen, así que se pliegan en "Otros" al construir el panel.
 */
const NAVIGATIONAL_STATUS_LABELS: Record<number, string> = {
  0: "En ruta",
  1: "Fondeado",
  2: "Sin gobierno",
  3: "Maniobra limitada",
  4: "Por calado",
  5: "Atracado",
  6: "Varado",
  7: "Faenando",
  8: "A vela",
  15: "Sin definir",
};

/** Código AIS de "engaged in fishing", el que distingue a la flota pesquera. */
const FISHING_STATUS = 7;

export interface CategorySlice {
  category: VesselCategory;
  label: string;
  vessels: number;
  moving: number;
  averageSpeed: number | null;
}

export interface StatusSlice {
  label: string;
  vessels: number;
}

export interface DashboardView {
  totalVessels: number;
  movingVessels: number;
  fishingVessels: number;
  freshVessels: number;
  categories: CategorySlice[];
  statuses: StatusSlice[];
}

/**
 * Media ponderada: cada fila aporta su velocidad media por el número de barcos
 * que la respaldan, así que una fila de dos barcos no pesa como una de
 * seiscientos.
 */
function weightedAverage(rows: VesselBreakdownRow[]): number | null {
  let weightedSum = 0;
  let weight = 0;

  for (const row of rows) {
    if (row.averageSpeed === null || row.moving === 0) continue;
    weightedSum += row.averageSpeed * row.moving;
    weight += row.moving;
  }

  return weight === 0 ? null : weightedSum / weight;
}

export function buildDashboardView(stats: VesselStatsResponse): DashboardView {
  const byCategory = new Map<VesselCategory, VesselBreakdownRow[]>();
  const byStatus = new Map<string, number>();
  let fishingVessels = 0;

  for (const row of stats.breakdown) {
    const category = categorizeShipType(row.shipType);
    const rows = byCategory.get(category);
    if (rows === undefined) {
      byCategory.set(category, [row]);
    } else {
      rows.push(row);
    }

    const label =
      row.navigationalStatus === null
        ? "Sin definir"
        : (NAVIGATIONAL_STATUS_LABELS[row.navigationalStatus] ?? "Otros");
    byStatus.set(label, (byStatus.get(label) ?? 0) + row.vessels);

    if (row.navigationalStatus === FISHING_STATUS) {
      fishingVessels += row.vessels;
    }
  }

  const categories: CategorySlice[] = [...byCategory.entries()]
    .map(([category, rows]) => ({
      category,
      label: VESSEL_CATEGORY_LABELS[category],
      vessels: rows.reduce((sum, row) => sum + row.vessels, 0),
      moving: rows.reduce((sum, row) => sum + row.moving, 0),
      averageSpeed: weightedAverage(rows),
    }))
    .sort((left, right) => right.vessels - left.vessels);

  const statuses: StatusSlice[] = [...byStatus.entries()]
    .map(([label, vessels]) => ({ label, vessels }))
    .sort((left, right) => right.vessels - left.vessels);

  return {
    totalVessels: stats.totalVessels,
    movingVessels: stats.movingVessels,
    fishingVessels,
    freshVessels: stats.freshness.underFiveMinutes,
    categories,
    statuses,
  };
}

/** 65.0 / 11.5 se lee mucho mejor como 65,0°N 11,5°E. */
export function formatCoordinates(longitude: number, latitude: number): string {
  const latitudeText = `${Math.abs(latitude).toLocaleString("es-ES", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}°${latitude >= 0 ? "N" : "S"}`;
  const longitudeText = `${Math.abs(longitude).toLocaleString("es-ES", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}°${longitude >= 0 ? "E" : "O"}`;

  return `${latitudeText} ${longitudeText}`;
}
