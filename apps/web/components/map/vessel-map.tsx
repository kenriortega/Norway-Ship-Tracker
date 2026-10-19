"use client";

import {
  GeoJSONSource,
  MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type AddLayerObject,
  type MapOptions,
} from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  EMPTY_VESSEL_COLLECTION,
  fetchVessels,
  toGeoJson,
  type VesselFeatureCollection,
  type VesselFeatureProperties,
} from "@/lib/vessels";
import {
  EMPTY_TRACK_COLLECTION,
  fetchVesselTrack,
  trackToGeoJson,
  type VesselTrackState,
} from "@/lib/vessel-track";
import { VESSEL_CATEGORIES, type VesselCategory } from "@/lib/vessel-types";

import { useVesselAnimation, type PositionLookup } from "./use-vessel-animation";
import { VesselFilters } from "./vessel-filters";

import { ARROW_ICON_PIXEL_RATIO, createArrowIcon } from "./vessel-icon";
import { readVesselProperties, renderVesselPopup } from "./vessel-popup";
import { addVesselTrackLayers, TRACK_SOURCE_ID } from "./vessel-track-layers";
import { VesselMapStatus } from "./vessel-map-status";

const SOURCE_ID = "vessels";
const CIRCLE_LAYER_ID = "vessels-circles";
const ARROW_LAYER_ID = "vessels-arrows";
const ARROW_ICON_ID = "vessel-arrow";
const INTERACTIVE_LAYER_IDS = [ARROW_LAYER_ID, CIRCLE_LAYER_ID];

// Por debajo de este zoom las flechas se solapan hasta volverse ruido, así que
// el mapa lejano se queda como estaba: solo puntos.
const ARROW_MIN_ZOOM = 5.5;

// AIS reserva 511 en `trueHeading` y 360 en `courseOverGround` para "no
// disponible", y el centinela cubre además la propiedad ausente.
const UNAVAILABLE_HEADING = 999;

// maplibre-gl tampoco reexporta los tipos de expresión, así que los sacamos de
// las propias capas, igual que `MapStyle` sale del constructor del mapa.
type CircleLayer = Extract<AddLayerObject, { type: "circle" }>;
type SymbolLayer = Extract<AddLayerObject, { type: "symbol" }>;
type ColorExpression = NonNullable<CircleLayer["paint"]>["circle-color"];
type RotationExpression = NonNullable<SymbolLayer["layout"]>["icon-rotate"];

type OpacityExpression = NonNullable<CircleLayer["paint"]>["circle-opacity"];

// A partir del zoom de las flechas, el barco con rumbo deja de pintar su punto:
// si no, el disco del mismo color se come la flecha. Hay que atenuar también el
// trazo, porque `circle-opacity` solo afecta al relleno.
const FADE_WHEN_HEADING: OpacityExpression = [
  "interpolate",
  ["linear"],
  ["zoom"],
  ARROW_MIN_ZOOM - 0.1,
  0.85,
  ARROW_MIN_ZOOM + 0.1,
  [
    "case",
    [
      "any",
      ["<", ["coalesce", ["get", "trueHeading"], UNAVAILABLE_HEADING], 360],
      ["<", ["coalesce", ["get", "courseOverGround"], UNAVAILABLE_HEADING], 360],
    ],
    0,
    0.85,
  ],
];

// `FilterSpecification` admite además un booleano suelto, que no encaja como
// operando de un `["all", …]`, así que lo excluimos.
type FilterExpression = Exclude<NonNullable<CircleLayer["filter"]>, boolean>;

const HEADING_EXPRESSION: RotationExpression = [
  "case",
  ["<", ["coalesce", ["get", "trueHeading"], UNAVAILABLE_HEADING], 360],
  ["get", "trueHeading"],
  ["<", ["coalesce", ["get", "courseOverGround"], UNAVAILABLE_HEADING], 360],
  ["get", "courseOverGround"],
  0,
];

// Cian en movimiento, ámbar prácticamente detenido. Lo comparten las dos capas.
const VESSEL_COLOR_EXPRESSION: ColorExpression = [
  "case",
  ["<", ["coalesce", ["get", "speedOverGround"], 0], 0.5],
  "#f59e0b",
  "#22d3ee",
];
const REFRESH_INTERVAL_MS = 20_000;

// Los círculos miden pocos píxeles a zoom bajo, así que aceptamos el clic en
// una caja alrededor del cursor en lugar de exigir el acierto exacto.
const HIT_RADIUS_PX = 4;

// `scripts/copy-maplibre-worker.mjs` deja este archivo en `public/`. Sin una
// URL absoluta MapLibre resuelve el worker contra el chunk de Next, que no lo
// contiene.
const WORKER_PATH = "/maplibre-gl-worker.mjs";

if (typeof window !== "undefined") {
  setWorkerUrl(new URL(WORKER_PATH, window.location.origin).href);
}

const ATTRIBUTION =
  'Fondo © <a href="https://www.kartverket.no/" target="_blank" rel="noreferrer">Kartverket</a> · ' +
  'Datos AIS distribuidos por <a href="https://www.kystverket.no/" target="_blank" rel="noreferrer">Kystverket</a> ' +
  'bajo <a href="https://data.norge.no/nlod/en/2.0" target="_blank" rel="noreferrer">NLOD 2.0</a>, ' +
  "en tiempo real vía BarentsWatch";

// `StyleSpecification` no se reexporta desde maplibre-gl, así que tomamos el
// tipo del propio constructor del mapa.
type MapStyle = Exclude<NonNullable<MapOptions["style"]>, string>;

// Kartverket publica su WMTS topográfico como dato abierto y sin clave de API,
// así que el mapa base no introduce secretos ni cuentas de terceros.
const MAP_STYLE: MapStyle = {
  version: 8,
  sources: {
    kartverket: {
      type: "raster",
      tiles: ["https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png"],
      tileSize: 256,
      maxzoom: 18,
      attribution: ATTRIBUTION,
    },
  },
  layers: [
    {
      id: "kartverket-base",
      type: "raster",
      source: "kartverket",
    },
  ],
};

type Status = "loading" | "ready" | "error";

export function VesselMap() {
  const containerReference = useRef<HTMLDivElement | null>(null);
  const mapReference = useRef<MapLibreMap | null>(null);
  const popupReference = useRef<Popup | null>(null);
  const selectedMmsiReference = useRef<number | null>(null);

  const [isMapReady, setIsMapReady] = useState(false);
  const [collection, setCollection] = useState<VesselFeatureCollection>(EMPTY_VESSEL_COLLECTION);
  const [status, setStatus] = useState<Status>("loading");
  const [count, setCount] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedCategories, setSelectedCategories] = useState<ReadonlySet<VesselCategory>>(
    () => new Set(VESSEL_CATEGORIES),
  );
  const [minSpeed, setMinSpeed] = useState(0);
  // El MMSI seleccionado vive además en un estado porque el recorrido se pide
  // en un efecto; la ref la siguen leyendo los callbacks del mapa, que corren
  // fuera del ciclo de render.
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const [trackState, setTrackState] = useState<VesselTrackState | null>(null);

  const isFiltered = selectedCategories.size < VESSEL_CATEGORIES.length || minSpeed > 0;

  const matchesFilters = useCallback(
    (properties: VesselFeatureProperties) =>
      selectedCategories.has(properties.category) && (properties.speedOverGround ?? 0) >= minSpeed,
    [selectedCategories, minSpeed],
  );

  const visibleCount = useMemo(
    () =>
      isFiltered
        ? collection.features.filter((feature) => matchesFilters(feature.properties)).length
        : count,
    [collection, count, isFiltered, matchesFilters],
  );

  useEffect(() => {
    const container = containerReference.current;
    if (container === null) return;

    const map = new MapLibreMap({
      container,
      style: MAP_STYLE,
      center: [11, 64.5],
      zoom: 3.6,
      attributionControl: { compact: false },
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("error", (event) => {
      console.error("Error de MapLibre", event.error);
    });

    const popup = new Popup({
      closeButton: true,
      // Cerramos a mano desde el propio clic en el mapa para poder distinguir
      // "has clicado otro barco" de "has clicado agua".
      closeOnClick: false,
      maxWidth: "none",
      offset: 10,
      className: "vessel-popup",
    });

    popup.on("close", () => {
      selectedMmsiReference.current = null;
      // Cubre de una vez los tres finales posibles: cerrar el popup, clicar
      // agua y el cierre automático cuando el barco sale del filtro.
      setSelectedMmsi(null);
      setTrackState(null);
    });

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: EMPTY_VESSEL_COLLECTION,
      });
      map.addImage(ARROW_ICON_ID, createArrowIcon(), {
        sdf: true,
        pixelRatio: ARROW_ICON_PIXEL_RATIO,
      });

      map.addLayer({
        id: CIRCLE_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 7, 4, 12, 7],
          "circle-color": VESSEL_COLOR_EXPRESSION,
          "circle-opacity": FADE_WHEN_HEADING,
          "circle-stroke-opacity": FADE_WHEN_HEADING,
          "circle-stroke-width": 0.6,
          "circle-stroke-color": "#0b2b3f",
        },
      });

      // El recorrido va por debajo de los puntos, así que se añade cuando la
      // capa de círculos ya existe y puede servir de `beforeId`.
      addVesselTrackLayers(map, ARROW_ICON_ID, CIRCLE_LAYER_ID);

      // Va encima de los círculos: los barcos sin rumbo conservan su punto y
      // los que sí lo reportan reciben la flecha sobre él.
      map.addLayer({
        id: ARROW_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        minzoom: ARROW_MIN_ZOOM,
        layout: {
          "icon-image": ARROW_ICON_ID,
          "icon-rotate": HEADING_EXPRESSION,
          "icon-rotation-alignment": "map",
          "icon-size": ["interpolate", ["linear"], ["zoom"], ARROW_MIN_ZOOM, 0.7, 11, 1.1],
          // Sin detección de colisiones: es lo caro de una symbol layer y
          // además escondería barcos en las zonas densas.
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": VESSEL_COLOR_EXPRESSION,
        },
      });
      // Los listeners van aquí porque `queryRenderedFeatures` lanza si la capa
      // todavía no existe y el usuario clica mientras el estilo carga.
      map.on("click", (event) => {
        const { x, y } = event.point;
        const [feature] = map.queryRenderedFeatures(
          [
            [x - HIT_RADIUS_PX, y - HIT_RADIUS_PX],
            [x + HIT_RADIUS_PX, y + HIT_RADIUS_PX],
          ],
          { layers: INTERACTIVE_LAYER_IDS },
        );

        const properties = readVesselProperties(feature?.properties ?? null);
        if (feature === undefined || feature.geometry.type !== "Point" || properties === null) {
          popup.remove();
          return;
        }

        const [longitude, latitude] = feature.geometry.coordinates;
        selectedMmsiReference.current = properties.mmsi;
        setSelectedMmsi(properties.mmsi);
        setTrackState({ mmsi: properties.mmsi, status: "loading", points: 0 });
        popup
          .setLngLat([longitude, latitude])
          .setHTML(
            renderVesselPopup(properties, {
              mmsi: properties.mmsi,
              status: "loading",
              points: 0,
            }),
          )
          .addTo(map);
      });

      map.on("mouseenter", INTERACTIVE_LAYER_IDS, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", INTERACTIVE_LAYER_IDS, () => {
        map.getCanvas().style.cursor = "";
      });

      setIsMapReady(true);
    });

    mapReference.current = map;
    popupReference.current = popup;

    return () => {
      setIsMapReady(false);
      mapReference.current = null;
      popupReference.current = null;
      selectedMmsiReference.current = null;
      setSelectedMmsi(null);
      popup.remove();
      map.remove();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    async function load() {
      try {
        const payload = await fetchVessels(controller.signal);
        if (cancelled) return;
        setCollection(toGeoJson(payload.vessels));
        setCount(payload.count);
        setGeneratedAt(payload.generatedAt);
        setErrorMessage(null);
        setStatus("ready");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setErrorMessage(error instanceof Error ? error.message : "Error desconocido");
        setStatus("error");
      }
    }

    function tick() {
      // Sin pestaña visible no tiene sentido seguir pidiendo posiciones.
      if (document.visibilityState === "visible") void load();
    }

    void load();
    interval = setInterval(tick, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      cancelled = true;
      controller.abort();
      if (interval !== null) clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reloadToken]);

  // Mientras el barco se desplaza por estima, el popup abierto lo acompaña.
  const followSelectedVessel = useCallback((lookup: PositionLookup) => {
    const popup = popupReference.current;
    const selectedMmsi = selectedMmsiReference.current;
    if (popup === null || selectedMmsi === null || !popup.isOpen()) return;

    const position = lookup(selectedMmsi);
    if (position === null) return;

    popup.setLngLat([position.longitude, position.latitude]);
  }, []);

  // La animación es ahora la única que escribe en el source: traduce estas
  // posiciones de la API en el desplazamiento continuo que se ve en pantalla.
  useVesselAnimation({
    mapReference,
    sourceId: SOURCE_ID,
    isMapReady,
    collection,
    generatedAt,
    onPositionsUpdated: followSelectedVessel,
  });

  // Los datos del popup sí se refrescan con cada tick; la posición la lleva la
  // animación, así que aquí solo cambia el contenido o se cierra el popup de un
  // barco que ha dejado de venir.
  useEffect(() => {
    const popup = popupReference.current;
    const selectedMmsi = selectedMmsiReference.current;
    if (!isMapReady || popup === null || selectedMmsi === null || !popup.isOpen()) return;

    const feature = collection.features.find(
      (candidate) => candidate.properties.mmsi === selectedMmsi,
    );

    if (feature === undefined) {
      popup.remove();
      return;
    }

    // Un estado de otro barco (o una petición que se quedó por el camino al
    // cambiar de selección) no se pinta: para este barco seguimos cargando.
    const track: VesselTrackState =
      trackState !== null && trackState.mmsi === selectedMmsi
        ? trackState
        : { mmsi: selectedMmsi, status: "loading", points: 0 };

    popup.setHTML(renderVesselPopup(feature.properties, track));
  }, [collection, isMapReady, trackState]);

  // El recorrido se pide una sola vez por selección: 24 h de histórico no
  // cambian de forma apreciable entre refrescos de 20 s, y el marcador lo
  // sigue moviendo la interpolación por estima sobre el source de posiciones.
  useEffect(() => {
    const map = mapReference.current;
    if (map === null || !isMapReady) return;

    const source = map.getSource(TRACK_SOURCE_ID);
    if (!(source instanceof GeoJSONSource)) return;

    source.setData(EMPTY_TRACK_COLLECTION);
    // El estado "cargando" lo pone el propio clic, y el popup al cerrarse lo
    // devuelve a null: así este efecto no escribe estado en su cuerpo.
    if (selectedMmsi === null) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const track = await fetchVesselTrack(selectedMmsi, controller.signal);
        if (controller.signal.aborted) return;

        const collection = trackToGeoJson(track);
        // El popup cuenta las posiciones que devuelve la API, no los vértices
        // que quedan tras simplificar la línea.
        const points = track.points.length;

        source.setData(collection);
        setTrackState(
          points === 0
            ? { mmsi: selectedMmsi, status: "empty", points: 0 }
            : { mmsi: selectedMmsi, status: "ready", points },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        // Un aviso, no un error: el popup ya lo cuenta y una caída del
        // histórico no rompe el mapa.
        console.warn("No se pudo cargar el recorrido", error);
        setTrackState({ mmsi: selectedMmsi, status: "error", points: 0 });
      }
    })();

    return () => {
      controller.abort();
      source.setData(EMPTY_TRACK_COLLECTION);
    };
  }, [isMapReady, selectedMmsi]);

  useEffect(() => {
    const map = mapReference.current;
    if (map === null || !isMapReady) return;

    const categories: FilterExpression = [
      "in",
      ["get", "category"],
      ["literal", [...selectedCategories]],
    ];
    const speed: FilterExpression = [">=", ["coalesce", ["get", "speedOverGround"], 0], minSpeed];

    map.setFilter(CIRCLE_LAYER_ID, ["all", categories, speed]);
    // La capa de flechas suma su propia condición: solo pinta a quien reporta
    // rumbo. Es el único sitio donde vive ese predicado.
    map.setFilter(ARROW_LAYER_ID, [
      "all",
      [
        "any",
        ["<", ["coalesce", ["get", "trueHeading"], UNAVAILABLE_HEADING], 360],
        ["<", ["coalesce", ["get", "courseOverGround"], UNAVAILABLE_HEADING], 360],
      ],
      categories,
      speed,
    ]);

    // Un popup sobre un barco que acaba de quedar fuera del filtro desconcierta
    // más que ayuda, así que lo cerramos.
    const popup = popupReference.current;
    const selectedMmsi = selectedMmsiReference.current;
    if (popup === null || selectedMmsi === null || !popup.isOpen()) return;

    const feature = collection.features.find(
      (candidate) => candidate.properties.mmsi === selectedMmsi,
    );

    if (feature === undefined || !matchesFilters(feature.properties)) {
      popup.remove();
    }
  }, [collection, isFiltered, isMapReady, matchesFilters, minSpeed, selectedCategories]);

  const toggleCategory = useCallback((category: VesselCategory) => {
    setSelectedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setSelectedCategories(new Set(VESSEL_CATEGORIES));
    setMinSpeed(0);
  }, []);

  const retry = useCallback(() => {
    setStatus("loading");
    setErrorMessage(null);
    setReloadToken((token) => token + 1);
  }, []);

  return (
    <section
      aria-label="Mapa de embarcaciones en aguas noruegas"
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#071a2c] shadow-2xl"
    >
      {/* El CSS de MapLibre fuerza `position: relative` en su contenedor, así
          que la altura va aquí en lugar de un posicionamiento absoluto. */}
      <div ref={containerReference} className="h-[480px] w-full lg:h-[620px]" />
      <VesselFilters
        selectedCategories={selectedCategories}
        minSpeed={minSpeed}
        onToggleCategory={toggleCategory}
        onMinSpeedChange={setMinSpeed}
        onReset={resetFilters}
        isFiltered={isFiltered}
      />
      <VesselMapStatus
        status={status}
        count={visibleCount}
        total={count}
        generatedAt={generatedAt}
        message={errorMessage}
        onRetry={retry}
      />
    </section>
  );
}
