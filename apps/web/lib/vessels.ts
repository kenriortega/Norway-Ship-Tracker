import type { VesselPositionDto, VesselPositionsResponse } from "@norway-ship-tracker/domain";

import { categorizeShipType, type VesselCategory } from "./vessel-types";

export type VesselFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  VesselFeatureProperties
>;

export interface VesselFeatureProperties {
  mmsi: number;
  name: string;
  shipType: number | null;
  category: VesselCategory;
  speedOverGround: number | null;
  courseOverGround: number | null;
  trueHeading: number | null;
  observedAt: string | null;
}

export const EMPTY_VESSEL_COLLECTION: VesselFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * La API acepta west/south/east/north y limit. Esta primera versión usa los
 * bounds por defecto (toda Noruega) y pide el máximo permitido, porque la
 * consulta responde en menos de un segundo y así el mapa no necesita volver a
 * pedir datos cada vez que el usuario mueve el viewport.
 */
export async function fetchVessels(signal: AbortSignal): Promise<VesselPositionsResponse> {
  const response = await fetch("/api/vessels?limit=10000", {
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`La API respondió ${response.status}`);
  }

  return (await response.json()) as VesselPositionsResponse;
}

export function toGeoJson(vessels: VesselPositionDto[]): VesselFeatureCollection {
  return {
    type: "FeatureCollection",
    features: vessels.map((vessel) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [vessel.longitude, vessel.latitude],
      },
      properties: {
        mmsi: vessel.mmsi,
        name: vessel.name ?? `MMSI ${vessel.mmsi}`,
        shipType: vessel.shipType,
        category: categorizeShipType(vessel.shipType),
        speedOverGround: vessel.speedOverGround,
        courseOverGround: vessel.courseOverGround,
        trueHeading: vessel.trueHeading,
        observedAt: vessel.observedAt,
      },
    })),
  };
}
