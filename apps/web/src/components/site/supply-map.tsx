"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AttributionControl,
  LngLatBounds,
  MapLibreMap,
  Marker,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSourceSpecification,
  type PositionAnchor,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng, SupplyLayout, SupplyNode, SupplyRoute } from "@/lib/site-layouts";
import { STATUS_COLOR } from "./site-objects";
import { ROLE_COLOR, ROLE_LABEL, ROUTE_COLOR, TANKER_COLOR } from "./supply-style";
import { sensorKey, type SensorReadings } from "./use-site-sensors";

// MapLibre finds its worker relative to its own file, which moves once bundled.
// Point it at the emitted copy instead (once, before the first map).
let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
  workerReady = true;
}

const IMAGERY_TILES = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg";
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const IMAGERY_CREDIT =
  '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless 2016</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0';
const TERRAIN_CREDIT =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">AWS Terrain Tiles</a>';

function mapStyle(exaggeration: number): StyleSpecification {
  const dem = {
    type: "raster-dem" as const,
    tiles: [TERRAIN_TILES],
    tileSize: 256,
    encoding: "terrarium" as const,
    maxzoom: 13,
  };
  return {
    version: 8,
    sources: {
      imagery: {
        type: "raster",
        tiles: [IMAGERY_TILES],
        tileSize: 256,
        maxzoom: 14,
        attribution: IMAGERY_CREDIT,
      },
      terrain: { ...dem, attribution: TERRAIN_CREDIT },
      // A separate source for hillshade, as MapLibre recommends alongside terrain.
      shading: dem,
    },
    layers: [
      {
        id: "imagery",
        type: "raster",
        source: "imagery",
        paint: { "raster-contrast": 0.08, "raster-saturation": 0.05 },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "shading",
        paint: {
          "hillshade-exaggeration": 0.3,
          "hillshade-shadow-color": "#2b211a",
          "hillshade-highlight-color": "#fff6e8",
        },
      },
    ],
    terrain: { source: "terrain", exaggeration },
    sky: {
      "sky-color": "#9cc4e4",
      "horizon-color": "#e8eef2",
      "fog-color": "#e6e9ea",
      "sky-horizon-blend": 0.55,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.25,
      "atmosphere-blend": 0.6,
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry along routes.

const toRad = (deg: number) => (deg * Math.PI) / 180;

function distanceKm([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(a));
}

function headingDeg([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

type Track = { path: LatLng[]; cumulative: number[]; total: number };

function trackOf(route: SupplyRoute): Track {
  const cumulative = [0];
  for (let i = 1; i < route.path.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distanceKm(route.path[i - 1], route.path[i]));
  }
  return { path: route.path, cumulative, total: cumulative[cumulative.length - 1] };
}

/** Point and heading at fraction u (0..1) along the track. */
function along(track: Track, u: number): { at: LatLng; heading: number } {
  const target = Math.min(Math.max(u, 0), 1) * track.total;
  let i = 1;
  while (i < track.cumulative.length - 1 && track.cumulative[i] < target) i += 1;
  const a = track.path[i - 1];
  const b = track.path[i];
  const span = track.cumulative[i] - track.cumulative[i - 1] || 1;
  const t = (target - track.cumulative[i - 1]) / span;
  return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: headingDeg(a, b) };
}

const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat];

function boundsOf(supply: SupplyLayout): LngLatBounds {
  const bounds = new LngLatBounds();
  for (const node of supply.nodes) bounds.extend(lngLat(node.at));
  for (const route of supply.routes) for (const at of route.path) bounds.extend(lngLat(at));
  return bounds;
}

// ---------------------------------------------------------------------------
// DOM markers rendered through React portals.

function MapMarker({
  map,
  at,
  anchor = "center",
  className,
  zIndex = 0,
  children,
}: {
  map: MapLibreMap;
  at: LatLng;
  anchor?: PositionAnchor;
  className?: string;
  /** Stacking among markers: site labels above route chips above place names. */
  zIndex?: number;
  children: ReactNode;
}) {
  const [element] = useState(() => {
    const node = document.createElement("div");
    if (className) node.className = className;
    return node;
  });
  const [lat, lng] = at;

  const marker = useRef<Marker | null>(null);

  useEffect(() => {
    const instance = new Marker({ element, anchor }).setLngLat([lng, lat]).addTo(map);
    marker.current = instance;
    return () => {
      instance.remove();
      marker.current = null;
    };
  }, [anchor, element, lat, lng, map]);

  useEffect(() => {
    const current = marker.current;
    if (current) current.getElement().style.zIndex = String(zIndex);
  }, [anchor, element, lat, lng, map, zIndex]);

  return createPortal(children, element);
}

/** Tankers lie flat on the terrain and turn with the road. */
function Tankers({
  map,
  route,
  commodity,
  paused,
}: {
  map: MapLibreMap;
  route: SupplyRoute;
  commodity: SupplyLayout["commodity"];
  paused: boolean;
}) {
  const track = useMemo(() => trackOf(route), [route]);
  const pausedRef = useRef(paused);
  const primary = route.role === "primary";

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const count = primary ? 4 : 2;
  const loopSeconds = primary ? 48 : 72;

  useEffect(() => {
    const markers = Array.from({ length: count }, (_, index) => {
      const loaded = index % 2 === 0;
      const element = document.createElement("div");
      element.style.pointerEvents = "none";
      element.innerHTML = `<svg width="14" height="30" viewBox="0 0 14 30" aria-hidden="true">
        <rect x="1" y="9" width="12" height="20" rx="5" fill="${loaded ? TANKER_COLOR[commodity] : "#c9ccd0"}" stroke="#ffffff" stroke-width="1.4"/>
        <rect x="2" y="1" width="10" height="7" rx="2" fill="#f7f7f4" stroke="#3a3a3a" stroke-width="0.8"/>
      </svg>`;
      const marker = new Marker({
        element,
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat(lngLat(route.path[0]))
        .addTo(map);
      return { marker, loaded };
    });

    let frame = 0;
    let last = performance.now();
    let phase = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!pausedRef.current) {
        phase = (phase + dt / loopSeconds) % 1;
        markers.forEach(({ marker, loaded }, index) => {
          // Loaded tankers drive to the site; empty ones return.
          const raw = (phase + index / count) % 1;
          const { at, heading } = along(track, loaded ? raw : 1 - raw);
          marker.setLngLat(lngLat(at)).setRotation(loaded ? heading : heading + 180);
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      for (const { marker } of markers) marker.remove();
    };
  }, [commodity, count, loopSeconds, map, route.path, track]);

  return null;
}

// ---------------------------------------------------------------------------
// Labels.

function NodeLabel({
  node,
  readings,
  selected,
  hovered,
  compact,
  onSelect,
  onHover,
}: {
  node: SupplyNode;
  readings: SensorReadings;
  selected: boolean;
  hovered: boolean;
  compact: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const color = ROLE_COLOR[node.role];
  const rows = (node.sensors ?? []).map((sensor) => ({
    sensor,
    reading: readings[sensorKey(node.id, sensor.id)],
  }));
  const expanded = selected || hovered;
  const site = node.role === "site" || node.role === "capture";

  return (
    <div
      className={`flex flex-col items-center ${compact ? "pointer-events-none" : ""}`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={`block rounded-lg bg-white/95 text-left whitespace-nowrap shadow-[0_6px_18px_rgba(7,8,8,0.25)] ${
          selected ? "ring-2" : "ring-1"
        }`}
        style={{ ["--tw-ring-color" as string]: color }}
      >
        <span className={`flex items-center gap-1.5 px-2 ${compact ? "py-1" : "pt-1"}`}>
          <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="text-[11px] font-semibold text-rock">{node.name}</span>
        </span>
        {!compact ? (
          <span className="block px-2 pb-1 pl-5.5 text-[9.5px] font-medium tracking-wide text-mist uppercase">
            {ROLE_LABEL[node.role]}
            {node.estimated ? " · position estimated" : ""}
          </span>
        ) : null}
        {!compact && rows.length > 0 ? (
          <span className="block space-y-0.5 border-t border-line/60 px-2 py-1">
            {(expanded ? rows : rows.slice(0, 1)).map(({ sensor, reading }) => (
              <span key={sensor.id} className="flex items-center gap-1.5">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: reading ? STATUS_COLOR[reading.status] : "#ccc" }}
                />
                <span className="text-[10px] text-shale">{sensor.label}</span>
                <span className="ml-auto pl-2 font-mono text-[10.5px] font-semibold text-rock tabular-nums">
                  {reading?.text ?? "—"}
                </span>
                <span className="text-[9.5px] text-shale">{sensor.unit}</span>
              </span>
            ))}
            {!expanded && rows.length > 1 ? (
              <span className="block text-[9.5px] text-mist">+{rows.length - 1} more</span>
            ) : null}
          </span>
        ) : null}
      </button>
      <span className="h-5 w-0.5" style={{ background: color }} />
      <span
        className={`ring-2 ring-white ${site ? "size-3.5" : "size-3 rounded-full"} ${
          node.role === "site" ? "rotate-45" : node.role === "capture" ? "rounded-[3px]" : ""
        }`}
        style={{ background: color, boxShadow: "0 0 0 4px rgba(255,255,255,0.25)" }}
      />
    </div>
  );
}

const PLACES: { name: string; at: LatLng; sea?: boolean }[] = [
  { name: "Fujairah", at: [25.1288, 56.3265] },
  { name: "Kalba", at: [25.0513, 56.3542] },
  { name: "Khor Fakkan", at: [25.3393, 56.3567] },
  { name: "Masafi", at: [25.3005, 56.1656] },
  { name: "Dibba", at: [25.6196, 56.2729] },
  { name: "Gulf of Oman", at: [25.3, 56.5], sea: true },
];

// ---------------------------------------------------------------------------
// Camera.

type Padding = { top: number; bottom: number; left: number; right: number };

function paddingFor(compact: boolean, width: number, height: number): Padding {
  const pad = compact
    ? { top: 190, bottom: 70, left: 40, right: 40 }
    : { top: 130, bottom: 100, left: 320, right: 110 };
  // Never ask for more padding than the panel has room for.
  const fitX = Math.min(1, (width * 0.7) / (pad.left + pad.right));
  const fitY = Math.min(1, (height * 0.7) / (pad.top + pad.bottom));
  return {
    top: pad.top * fitY,
    bottom: pad.bottom * fitY,
    left: pad.left * fitX,
    right: pad.right * fitX,
  };
}

function frameChain(map: MapLibreMap, supply: SupplyLayout, compact: boolean, duration: number) {
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  if (!width || !height) return;
  const angle = width / height < 1 ? supply.map.tall : supply.map.wide;
  map.fitBounds(boundsOf(supply), {
    bearing: angle.bearing,
    pitch: angle.pitch,
    padding: paddingFor(compact, width, height),
    // Replace, not add to, padding left behind by the glide to a selected site.
    absolutePadding: true,
    duration,
    essential: true,
  });
}

// ---------------------------------------------------------------------------

export type SupplyMapProps = {
  supply: SupplyLayout;
  readings: SensorReadings;
  selectedId: string | null;
  hoveredId: string | null;
  /** Preview column: names only on labels, no route chips, no controls. */
  compact: boolean;
  /** Stop animating while hidden behind another full-screen panel. */
  paused?: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
};

const ROUTE_LAYERS = ["route-casing", "route-primary", "route-backup"];

export function SupplyMap({
  supply,
  readings,
  selectedId,
  hoveredId,
  compact,
  paused = false,
  onSelect,
  onHover,
}: SupplyMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const select = useRef(onSelect);

  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  // Create the map once.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    ensureWorker();
    const bounds = boundsOf(supply);
    const instance = new MapLibreMap({
      container: element,
      style: mapStyle(supply.map.exaggeration),
      center: bounds.getCenter(),
      zoom: 7.2,
      pitch: 0,
      bearing: 0,
      maxPitch: 78,
      attributionControl: false,
    });
    instance.addControl(new AttributionControl({ compact: true }), "top-right");

    instance.on("load", () => {
      const routes: GeoJSONSourceSpecification = {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: supply.routes.map((route) => ({
            type: "Feature",
            id: route.id,
            properties: {
              id: route.id,
              role: route.role,
              color: ROUTE_COLOR[supply.commodity][route.role],
            },
            geometry: { type: "LineString", coordinates: route.path.map(lngLat) },
          })),
        },
      };
      instance.addSource("routes", routes);
      instance.addLayer({
        id: "route-casing",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.75, "line-blur": 1 },
      });
      instance.addLayer({
        id: "route-primary",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "role"], "primary"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 4.5 },
      });
      instance.addLayer({
        id: "route-backup",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "role"], "backup"],
        layout: { "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-dasharray": [2, 1.4] },
      });

      // Fly in from a regional overview.
      frameChain(instance, supply, true, 0);
      instance.jumpTo({ zoom: instance.getZoom() - 1.2, pitch: 0 });
      setMap(instance);
    });

    // Credits stay one tap away (ⓘ) instead of a full line across the map.
    instance.once("idle", () => {
      element.querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
    });

    instance.on("click", (event) => {
      // Labels and chips are DOM markers with their own handlers; a click on
      // them must not read as a click on empty map and clear the selection.
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest(".maplibregl-marker")) return;
      const hit = instance.queryRenderedFeatures(event.point, { layers: ROUTE_LAYERS })[0];
      const id = hit?.properties?.id;
      select.current(typeof id === "string" ? id : null);
    });
    instance.on("mousemove", (event) => {
      const hit = instance.queryRenderedFeatures(event.point, { layers: ROUTE_LAYERS }).length > 0;
      instance.getCanvas().style.cursor = hit ? "pointer" : "";
    });

    return () => {
      setMap(null);
      instance.remove();
    };
    // The chain is fixed for the life of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame the chain on first load and whenever the panel changes between
  // preview column and full screen (after the resize transition settles).
  useEffect(() => {
    if (!map) return;
    // The panel resize transition takes 500 ms; frame for the final size.
    const timer = window.setTimeout(() => frameChain(map, supply, compact, 1800), 560);
    return () => window.clearTimeout(timer);
  }, [compact, map, supply]);

  // Widen the selected route.
  useEffect(() => {
    if (!map) return;
    const isSelected: ExpressionSpecification = ["==", ["get", "id"], selectedId ?? ""];
    map.setPaintProperty("route-primary", "line-width", ["case", isSelected, 8, 4.5]);
    map.setPaintProperty("route-backup", "line-width", ["case", isSelected, 6.5, 3.5]);
    map.setPaintProperty("route-casing", "line-width", ["case", isSelected, 13, 8]);
  }, [map, selectedId]);

  // Glide to a selected site.
  useEffect(() => {
    if (!map || compact) return;
    const node = supply.nodes.find((entry) => entry.id === selectedId);
    if (!node) return;
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    map.easeTo({
      center: lngLat(node.at),
      zoom: Math.max(map.getZoom(), 11),
      padding: { ...paddingFor(false, width, height), right: Math.min(380, width * 0.3) },
      duration: 1400,
      essential: true,
    });
  }, [compact, map, selectedId, supply]);

  const names = useMemo(
    () => Object.fromEntries(supply.nodes.map((node) => [node.id, node.name.replace(/ Treatment Plant$/, "")])),
    [supply],
  );

  return (
    // MapLibre makes its container position: relative, so it fills an absolute wrapper.
    <div className="absolute inset-0 bg-[#e6e9ea]">
      <div ref={container} className="h-full w-full" />
      {map ? (
        <>
          {supply.routes.map((route) => (
            <Tankers key={route.id} map={map} route={route} commodity={supply.commodity} paused={paused} />
          ))}
          {!compact
            ? PLACES.map((place) => (
                <MapMarker key={place.name} map={map} at={place.at} className="pointer-events-none" zIndex={0}>
                  <span
                    className={`text-[11px] whitespace-nowrap ${
                      place.sea
                        ? "font-medium tracking-[0.25em] text-[#d8eef8] uppercase italic"
                        : "font-semibold text-white"
                    }`}
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.75)" }}
                  >
                    {place.name}
                  </span>
                </MapMarker>
              ))
            : null}
          {!compact
            ? supply.routes.map((route) => {
                const color = ROUTE_COLOR[supply.commodity][route.role];
                const middle = along(trackOf(route), route.role === "primary" ? 0.45 : 0.55).at;
                const selected = route.id === selectedId;
                return (
                  <MapMarker key={`${route.id}-chip`} map={map} at={middle} anchor="bottom" zIndex={1}>
                    <button
                      type="button"
                      onClick={() => onSelect(route.id)}
                      className={`mb-2 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] font-semibold whitespace-nowrap shadow-md ${
                        selected ? "ring-2" : "ring-1"
                      }`}
                      style={{ color, ["--tw-ring-color" as string]: color }}
                    >
                      {route.provider ? `${route.provider} · ` : `${names[route.from] ?? route.from} · `}
                      {route.distanceKm} km · ~{route.durationMin} min
                    </button>
                  </MapMarker>
                );
              })
            : null}
          {supply.nodes.map((node) => (
            <MapMarker
              key={node.id}
              map={map}
              at={node.at}
              anchor="bottom"
              zIndex={node.id === selectedId || node.id === hoveredId ? 3 : 2}
            >
              <NodeLabel
                node={node}
                readings={readings}
                selected={node.id === selectedId}
                hovered={node.id === hoveredId}
                compact={compact}
                onSelect={onSelect}
                onHover={onHover}
              />
            </MapMarker>
          ))}
        </>
      ) : null}
    </div>
  );
}
