"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Globe2, MapPin, X } from "lucide-react";

import { formatLocation, parseLocation } from "@/lib/journey/cortex";

const LocationGlobe = dynamic(() => import("./location-globe"), {
  ssr: false,
  loading: () => (
    <div className="grid size-full place-items-center text-[11px] tracking-[0.18em] text-white/60 uppercase">
      Loading the globe
    </div>
  ),
});

const FIELD =
  "h-9 w-full min-w-0 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 text-[13px] text-white tabular placeholder:text-white/35 outline-none transition-[border-color,box-shadow] focus:border-[#A99BFF] focus:shadow-[0_0_0_3px_rgba(169,155,255,0.25)]";

const round = (value: number) => Number(value.toFixed(6));

/** Latitude and longitude fields, each checked against its range. */
function CoordinateFields({
  lat,
  lng,
  onLat,
  onLng,
}: {
  lat: string;
  lng: string;
  onLat: (value: string) => void;
  onLng: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-2">
      <label htmlFor={`${id}-lat`} className="grid gap-1 text-[11px] font-medium text-white/60">
        Latitude
        <input
          id={`${id}-lat`}
          inputMode="decimal"
          className={FIELD}
          placeholder="25.4861"
          value={lat}
          onChange={(event) => onLat(event.target.value)}
        />
      </label>
      <label htmlFor={`${id}-lng`} className="grid gap-1 text-[11px] font-medium text-white/60">
        Longitude
        <input
          id={`${id}-lng`}
          inputMode="decimal"
          className={FIELD}
          placeholder="56.3093"
          value={lng}
          onChange={(event) => onLng(event.target.value)}
        />
      </label>
    </div>
  );
}

/** The globe, full-screen over the journey, with the coordinates under it. */
function GlobeDialog({
  initial,
  onClose,
  onUse,
}: {
  initial: { lat: string; lng: string };
  onClose: () => void;
  onUse: (lat: string, lng: string) => void;
}) {
  const [lat, setLat] = useState(initial.lat);
  const [lng, setLng] = useState(initial.lng);
  const at = parseLocation(`${lat}, ${lng}`);
  const titleId = useId();

  // Esc closes the globe, not the step behind it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[#05040F]/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="flex h-[min(680px,90vh)] w-[min(1000px,96vw)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#141235]/80 text-white shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold">
              Pick the facility on the globe
            </h2>
            <p className="text-[11.5px] text-white/60">Drag to turn it, scroll to zoom, click to drop the pin.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the globe"
            className="grid size-8 place-items-center rounded-xl text-white/65 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="relative min-h-0 flex-1 bg-[#0A0919]">
          <LocationGlobe
            value={at}
            onPick={(pickedLat, pickedLng) => {
              setLat(String(round(pickedLat)));
              setLng(String(round(pickedLng)));
            }}
          />
        </div>
        <footer className="grid gap-3 border-t border-white/10 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <CoordinateFields lat={lat} lng={lng} onLat={setLat} onLng={setLng} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border border-white/15 px-3 text-[12px] font-semibold text-white/80 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!at}
              onClick={() => onUse(lat, lng)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-[#1B1846] hover:bg-[#E9E5FF] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MapPin className="size-3.5" />
              Use this location
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A location answer: typed latitude and longitude, or picked on the globe.
 * Saved as "lat, lng" in WGS84 degrees.
 */
export function LocationPicker({
  value,
  submitLabel,
  onSubmit,
}: {
  value: string | undefined;
  submitLabel: string;
  onSubmit: (value: string) => void;
}) {
  const start = parseLocation(value);
  const [lat, setLat] = useState(start ? String(start.lat) : "");
  const [lng, setLng] = useState(start ? String(start.lng) : "");
  const [open, setOpen] = useState(false);
  const at = parseLocation(`${lat}, ${lng}`);
  const typed = lat.trim() !== "" || lng.trim() !== "";

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (at) onSubmit(`${round(at.lat)}, ${round(at.lng)}`);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2.5 text-left transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#8F7DF7]/25 text-[#D9D2FF]">
          <Globe2 className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold text-white">Pick on the globe</span>
          <span className="block text-[11px] text-white/55">
            {at ? formatLocation(`${at.lat}, ${at.lng}`) : "Live satellite map · click to drop the pin"}
          </span>
        </span>
      </button>
      <p className="text-[11px] text-white/45">Or type the coordinates (WGS84 decimal degrees):</p>
      <CoordinateFields lat={lat} lng={lng} onLat={setLat} onLng={setLng} />
      {typed && !at ? (
        <p className="text-[11px] text-[#FFC48F]">Latitude runs from -90 to 90 and longitude from -180 to 180.</p>
      ) : null}
      <button
        type="submit"
        disabled={!at}
        className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-lg bg-white px-3 text-[12px] font-semibold text-[#1B1846] transition-colors hover:bg-[#E9E5FF] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitLabel}
      </button>
      {open ? (
        <GlobeDialog
          initial={{ lat, lng }}
          onClose={() => setOpen(false)}
          onUse={(pickedLat, pickedLng) => {
            setLat(pickedLat);
            setLng(pickedLng);
            setOpen(false);
          }}
        />
      ) : null}
    </form>
  );
}
