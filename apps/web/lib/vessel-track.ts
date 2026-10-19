import type { VesselTrackPoint, VesselTrackResponse } from "@norway-ship-tracker/domain";

export type VesselTrackCollection = GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  VesselTrackSegmentProperties
>;

export interface VesselTrackSegmentProperties {
  mmsi: number;
  /** Vértices dibujados en el tramo, ya simplificados. */
  vertices: number;
}

/** Lo que el popup necesita saber del recorrido mientras se pide o falla. */
export type VesselTrackStatus = "loading" | "ready" | "empty" | "error";

export interface VesselTrackState {
  /** Barco al que pertenece el estado: evita leer el de una selección anterior. */
  mmsi: number;
  status: VesselTrackStatus;
  /** Posiciones dibujadas; solo tiene sentido con estado "ready". */
  points: number;
}

export const EMPTY_TRACK_COLLECTION: VesselTrackCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Un barco puede salir de cobertura AIS durante horas. Unir los dos extremos
 * del hueco dibujaría una recta que el barco no navegó, así que a partir de
 * esta separación empezamos un tramo nuevo.
 */
const SEGMENT_GAP_MS = 30 * 60 * 1_000;

/**
 * Tolerancia de la simplificación, en metros. El AIS emite una posición cada
 * pocos segundos y el ruido de GPS llena la línea de microzigzags: además de
 * pesar, impiden que MapLibre coloque las flechas de sentido, porque descarta
 * los puntos donde la línea gira demasiado. A 50 m la forma del recorrido no
 * cambia a ninguna escala del mapa.
 */
const SIMPLIFY_TOLERANCE_METERS = 50;

const METERS_PER_DEGREE = 111_320;

/** Proyección equirectangular local: a estas distancias el error es ínfimo. */
function toMeters(
  [longitude, latitude]: GeoJSON.Position,
  referenceLatitude: number,
): [number, number] {
  return [
    longitude * METERS_PER_DEGREE * Math.cos((referenceLatitude * Math.PI) / 180),
    latitude * METERS_PER_DEGREE,
  ];
}

function perpendicularDistance(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
        );

  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

/** Douglas-Peucker iterativo: conserva siempre los extremos del tramo. */
function simplify(coordinates: GeoJSON.Position[]): GeoJSON.Position[] {
  if (coordinates.length < 3) return coordinates;

  const referenceLatitude = coordinates[0][1];
  const projected = coordinates.map((coordinate) => toMeters(coordinate, referenceLatitude));
  const keep = new Array<boolean>(coordinates.length).fill(false);
  keep[0] = true;
  keep[coordinates.length - 1] = true;

  const pending: Array<[number, number]> = [[0, coordinates.length - 1]];
  while (pending.length > 0) {
    const [first, last] = pending.pop() as [number, number];
    let farthest = -1;
    let maxDistance = SIMPLIFY_TOLERANCE_METERS;

    for (let index = first + 1; index < last; index += 1) {
      const distance = perpendicularDistance(projected[index], projected[first], projected[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = index;
      }
    }

    if (farthest === -1) continue;

    keep[farthest] = true;
    pending.push([first, farthest], [farthest, last]);
  }

  return coordinates.filter((_, index) => keep[index]);
}

export async function fetchVesselTrack(
  mmsi: number,
  signal: AbortSignal,
): Promise<VesselTrackResponse> {
  const response = await fetch(`/api/vessels/${mmsi}/track`, { signal });

  if (!response.ok) {
    throw new Error(`La API respondió ${response.status}`);
  }

  return (await response.json()) as VesselTrackResponse;
}

function toSegments(points: VesselTrackPoint[]): VesselTrackPoint[][] {
  const segments: VesselTrackPoint[][] = [];
  let current: VesselTrackPoint[] = [];
  let previousTime: number | null = null;

  for (const point of points) {
    const time = new Date(point.observedAt).getTime();
    if (Number.isNaN(time)) continue;

    if (previousTime !== null && time - previousTime > SEGMENT_GAP_MS) {
      segments.push(current);
      current = [];
    }

    current.push(point);
    previousTime = time;
  }

  segments.push(current);
  // Una línea necesita dos vértices; un tramo de un solo punto no se dibuja.
  return segments.filter((segment) => segment.length >= 2);
}

export function trackToGeoJson(track: VesselTrackResponse): VesselTrackCollection {
  return {
    type: "FeatureCollection",
    features: toSegments(track.points).map((segment) => {
      const coordinates = simplify(segment.map((point) => [point.longitude, point.latitude]));

      return {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: { mmsi: track.mmsi, vertices: coordinates.length },
      };
    }),
  };
}
