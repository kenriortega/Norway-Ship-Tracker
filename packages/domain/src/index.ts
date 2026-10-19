export const AIS_PROVIDER = "barentswatch" as const;

export interface VesselUpdate {
  provider: typeof AIS_PROVIDER;
  mmsi: number;
  observedAt: Date;
  receivedAt: Date;
  latitude: number;
  longitude: number;
  name: string | null;
  imoNumber: number | null;
  callSign: string | null;
  shipType: number | null;
  speedOverGround: number | null;
  courseOverGround: number | null;
  trueHeading: number | null;
  rateOfTurn: number | null;
  navigationalStatus: number | null;
  destination: string | null;
  draughtMeters: number | null;
  rawPayload: Record<string, unknown>;
}

export interface VesselPositionDto {
  mmsi: number;
  name: string | null;
  shipType: number | null;
  latitude: number;
  longitude: number;
  speedOverGround: number | null;
  courseOverGround: number | null;
  trueHeading: number | null;
  observedAt: string | null;
  receivedAt: string;
}

export interface VesselPositionsResponse {
  vessels: VesselPositionDto[];
  count: number;
  generatedAt: string;
}

/** Una posición del recorrido histórico de un barco, ya ordenada por tiempo. */
export interface VesselTrackPoint {
  longitude: number;
  latitude: number;
  observedAt: string;
  speedOverGround: number | null;
}

export interface VesselTrackResponse {
  mmsi: number;
  points: VesselTrackPoint[];
  generatedAt: string;
}
