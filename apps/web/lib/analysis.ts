import type {
  DarkVesselsResponse,
  EncountersResponse,
  PortClustersResponse,
} from "@norway-ship-tracker/domain";

/** Las tres lecturas analíticas que se pueden encender sobre el mapa. */
export type AnalysisLayer = "ports" | "encounters" | "dark";

export const ANALYSIS_LAYERS: readonly AnalysisLayer[] = ["ports", "encounters", "dark"];

export const ANALYSIS_LABELS: Record<AnalysisLayer, string> = {
  ports: "Fondeaderos",
  encounters: "Encuentros",
  dark: "Sin emitir",
};

export const ANALYSIS_COLORS: Record<AnalysisLayer, string> = {
  ports: "#38bdf8",
  encounters: "#f97316",
  dark: "#f43f5e",
};

export interface AnalysisProperties {
  layer: AnalysisLayer;
  label: string;
  detail: string;
}

export type AnalysisCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point | GeoJSON.Polygon,
  AnalysisProperties
>;

export const EMPTY_ANALYSIS_COLLECTION: AnalysisCollection = {
  type: "FeatureCollection",
  features: [],
};

const ENDPOINTS: Record<AnalysisLayer, string> = {
  ports: "/api/ports",
  encounters: "/api/encounters",
  dark: "/api/dark",
};

async function readJson<T>(layer: AnalysisLayer, signal: AbortSignal): Promise<T> {
  const response = await fetch(ENDPOINTS[layer], { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`${ANALYSIS_LABELS[layer]} respondió ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Aproxima un círculo de radio en metros como un anillo de puntos. MapLibre
 * dibuja círculos en píxeles, no en metros, así que un fondeadero pintado con
 * `circle-radius` cambiaría de tamaño real con el zoom y dejaría de
 * corresponder al área que ocupa de verdad.
 */
function circlePolygon(
  longitude: number,
  latitude: number,
  radiusMeters: number,
): GeoJSON.Polygon {
  const steps = 48;
  const latitudeDegrees = radiusMeters / 111_320;
  const longitudeDegrees = latitudeDegrees / Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  const ring: GeoJSON.Position[] = [];

  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * 2 * Math.PI;
    ring.push([
      longitude + Math.cos(angle) * longitudeDegrees,
      latitude + Math.sin(angle) * latitudeDegrees,
    ]);
  }

  return { type: "Polygon", coordinates: [ring] };
}

function minutesLabel(minutes: number): string {
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} días`;
}

export async function fetchAnalysisLayer(
  layer: AnalysisLayer,
  signal: AbortSignal,
): Promise<AnalysisCollection> {
  if (layer === "ports") {
    const payload = await readJson<PortClustersResponse>(layer, signal);
    return {
      type: "FeatureCollection",
      features: payload.ports.map((port) => ({
        type: "Feature",
        geometry: circlePolygon(port.longitude, port.latitude, Math.max(port.radiusMeters, 300)),
        properties: {
          layer,
          label: `Fondeadero de ${port.mooredVessels} barcos`,
          detail: `${port.recentArrivals} llegaron en las últimas ${payload.windowHours} h`,
        },
      })),
    };
  }

  if (layer === "encounters") {
    const payload = await readJson<EncountersResponse>(layer, signal);
    return {
      type: "FeatureCollection",
      features: payload.encounters.map((encounter) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [encounter.longitude, encounter.latitude] },
        properties: {
          layer,
          label: `${encounter.nameA ?? encounter.mmsiA} y ${encounter.nameB ?? encounter.mmsiB}`,
          detail: `A ${encounter.meters} m, juntos desde hace ${minutesLabel(encounter.stillMinutes)}`,
        },
      })),
    };
  }

  const payload = await readJson<DarkVesselsResponse>(layer, signal);
  return {
    type: "FeatureCollection",
    features: payload.vessels.map((vessel) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [vessel.longitude, vessel.latitude] },
      properties: {
        layer,
        label: vessel.name ?? `MMSI ${vessel.mmsi}`,
        detail: `Mudo desde hace ${minutesLabel(vessel.darkMinutes)}, iba a ${vessel.lastSpeedOverGround ?? 0} nudos`,
      },
    })),
  };
}
