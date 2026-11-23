"use client";

import { useEffect, useRef } from "react";
import { AttributionControl, MapLibreMap, Marker, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * A live satellite globe to pick a site on: click to drop the pin. The same
 * Sentinel-2 imagery as the site map (components/site/supply-map.tsx).
 */

// MapLibre finds its worker relative to its own file, which moves once bundled.
let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
  workerReady = true;
}

const IMAGERY_TILES = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg";
const IMAGERY_CREDIT =
  '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless 2016</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0';

const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  sources: {
    imagery: { type: "raster", tiles: [IMAGERY_TILES], tileSize: 256, maxzoom: 14, attribution: IMAGERY_CREDIT },
  },
  layers: [{ id: "imagery", type: "raster", source: "imagery", paint: { "raster-contrast": 0.06 } }],
  sky: {
    "sky-color": "#0D1802",
    "horizon-color": "#373A1B",
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
  },
};

export default function LocationGlobe({
  value,
  onPick,
}: {
  value: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const pickRef = useRef(onPick);
  const startRef = useRef(value);

  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    ensureWorker();
    const start = startRef.current;
    const map = new MapLibreMap({
      container,
      style: STYLE,
      center: start ? [start.lng, start.lat] : [40, 18],
      zoom: start ? 7 : 1.3,
      attributionControl: false,
    });
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.getCanvas().style.cursor = "crosshair";
    map.on("click", (event) => pickRef.current(event.lngLat.lat, event.lngLat.lng));
    mapRef.current = map;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // The pin follows the value, whether it came from a click or from typing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const at: [number, number] = [value.lng, value.lat];
    if (!markerRef.current) markerRef.current = new Marker({ color: "#B2BE8B" }).setLngLat(at).addTo(map);
    else markerRef.current.setLngLat(at);
    // Typed coordinates off screen: bring them into view.
    if (!map.getBounds().contains(at)) map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 5), duration: 900 });
  }, [value]);

  return <div ref={containerRef} className="size-full" />;
}
