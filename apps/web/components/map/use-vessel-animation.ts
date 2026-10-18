import { GeoJSONSource, type MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import {
  clampDriftSeconds,
  courseForDrift,
  projectPosition,
  speedForDrift,
  type Position,
} from "@/lib/dead-reckoning";
import type { VesselFeatureCollection } from "@/lib/vessels";

/**
 * Por debajo de este zoom un barco a 20 nudos avanza una fracción de píxel
 * entre refrescos, así que animar solo gastaría CPU. A zoom 8 el avance ya se
 * ve, y además el viewport abarca pocos barcos.
 */
const ANIMATION_MIN_ZOOM = 8;

/**
 * Un fotograma cada 200 ms basta para que el desplazamiento se lea como
 * continuo. A 60 Hz estaríamos reserializando la colección entera hacia el
 * worker sesenta veces por segundo para ganar un movimiento que el ojo no
 * distingue a estas velocidades.
 */
const FRAME_INTERVAL_MS = 200;

/**
 * Cuando llega una posición real, el barco converge hacia ella durante este
 * tiempo en lugar de saltar.
 */
const RECONCILE_MS = 1_500;

/** Margen alrededor del viewport, en proporción de su tamaño. */
const VIEWPORT_MARGIN = 0.5;

type VesselFeature = VesselFeatureCollection["features"][number];

interface VesselState {
  feature: VesselFeature;
  /** Última posición real recibida de la API. */
  origin: Position;
  course: number | null;
  speed: number | null;
  /** Antigüedad del dato en el momento en que llegó, medida en el servidor. */
  ageAtArrivalSeconds: number;
  arrivalMs: number;
  /** Desfase pendiente de absorber frente a la posición que se mostraba. */
  offsetLongitude: number;
  offsetLatitude: number;
  offsetStartMs: number;
}

export type PositionLookup = (mmsi: number) => Position | null;

interface UseVesselAnimationOptions {
  mapReference: { current: MapLibreMap | null };
  sourceId: string;
  isMapReady: boolean;
  collection: VesselFeatureCollection;
  generatedAt: string | null;
  /** Se llama después de cada escritura para que el popup siga al barco. */
  onPositionsUpdated?: (lookup: PositionLookup) => void;
}

function displayedPosition(state: VesselState, nowMs: number): Position {
  const { origin, course, speed } = state;

  let position = origin;
  if (course !== null && speed !== null) {
    const elapsedSeconds = (nowMs - state.arrivalMs) / 1_000 + state.ageAtArrivalSeconds;
    position = projectPosition(origin, course, speed, clampDriftSeconds(elapsedSeconds));
  }

  const fade = 1 - (nowMs - state.offsetStartMs) / RECONCILE_MS;
  if (fade <= 0) return position;

  return {
    longitude: position.longitude + state.offsetLongitude * fade,
    latitude: position.latitude + state.offsetLatitude * fade,
  };
}

/**
 * La diferencia entre `generatedAt` y `observedAt` la calculan ambos en el
 * mismo reloj, así que mide la antigüedad del dato sin depender de que el
 * reloj del navegador esté en hora.
 */
function ageAtArrival(observedAt: string | null, generatedAt: string | null): number {
  if (observedAt === null || generatedAt === null) return 0;

  const observed = Date.parse(observedAt);
  const generated = Date.parse(generatedAt);
  if (Number.isNaN(observed) || Number.isNaN(generated)) return 0;

  return Math.max(0, (generated - observed) / 1_000);
}

export function useVesselAnimation({
  mapReference,
  sourceId,
  isMapReady,
  collection,
  generatedAt,
  onPositionsUpdated,
}: UseVesselAnimationOptions): void {
  const statesReference = useRef<Map<number, VesselState>>(new Map());
  const workingReference = useRef<VesselFeatureCollection | null>(null);
  const callbackReference = useRef(onPositionsUpdated);
  const isAnimatingReference = useRef(false);

  useEffect(() => {
    callbackReference.current = onPositionsUpdated;
  }, [onPositionsUpdated]);

  // Escribe en el source la posición que corresponde a este instante. La usan
  // tanto la llegada de datos como el bucle de animación, así que vive en un
  // ref: una función nueva en cada render reiniciaría el bucle.
  const renderReference = useRef<(nowMs: number) => void>(() => {});

  useEffect(() => {
    renderReference.current = (nowMs: number) => {
      const map = mapReference.current;
      const working = workingReference.current;
      if (map === null || working === null) return;

      const source = map.getSource(sourceId);
      if (!(source instanceof GeoJSONSource)) return;

      const states = statesReference.current;
      const shouldAnimate = map.getZoom() >= ANIMATION_MIN_ZOOM;

      if (!shouldAnimate && !isAnimatingReference.current) return;
      isAnimatingReference.current = shouldAnimate;

      const bounds = map.getBounds();
      const longitudeMargin = (bounds.getEast() - bounds.getWest()) * VIEWPORT_MARGIN;
      const latitudeMargin = (bounds.getNorth() - bounds.getSouth()) * VIEWPORT_MARGIN;
      const west = bounds.getWest() - longitudeMargin;
      const east = bounds.getEast() + longitudeMargin;
      const south = bounds.getSouth() - latitudeMargin;
      const north = bounds.getNorth() + latitudeMargin;

      for (const state of states.values()) {
        // Fuera del viewport nadie ve el desplazamiento, así que dejamos la
        // posición cruda y nos ahorramos la trigonometría.
        const isVisible =
          shouldAnimate &&
          state.origin.longitude >= west &&
          state.origin.longitude <= east &&
          state.origin.latitude >= south &&
          state.origin.latitude <= north;

        const position = isVisible ? displayedPosition(state, nowMs) : state.origin;
        const coordinates = state.feature.geometry.coordinates;
        coordinates[0] = position.longitude;
        coordinates[1] = position.latitude;
      }

      source.setData(working);

      callbackReference.current?.((mmsi) => {
        const state = states.get(mmsi);
        if (state === undefined) return null;
        const [longitude, latitude] = state.feature.geometry.coordinates;
        return { longitude, latitude };
      });
    };
  });

  // Llegada de datos: conserva lo que se está mostrando como punto de partida
  // para que la posición nueva no entre de golpe.
  useEffect(() => {
    if (!isMapReady) return;

    const nowMs = Date.now();
    const previousStates = statesReference.current;
    const nextStates = new Map<number, VesselState>();

    const features = collection.features.map((feature) => {
      const [longitude, latitude] = feature.geometry.coordinates;
      const clone: VesselFeature = {
        ...feature,
        geometry: { type: "Point", coordinates: [longitude, latitude] },
      };

      const origin: Position = { longitude, latitude };
      const state: VesselState = {
        feature: clone,
        origin,
        course: courseForDrift(feature.properties),
        speed: speedForDrift(feature.properties),
        ageAtArrivalSeconds: ageAtArrival(feature.properties.observedAt, generatedAt),
        arrivalMs: nowMs,
        offsetLongitude: 0,
        offsetLatitude: 0,
        offsetStartMs: 0,
      };

      const previous = previousStates.get(feature.properties.mmsi);
      if (previous !== undefined) {
        const shown = displayedPosition(previous, nowMs);
        const target = displayedPosition(state, nowMs);
        state.offsetLongitude = shown.longitude - target.longitude;
        state.offsetLatitude = shown.latitude - target.latitude;
        state.offsetStartMs = nowMs;
      }

      nextStates.set(feature.properties.mmsi, state);
      return clone;
    });

    statesReference.current = nextStates;
    workingReference.current = { type: "FeatureCollection", features };

    // Escribe ya, sin esperar al siguiente fotograma: a zoom bajo este es el
    // único momento en que el source se actualiza.
    isAnimatingReference.current = true;
    renderReference.current(nowMs);
  }, [collection, generatedAt, isMapReady]);

  useEffect(() => {
    if (!isMapReady) return;

    let frame = 0;
    let lastRenderMs = 0;

    function step(timestamp: number) {
      frame = requestAnimationFrame(step);
      if (timestamp - lastRenderMs < FRAME_INTERVAL_MS) return;
      lastRenderMs = timestamp;
      renderReference.current(Date.now());
    }

    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [isMapReady]);
}
