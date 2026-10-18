import type { VesselFeatureProperties } from "./vessels";

const KNOTS_TO_METERS_PER_SECOND = 0.514_444;
const METERS_PER_DEGREE_LATITUDE = 111_320;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Mismo umbral que usa el color del mapa: por debajo damos el barco por
 * fondeado o atracado y no lo movemos. Dos tercios largos de la flota noruega
 * están en ese estado en cualquier momento.
 */
export const MIN_MOVING_SPEED_KNOTS = 0.5;

/**
 * Un barco que deja de emitir no puede seguir navegando solo: pasado este
 * margen (unos cuatro refrescos) la estima se congela donde llegó.
 */
export const MAX_DRIFT_SECONDS = 90;

export interface Position {
  longitude: number;
  latitude: number;
}

/**
 * AIS reserva 360 en `courseOverGround` para "no disponible". Usamos el rumbo
 * sobre el fondo y nunca `trueHeading`: el primero es la dirección real de
 * desplazamiento, mientras que el segundo solo dice hacia dónde apunta el
 * casco, que con corriente o viento no coincide.
 */
export function courseForDrift(properties: VesselFeatureProperties): number | null {
  const { courseOverGround } = properties;
  if (courseOverGround === null || courseOverGround < 0 || courseOverGround >= 360) {
    return null;
  }
  return courseOverGround;
}

export function speedForDrift(properties: VesselFeatureProperties): number | null {
  const { speedOverGround } = properties;
  if (speedOverGround === null || speedOverGround <= MIN_MOVING_SPEED_KNOTS) {
    return null;
  }
  return speedOverGround;
}

export function canDeadReckon(properties: VesselFeatureProperties): boolean {
  return courseForDrift(properties) !== null && speedForDrift(properties) !== null;
}

/**
 * Avanza una posición siguiendo un rumbo constante. Para los segundos y las
 * velocidades que manejamos (como mucho 90 s y unos pocos cientos de metros)
 * la aproximación plana es indistinguible de la fórmula esférica, y el coseno
 * de la latitud basta para corregir la convergencia de los meridianos, que a
 * 70° norte ya es notable.
 */
export function projectPosition(
  origin: Position,
  courseDegrees: number,
  speedKnots: number,
  seconds: number,
): Position {
  if (seconds <= 0) return origin;

  const distanceMeters = speedKnots * KNOTS_TO_METERS_PER_SECOND * seconds;
  const courseRadians = courseDegrees * DEGREES_TO_RADIANS;

  const northMeters = distanceMeters * Math.cos(courseRadians);
  const eastMeters = distanceMeters * Math.sin(courseRadians);

  const latitude = origin.latitude + northMeters / METERS_PER_DEGREE_LATITUDE;
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE * Math.cos(origin.latitude * DEGREES_TO_RADIANS);

  // Cerca de los polos el divisor tiende a cero; a las latitudes noruegas no
  // ocurre, pero la guarda evita devolver una longitud infinita si algún día
  // llega una posición ártica.
  const longitude =
    metersPerDegreeLongitude < 1
      ? origin.longitude
      : origin.longitude + eastMeters / metersPerDegreeLongitude;

  return { longitude, latitude };
}

export function clampDriftSeconds(seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.min(seconds, MAX_DRIFT_SECONDS);
}
