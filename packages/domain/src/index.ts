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

/**
 * Una fila de la agregación por tipo de barco y estado de navegación. El
 * dominio conserva los códigos AIS crudos: traducirlos a familias es cosa de
 * la interfaz, que ya tiene ese mapeo y no debe duplicarse aquí.
 */
export interface VesselBreakdownRow {
  shipType: number | null;
  navigationalStatus: number | null;
  vessels: number;
  moving: number;
  averageSpeed: number | null;
}

/** Posiciones recibidas en un minuto concreto. */
export interface ActivitySample {
  minute: string;
  positions: number;
}

/** Celda de la rejilla espacial con su número de embarcaciones. */
export interface TrafficCell {
  longitude: number;
  latitude: number;
  vessels: number;
}

/**
 * Antigüedad de la última posición conocida. Muchos barcos atracados dejan de
 * emitir durante horas, así que esto mide cuánta de la flota está realmente
 * viva ahora mismo.
 */
export interface FreshnessBuckets {
  underFiveMinutes: number;
  underOneHour: number;
  underSixHours: number;
  older: number;
}

export interface CoverageCounts {
  terrestrial: number;
  satellite: number;
}

export interface VesselStatsResponse {
  totalVessels: number;
  movingVessels: number;
  breakdown: VesselBreakdownRow[];
  activity: ActivitySample[];
  traffic: TrafficCell[];
  freshness: FreshnessBuckets;
  coverage: CoverageCounts;
  generatedAt: string;
}

/**
 * Un fondeadero o terminal que el propio tráfico dibuja: no viene de ningún
 * catálogo externo, sale de agrupar los barcos amarrados que comparten sitio.
 * Por eso no tiene nombre, solo centro, radio y lo que ocurre dentro.
 */
export interface PortClusterDto {
  id: number;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  mooredVessels: number;
  /** Amarrados que en la ventana consultada venían navegando: escalas recientes. */
  recentArrivals: number;
  /** Tipos de barco presentes, en códigos AIS crudos y ordenados por frecuencia. */
  shipTypes: number[];
}

export interface PortClustersResponse {
  ports: PortClusterDto[];
  count: number;
  windowHours: number;
  generatedAt: string;
}

/**
 * Dos barcos quietos y pegados fuera de cualquier fondeadero. Ambos llegaron
 * navegando, así que no es un atraque permanente sino un encuentro: en aguas
 * noruegas suele ser servicio a piscifactorías, repostaje o trasbordo.
 */
export interface EncounterDto {
  mmsiA: number;
  nameA: string | null;
  mmsiB: number;
  nameB: string | null;
  latitude: number;
  longitude: number;
  meters: number;
  /** Minutos desde que el último de los dos dejó de navegar. */
  stillMinutes: number;
}

export interface EncountersResponse {
  encounters: EncounterDto[];
  count: number;
  windowHours: number;
  generatedAt: string;
}
