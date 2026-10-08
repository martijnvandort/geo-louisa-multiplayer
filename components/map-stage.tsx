"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { MapDifficulty } from "@/lib/game-engine";
import { boundsOf, selectHydro, settleDateline, type FeatureCollection, type HydroFeature, type LandFeature } from "@/lib/region-land";
import type { LngLatBounds } from "@/lib/region-frames";
import { rememberLand } from "@/lib/country-shapes";
import { divisionLines } from "@/lib/provinces";
import "maplibre-gl/dist/maplibre-gl.css";

const OCEAN = "#e2f6fe";
const LAKE = "#1f6f97";
const RIVER = "#165a7c";
const HARD_LAND = "#84c0b4";
/** Quiet land, so the green or red country can be seen on the world map. */
const MUTED_LAND = "#d5d0c8";
const MUTED_BORDER = "#c4beb6";
const WORLD_BOUNDS: LngLatBounds = [
  [-179.9, -75],
  [179.9, 82],
];

/** Each regional map is its own file. The world file is never drawn underneath. */
const LAND_URL: Record<string, string> = {
  world: "/countries.geojson",
  eu: "/land/eu.geojson",
  "middle-east": "/land/middle-east.geojson",
  "north-america": "/land/north-america.geojson",
  "central-america": "/land/central-america.geojson",
  "south-america": "/land/south-america.geojson",
  africa: "/land/africa.geojson",
  asia: "/land/asia.geojson",
  oceania: "/land/oceania.geojson",
  netherlands: "/land/netherlands.geojson",
  "united-states": "/land/united-states.geojson",
};

export interface MapArc {
  id: string;
  color: string;
  segments: [number, number][][];
}

export interface MapPin {
  id: string;
  coordinates: [number, number];
  color: string;
  beacon?: boolean;
  capital?: boolean;
  label?: string;
}

interface StyleLayer {
  id: string;
  type?: string;
}

interface GeoMap {
  on(type: string, handler: (event: { lngLat?: { lng: number; lat: number }; error?: { message?: string } }) => void): void;
  getStyle(): { layers?: StyleLayer[] } | null | undefined;
  setLayoutProperty(id: string, name: "visibility", value: "visible" | "none"): void;
  setPaintProperty(id: string, name: string, value: unknown): void;
  addSource(id: string, source: unknown): void;
  getSource(id: string): { setData: (data: unknown) => void } | undefined;
  addLayer(layer: unknown, beforeId?: string): void;
  getLayer(id: string): unknown;
  setFilter(id: string, filter: unknown): void;
  getPaintProperty(id: string, name: string): unknown;
  setMaxBounds(bounds: LngLatBounds | null): void;
  setMinZoom(zoom: number): void;
  setMaxZoom(zoom: number): void;
  getMinZoom(): number;
  getMaxZoom(): number;
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  fitBounds(
    bounds: LngLatBounds,
    options?: { padding?: number; duration?: number; maxZoom?: number },
  ): void;
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  easeTo(options: {
    center?: [number, number];
    zoom?: number;
    duration?: number;
    bearing?: number;
    pitch?: number;
  }): void;
  jumpTo(options: {
    center?: [number, number];
    zoom?: number;
    bearing?: number;
    pitch?: number;
  }): void;
  resize(): void;
  remove(): void;
  setMinPitch(value: number): void;
  setMaxPitch(value: number): void;
  doubleClickZoom: { disable(): void };
  boxZoom: { disable(): void };
  dragPan: { enable(): void; disable(): void };
  dragRotate: { disable(): void };
  touchZoomRotate: {
    enable(): void;
    disable(): void;
    disableRotation(): void;
    setZoomRate(zoomRate?: number): void;
    _tapDragZoom?: { disable(): void };
  };
  touchPitch?: { disable(): void };
  keyboard?: { disable(): void; disableRotation?: () => void };
  scrollZoom: { enable(): void; disable(): void };
  getCanvas(): HTMLCanvasElement;
}

interface MarkerHandle {
  setLngLat(lngLat: [number, number]): MarkerHandle;
  addTo(map: GeoMap): MarkerHandle;
  getElement?(): HTMLElement;
  remove(): void;
}

interface MarkerCtor {
  new (options: { element: HTMLElement; anchor: "center" }): MarkerHandle;
}

type GraticuleFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: number[][] };
};

/** World keeps the 30° grid. Closer maps use a step that lands about the same distance apart on screen. */
function gridStep(span: number, pixels: number) {
  const target = (span / Math.max(pixels, 1)) * 100;
  const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 30];
  for (const step of steps) {
    if (step >= target * 0.85) return step;
  }
  return 30;
}

function graticuleLines(
  west: number,
  south: number,
  east: number,
  north: number,
  stepLng: number,
  stepLat: number,
) {
  const features: GraticuleFeature[] = [];
  const lngStart = Math.ceil((west - 1e-6) / stepLng) * stepLng;
  const latStart = Math.ceil((south - 1e-6) / stepLat) * stepLat;
  const lngCount = Math.max(0, Math.floor((east - lngStart) / stepLng + 1e-6));
  const latCount = Math.max(0, Math.floor((north - latStart) / stepLat + 1e-6));
  for (let index = 0; index <= lngCount; index += 1) {
    const lng = lngStart + index * stepLng;
    const coordinates: number[][] = [];
    for (let lat = south; lat <= north + 1e-6; lat += Math.max(stepLat, 2)) coordinates.push([lng, lat]);
    if (coordinates[coordinates.length - 1]?.[1] !== north) coordinates.push([lng, north]);
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });
  }
  for (let index = 0; index <= latCount; index += 1) {
    const lat = latStart + index * stepLat;
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[west, lat], [east, lat]] },
    });
  }
  return { type: "FeatureCollection" as const, features };
}

function graticule() {
  return graticuleLines(-180, -70, 180, 80, 30, 30);
}

function frameGraticule(west: number, south: number, east: number, north: number, width: number, height: number) {
  return graticuleLines(west, south, east, north, gridStep(east - west, width), gridStep(north - south, height));
}

const emptyFeatures = { type: "FeatureCollection" as const, features: [] };

function pastelStyle() {
  return {
    version: 8 as const,
    name: "Geosense pastel",
    sources: {
      countries: {
        type: "geojson" as const,
        data: emptyFeatures,
        attribution: "Natural Earth",
      },
      lakes: { type: "geojson" as const, data: emptyFeatures },
      rivers: { type: "geojson" as const, data: emptyFeatures },
      graticule: {
        type: "geojson" as const,
        data: graticule(),
      },
    },
    layers: [
      { id: "ocean", type: "background" as const, paint: { "background-color": OCEAN } },
      {
        id: "land",
        type: "fill" as const,
        source: "countries",
        paint: { "fill-color": ["get", "fill"] as unknown as string },
      },
      {
        id: "lakes",
        type: "fill" as const,
        source: "lakes",
        paint: { "fill-color": LAKE, "fill-opacity": 1 },
      },
      {
        id: "graticule",
        type: "line" as const,
        source: "graticule",
        paint: { "line-color": "#ffffff", "line-width": 1, "line-opacity": 0.8 },
      },
      {
        id: "rivers",
        type: "line" as const,
        source: "rivers",
        layout: { "line-cap": "round" as const, "line-join": "round" as const },
        paint: {
          "line-color": RIVER,
          "line-width": 0.75,
        },
      },
      {
        id: "borders",
        type: "line" as const,
        source: "countries",
        paint: { "line-color": "#ffffff", "line-width": 1.1, "line-opacity": 0.92 },
      },
    ],
  };
}

export function applyBasemapDifficulty(map: GeoMap, difficulty: MapDifficulty) {
  const lines = difficulty === "hard" ? "none" : "visible";
  try {
    map.setPaintProperty("land", "fill-color", difficulty === "hard" ? HARD_LAND : ["get", "fill"]);
    map.setLayoutProperty("borders", "visibility", lines);
    if (map.getLayer("province-lines")) map.setLayoutProperty("province-lines", "visibility", lines);
  } catch {
    // The pastel style is not on the map yet.
  }
}

/** The answered country, province, or state stays in color. Everything else steps back. */
function applyWorldMute(map: GeoMap, mute: boolean) {
  try {
    if (mute) {
      map.setPaintProperty("land", "fill-color", MUTED_LAND);
      map.setPaintProperty("borders", "line-color", MUTED_BORDER);
      map.setPaintProperty("borders", "line-opacity", 1);
      map.setPaintProperty("borders", "line-width", 0.8);
      return;
    }
    map.setPaintProperty("borders", "line-color", "#ffffff");
    map.setPaintProperty("borders", "line-opacity", 0.92);
    map.setPaintProperty("borders", "line-width", 1.1);
  } catch {
    // The pastel style is not on the map yet.
  }
}

function isCountryMap(region: string) {
  return (
    region !== "world" &&
    region !== "eu" &&
    region !== "middle-east" &&
    region !== "north-america" &&
    region !== "central-america" &&
    region !== "south-america" &&
    region !== "africa" &&
    region !== "asia" &&
    region !== "oceania"
  );
}

function bboxArea(geometry: HydroFeature["geometry"]) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  const visit = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) return;
    if (typeof value[0] === "number") {
      const [lng, lat] = value as [number, number];
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry.coordinates);
  if (!Number.isFinite(west)) return 0;
  return Math.max(0, east - west) * Math.max(0, north - south);
}

/** Large enough to read on a continent view. IJsselmeer and the Great Lakes stay; ponds do not. */
function largeLakes(lakes: FeatureCollection<HydroFeature>): FeatureCollection<HydroFeature> {
  return {
    type: "FeatureCollection",
    features: lakes.features.filter((feature) => bboxArea(feature.geometry) >= 0.02),
  };
}

const FINE_RIVER = 0.7;

function tuneWater(map: GeoMap, region: string) {
  const country = isCountryMap(region);
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.id === "region-mask" || layer.id === "region-cover" || layer.id === "arcs" || layer.id === "rivers") continue;
    try {
      if (layer.type === "line" && /waterway/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "line-width", FINE_RIVER);
        map.setLayoutProperty(layer.id, "visibility", country ? "visible" : "none");
      }
      if (layer.type === "fill" && layer.id === "water") {
        map.setFilter(
          layer.id,
          country
            ? ["match", ["get", "class"], ["river", "canal", "stream"], false, true]
            : ["match", ["get", "class"], ["river", "canal", "stream", "pond"], false, true],
        );
      }
    } catch {
      // Some style layers do not accept these properties.
    }
  }
  if (map.getLayer("rivers")) {
    map.setPaintProperty("rivers", "line-width", FINE_RIVER);
    map.setLayoutProperty("rivers", "visibility", country ? "visible" : "none");
  }
}

/**
 * One tap moves the map this many levels.
 * Pinch uses the same factor, so a small finger spread is a jump rather than a nudge.
 */
export const ZOOM_JUMP = 4;
/** Near enough to set a pin on a city, including from the world map on a phone. */
const CITY_ZOOM = 14;

/** Scroll, double-click, keyboard, and box zoom stay off. Pinch is separate. */
function freezeZoom(map: GeoMap) {
  map.scrollZoom.disable();
  map.boxZoom.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disable();
  map.dragRotate.disable();
  map.touchPitch?.disable();
  map.keyboard?.disable();
}

/** Pinch stays on. A second tap must still drop a pin, so tap-drag zoom stays off. */
function armPinch(map: GeoMap) {
  map.scrollZoom.disable();
  map.boxZoom.disable();
  map.doubleClickZoom.disable();
  map.dragRotate.disable();
  map.touchPitch?.disable();
  map.keyboard?.disable();
  map.touchZoomRotate.enable();
  map.touchZoomRotate.disableRotation();
  map.touchZoomRotate.setZoomRate(ZOOM_JUMP);
  map.touchZoomRotate._tapDragZoom?.disable();
  map.dragPan.enable();
}

function frameZoom(map: GeoMap, zoom: number, fastZoom: boolean) {
  const min = Math.min(zoom, CITY_ZOOM);
  map.setMinZoom(min);
  map.setMaxZoom(fastZoom ? Math.max(zoom, CITY_ZOOM) : zoom);
  if (fastZoom) armPinch(map);
  else freezeZoom(map);
}

function showGraticule(map: GeoMap, region: string) {
  const source = map.getSource("graticule");
  if (!source) return;
  if (region === "world") {
    source.setData(graticule());
    return;
  }
  const bounds = map.getBounds();
  const canvas = map.getCanvas();
  source.setData(
    frameGraticule(
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
      canvas.clientWidth,
      canvas.clientHeight,
    ),
  );
}

const MAX_LAT = 85;

function mercatorY(lat: number) {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))) / 360;
}

function latFromMercatorY(y: number) {
  const y2 = 180 - y * 360;
  return (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
}

/**
 * Fit the land in the frame and keep its midpoint in the middle of the screen.
 * fitBounds pins the view inside −180..180, which shoves North America left
 * once the Aleutians and the Arctic make the frame wider than that window.
 */
function frameCamera(bounds: LngLatBounds, width: number, height: number) {
  const [[west, south], [east, north]] = bounds;
  const pad = 36;
  const yNorth = mercatorY(north);
  const ySouth = mercatorY(south);
  const xSpan = Math.max(1e-6, (east - west) / 360);
  const ySpan = Math.max(1e-6, ySouth - yNorth);
  const worldPx = Math.min(Math.max(1, width - pad * 2) / xSpan, Math.max(1, height - pad * 2) / ySpan);
  const zoom = Math.log2(worldPx / 512);
  const centerLng = (west + east) / 2;
  const centerY = (yNorth + ySouth) / 2;
  const halfLng = (width / worldPx) * 180;
  const halfY = height / worldPx / 2;
  const slackLng = Math.max(0.05, halfLng * 0.01);
  const slackY = Math.max(0.01, halfY * 0.01);
  const view: LngLatBounds = [
    [centerLng - halfLng - slackLng, Math.max(-MAX_LAT, latFromMercatorY(centerY + halfY + slackY))],
    [centerLng + halfLng + slackLng, Math.min(MAX_LAT, latFromMercatorY(centerY - halfY - slackY))],
  ];
  return {
    center: [centerLng, latFromMercatorY(centerY)] as [number, number],
    zoom,
    view,
  };
}

function fitLand(
  map: GeoMap,
  region: string,
  width: number,
  height: number,
  land: FeatureCollection<LandFeature>,
  fastZoom: boolean,
) {
  freezeZoom(map);
  map.setMinZoom(0);
  map.setMaxZoom(22);
  map.setMaxBounds(null);
  if (region === "world") {
    const zoom = worldZoom(width);
    map.easeTo({
      center: [12, 18],
      zoom,
      bearing: 0,
      pitch: 0,
      duration: 0,
    });
    map.setMaxBounds(WORLD_BOUNDS);
    frameZoom(map, map.getZoom(), fastZoom);
    map.dragPan.enable();
    showGraticule(map, region);
    return;
  }
  const bounds = boundsOf(land.features);
  if (!bounds) return;
  const camera = frameCamera(bounds, width, height);
  map.dragPan.disable();
  map.setMaxBounds(camera.view);
  map.jumpTo({
    center: camera.center,
    zoom: camera.zoom,
    bearing: 0,
    pitch: 0,
  });
  frameZoom(map, map.getZoom(), fastZoom);
  if (!fastZoom) map.dragPan.disable();
  showGraticule(map, region);
}

function worldZoom(width: number) {
  return width < 640 ? 0.65 : 1.25;
}

type HydroData = {
  rivers: FeatureCollection<HydroFeature>;
  lakes: FeatureCollection<HydroFeature>;
};

const hydroCache = new Map<string, { rivers: FeatureCollection<HydroFeature>; lakes: FeatureCollection<HydroFeature> }>();

function applyRegionFrame(
  map: GeoMap,
  region: string,
  width: number,
  height: number,
  land: FeatureCollection<LandFeature>,
  rivers: FeatureCollection<HydroFeature>,
  lakes: FeatureCollection<HydroFeature>,
  refit: boolean,
  fastZoom: boolean,
) {
  rememberLand(land.features);
  map.getSource("countries")?.setData(land);
  const country = isCountryMap(region);
  if (region === "world") {
    map.getSource("lakes")?.setData(largeLakes(lakes));
    map.getSource("rivers")?.setData(emptyFeatures);
  } else {
    let hydro = hydroCache.get(region);
    if (!hydro) {
      hydro = selectHydro(land, country ? rivers : { type: "FeatureCollection", features: [] }, lakes);
      hydroCache.set(region, hydro);
    }
    map.getSource("lakes")?.setData(country ? hydro.lakes : largeLakes(hydro.lakes));
    map.getSource("rivers")?.setData(country ? hydro.rivers : emptyFeatures);
  }
  tuneWater(map, region);
  if (refit) fitLand(map, region, width, height, land, fastZoom);
  else if (fastZoom) armPinch(map);
  else freezeZoom(map);
}

function arcCollection(arcs: MapArc[], progress: number) {
  const features = arcs.flatMap((arc) => {
    const total = arc.segments.reduce((sum, segment) => sum + segment.length, 0);
    let budget = Math.max(2, Math.round(total * progress));
    return arc.segments.flatMap((segment) => {
      if (budget < 2) return [];
      const take = Math.min(segment.length, budget);
      budget -= take;
      if (take < 2) return [];
      return [
        {
          type: "Feature",
          properties: { color: arc.color },
          geometry: { type: "LineString", coordinates: segment.slice(0, take) },
        },
      ];
    });
  });
  return { type: "FeatureCollection", features };
}

function releaseMarkers(markers: { current: Map<string, MarkerHandle> }) {
  markers.current.forEach((marker) => marker.remove());
  markers.current.clear();
}

function pinLabel(root: HTMLElement, label?: string) {
  const existing = root.querySelector(".geosense-pin-name");
  if (!label) {
    existing?.remove();
    return;
  }
  const tag = existing ?? document.createElement("span");
  tag.className = "geosense-pin-name";
  tag.textContent = label;
  if (!existing) root.append(tag);
}

function pinElement(color: string, beacon: boolean, capital: boolean, label?: string) {
  const root = document.createElement("div");
  root.className = capital
    ? "geosense-pin geosense-capital"
    : beacon
      ? "geosense-pin geosense-beacon"
      : "geosense-pin";
  root.style.setProperty("--pin", color);
  const dot = document.createElement("span");
  dot.className = "geosense-pin-dot";
  root.append(dot);
  pinLabel(root, label);
  if (beacon && !capital) {
    const ring = document.createElement("span");
    ring.className = "geosense-pin-pulse";
    const ringTwo = document.createElement("span");
    ringTwo.className = "geosense-pin-pulse geosense-pin-pulse-delay";
    root.append(ring, ringTwo);
  }
  return root;
}

export function MapStage({
  difficulty,
  region,
  interactive,
  pins,
  arcs,
  highlight,
  onPlace,
  zoomLabel = "Zoom in",
}: {
  difficulty: MapDifficulty;
  region: string;
  interactive: boolean;
  pins: MapPin[];
  arcs: MapArc[];
  highlight: GeoJSON.Feature | null;
  onPlace: (coordinates: [number, number]) => void;
  zoomLabel?: string;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shell, setShell] = useState({ width: 0, height: 0 });
  const mapRef = useRef<GeoMap | null>(null);
  const markersRef = useRef<Map<string, MarkerHandle>>(new Map());
  const markerCtorRef = useRef<MarkerCtor | null>(null);
  const onPlaceRef = useRef(onPlace);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hydro, setHydro] = useState<HydroData | null>(null);
  const [lands, setLands] = useState<Record<string, FeatureCollection<LandFeature>>>({});
  const landLoads = useRef(new Set<string>());
  const frameKeyRef = useRef("");
  const zoomTarget = useRef<number | null>(null);
  const [fastZoom, setFastZoom] = useState(false);

  useEffect(() => {
    onPlaceRef.current = onPlace;
  }, [onPlace]);

  useLayoutEffect(() => {
    const media = window.matchMedia("(max-width: 1279px), (pointer: coarse)");
    const apply = () => setFastZoom(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let map: GeoMap | null = null;
    frameKeyRef.current = "";

    const start = async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (disposed) return;
        maplibre.setWorkerUrl("/maplibre-gl-worker.js");
        markerCtorRef.current = maplibre.Marker as unknown as MarkerCtor;
        map = new maplibre.Map({
          container,
          style: pastelStyle(),
          center: [12, 18],
          zoom: worldZoom(container.clientWidth),
          renderWorldCopies: false,
          maxBounds: WORLD_BOUNDS,
          attributionControl: { compact: true },
          pitchWithRotate: false,
          dragRotate: false,
          scrollZoom: false,
          touchZoomRotate: false,
          doubleClickZoom: false,
          boxZoom: false,
          maxPitch: 0,
        }) as unknown as GeoMap;
      } catch (error) {
        console.error("Geosense map failed to start", error);
        if (!disposed) setFailed(true);
        return;
      }

      if (!map || disposed) {
        map?.remove();
        return;
      }

      const live = map;
      mapRef.current = live;
      const publishZoom = () => {
        const shell = shellRef.current;
        if (!shell) return;
        shell.dataset.zoom = live.getZoom().toFixed(3);
        shell.dataset.maxZoom = live.getMaxZoom().toFixed(3);
      };
      live.on("zoom", publishZoom);
      live.on("moveend", () => {
        zoomTarget.current = null;
        publishZoom();
      });
      live.on("touchstart", () => {
        zoomTarget.current = null;
      });
      let loaded = false;
      live.setMinPitch(0);
      live.setMaxPitch(0);
      live.setMaxBounds(WORLD_BOUNDS);
      freezeZoom(live);
      live.dragPan.disable();

      live.on("load", () => {
        if (disposed) return;
        loaded = true;
        applyBasemapDifficulty(live, difficulty);
        void Promise.all([
          fetch("/hydro/rivers.geojson").then((response) => response.json()),
          fetch("/hydro/lakes.geojson").then((response) => response.json()),
        ])
          .then(([rivers, lakes]) => {
            if (disposed) return;
            setHydro({ rivers, lakes } as HydroData);
            setReady(true);
            setFailed(false);
          })
          .catch((error) => {
            console.error("Geosense map data failed to load", error);
            if (!disposed) setFailed(true);
          });
        if (!live.getSource("province-lines")) {
          live.addSource("province-lines", { type: "geojson", data: emptyFeatures });
          // White 1px strokes disappear into the peach fill after antialiasing.
          // A dark stroke stays readable on that fill and on the lakes.
          live.addLayer({
            id: "province-lines",
            type: "line",
            source: "province-lines",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2f4a52", "line-width": 1.125, "line-opacity": 1 },
          });
        }
        if (!live.getSource("province-highlight")) {
          live.addSource("province-highlight", { type: "geojson", data: emptyFeatures });
          live.addLayer(
            {
              id: "province-highlight",
              type: "fill",
              source: "province-highlight",
              paint: {
                "fill-color": ["case", ["==", ["get", "correct"], true], "#E2ECC0", "#F8AFAF"],
                "fill-opacity": 1,
              },
            },
            "province-lines",
          );
          live.addLayer(
            {
              id: "province-highlight-line",
              type: "line",
              source: "province-highlight",
              paint: {
                "line-color": ["case", ["==", ["get", "correct"], true], "#3d6b45", "#8a3d32"],
                "line-width": 2,
                "line-opacity": 1,
              },
            },
            "province-lines",
          );
        }
        if (!live.getSource("arcs")) {
          live.addSource("arcs", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          live.addLayer({
            id: "arcs",
            type: "line",
            source: "arcs",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": 4,
              "line-opacity": 1,
            },
          });
        }
      });

      live.on("click", (event) => {
        if (!event.lngLat) return;
        onPlaceRef.current([event.lngLat.lng, event.lngLat.lat]);
      });

      live.on("error", (event) => {
        const message = (event.error?.message ?? "").replace(/pk\.[A-Za-z0-9._-]+/g, "[redacted]");
        if (!loaded && /style|token|unauthorized|forbidden|403|401/i.test(message)) {
          console.error("Geosense map error", message);
          setFailed(true);
        }
      });
    };

    void start();
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      releaseMarkers(markersRef);
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Recreate the map only when a retry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    const url = LAND_URL[region];
    if (!url || landLoads.current.has(region)) return;
    landLoads.current.add(region);
    const id = region;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("Map outline failed to load");
        return response.json();
      })
      .then((land: FeatureCollection<LandFeature>) => {
        const settled = id === "world" ? land : settleDateline(land);
        setLands((current) => ({ ...current, [id]: settled }));
      })
      .catch((error) => {
        landLoads.current.delete(id);
        console.error("Geosense map outline failed to load", error);
        setFailed(true);
      });
  }, [region]);

  const muteWorld = highlight != null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("province-lines");
    if (source) source.setData(divisionLines(region) ?? emptyFeatures);
    applyBasemapDifficulty(map, difficulty);
    applyWorldMute(map, muteWorld);
  }, [difficulty, muteWorld, ready, region]);

  useEffect(() => {
    const map = mapRef.current;
    const Marker = markerCtorRef.current;
    if (!map || !ready || !Marker) return;
    const seen = new Set<string>();
    for (const pin of pins) {
      seen.add(pin.id);
      let marker = markersRef.current.get(pin.id);
      if (!marker) {
        marker = new Marker({
          element: pinElement(pin.color, Boolean(pin.beacon), Boolean(pin.capital), pin.label),
          anchor: "center",
        });
        marker.setLngLat(pin.coordinates).addTo(map);
        markersRef.current.set(pin.id, marker);
      } else {
        marker.setLngLat(pin.coordinates);
        const element = marker.getElement?.();
        if (element) pinLabel(element, pin.label);
      }
    }
    for (const [id, marker] of markersRef.current) {
      if (!seen.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [pins, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("province-highlight");
    if (!source) return;
    source.setData(
      highlight
        ? { type: "FeatureCollection", features: [highlight] }
        : { type: "FeatureCollection", features: [] },
    );
  }, [highlight, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("arcs");
    if (!source) return;
    if (arcs.length === 0) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      source.setData(arcCollection(arcs, 1));
      return;
    }
    const started = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const progress = Math.min(1, (time - started) / 1100);
      const eased = 1 - (1 - progress) ** 3;
      source.setData(arcCollection(arcs, eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [arcs, ready]);

  useEffect(() => {
    const shellNode = shellRef.current;
    if (!shellNode) return;
    const measure = () => {
      const rect = shellNode.getBoundingClientRect();
      setShell({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shellNode);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !ready || !hydro || !container || container.clientWidth < 2 || container.clientHeight < 2) return;
    container.style.width = "100%";
    container.style.height = "100%";
    map.resize();
    const land = lands[region];
    if (!land) {
      map.getSource("countries")?.setData(emptyFeatures);
      map.getSource("rivers")?.setData(emptyFeatures);
      map.getSource("lakes")?.setData(emptyFeatures);
      return;
    }
    const frameKey = `${region}:${fastZoom ? "jump" : "lock"}:${Math.round(container.clientWidth / 16)}:${Math.round(container.clientHeight / 16)}`;
    const refit = frameKeyRef.current !== frameKey;
    frameKeyRef.current = frameKey;
    applyRegionFrame(
      map,
      region,
      container.clientWidth,
      container.clientHeight,
      land,
      hydro.rivers,
      hydro.lakes,
      refit,
      fastZoom,
    );
    const shell = shellRef.current;
    if (shell) {
      shell.dataset.zoom = map.getZoom().toFixed(3);
      shell.dataset.maxZoom = map.getMaxZoom().toFixed(3);
    }
  }, [fastZoom, hydro, lands, ready, region, shell.height, shell.width]);

  return (
    <div
      ref={shellRef}
      data-region={region}
      data-highlight={highlight ? "yes" : "no"}
      data-arcs={arcs.some((arc) => arc.segments.some((segment) => segment.length >= 2)) ? "yes" : "no"}
      data-fast-zoom={fastZoom ? "yes" : "no"}
      data-zoom-jump={ZOOM_JUMP}
      className="absolute inset-0 bg-[#e2f6fe]"
    >
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%" }}
        className={interactive ? "cursor-crosshair" : undefined}
      />
      {!ready && !failed ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#e2f6fe]">
          <p className="font-mono text-sm text-[#2f4a52]">Unfolding the map…</p>
        </div>
      ) : null}
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#e2f6fe]/80 p-6">
          <div className="max-w-sm rounded-2xl border border-[#2f4a52]/15 bg-[#f0d8a8] p-5 text-center text-[#2f4a52] shadow-[0_10px_28px_rgba(47,74,82,0.12)]">
            <p className="text-base font-medium">The basemap failed to load.</p>
            <p className="mt-2 text-sm">Check the network connection, then try again.</p>
            <button
              type="button"
              className="mt-4 h-10 rounded-xl bg-[#f0b478] px-4 text-sm font-medium text-[#2f4a52]"
              onClick={() => {
                setFailed(false);
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}
      {ready && fastZoom ? (
        <button
          type="button"
          data-zoom-in=""
          aria-label={zoomLabel}
          onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            const base = zoomTarget.current ?? map.getZoom();
            const next = Math.min(map.getMaxZoom(), base + ZOOM_JUMP);
            if (next <= base + 0.01) return;
            zoomTarget.current = next;
            map.easeTo({ zoom: next, duration: 180 });
          }}
          className="absolute top-[calc(4.75rem+env(safe-area-inset-top))] right-3 z-10 grid h-11 w-11 place-items-center border border-[#2A150C] bg-[#FBF6D2] text-[#2A150C] shadow-[0_4px_12px_rgba(42,21,12,0.16)]"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
