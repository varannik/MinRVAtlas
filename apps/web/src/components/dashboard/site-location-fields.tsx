"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import {
  parseLatitude,
  parseLongitude,
} from "@/lib/project-locations";
import { hasConnection } from "@/lib/registries";
import { useDashboard } from "@/store/dashboard-store";
import { useLocationStore } from "@/store/location-store";
import type { Project } from "@/lib/types";

function coordText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

export function SiteLocationFields({ project }: { project: Project }) {
  const tenantId = useDashboard((state) => state.tenantId);
  const overlay = useLocationStore((state) => state.byId[project.id]);
  const save = useLocationStore((state) => state.save);

  const latValue = overlay?.lat ?? project.lat;
  const lngValue = overlay?.lng ?? project.lng;

  const [draft, setDraft] = useState<{ lat: string; lng: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const lat = draft?.lat ?? coordText(latValue);
  const lng = draft?.lng ?? coordText(lngValue);

  const parsedLat = parseLatitude(lat);
  const parsedLng = parseLongitude(lng);
  const dirty =
    parsedLat !== null &&
    parsedLng !== null &&
    (parsedLat !== latValue || parsedLng !== lngValue);
  const operatorPin = Boolean(overlay);
  const registryLinked = hasConnection(project.tenantId, project.id);

  function update(field: "lat" | "lng", value: string) {
    setDraft({ lat, lng, [field]: value });
    setSaved(false);
    setError(null);
  }

  async function onSave() {
    setSaved(false);
    if (parsedLat === null || parsedLng === null) {
      setError("Latitude must be -90 to 90; longitude -180 to 180.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await save(tenantId, project.id, parsedLat, parsedLng);
      setDraft(null);
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save coordinates",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-line/70 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] tracking-[0.14em] text-mist uppercase">
          <MapPin className="size-3" />
          Site location
        </div>
        <span
          className={`rounded px-1.5 py-px text-[9px] font-bold tracking-wide ${
            operatorPin
              ? "bg-carbon-400/15 text-carbon-400"
              : "bg-ink-700 text-mist"
          }`}
        >
          {operatorPin ? "OPERATOR PIN" : "CATALOG PIN"}
        </span>
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-mist">
        {registryLinked
          ? "Registry APIs identify the project by id, not a map pin. Enter WGS84 so the globe can place it."
          : "WGS84 pin for the globe. Save an override if the catalog default is wrong."}
      </p>

      <div className="mt-2 flex items-end gap-1.5">
        <label className="min-w-0 flex-1 rounded-xl bg-ink-800/60 px-3 py-2">
          <span className="text-[10px] tracking-[0.12em] text-mist uppercase">
            Lat
          </span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={lat}
            onChange={(event) => update("lat", event.target.value)}
            aria-label="Latitude"
            className="tabular mt-0.5 w-full bg-transparent text-sm font-medium text-frost placeholder:text-mist/50 focus:outline-none"
            placeholder="25.29"
          />
        </label>
        <label className="min-w-0 flex-1 rounded-xl bg-ink-800/60 px-3 py-2">
          <span className="text-[10px] tracking-[0.12em] text-mist uppercase">
            Lng
          </span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={lng}
            onChange={(event) => update("lng", event.target.value)}
            aria-label="Longitude"
            className="tabular mt-0.5 w-full bg-transparent text-sm font-medium text-frost placeholder:text-mist/50 focus:outline-none"
            placeholder="56.26"
          />
        </label>
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void onSave()}
          className="shrink-0 rounded-xl bg-ink-800/60 px-3 py-2.5 text-[11px] font-semibold text-frost ring-1 ring-line/70 transition-colors enabled:hover:bg-ink-700 disabled:cursor-not-allowed disabled:text-mist"
        >
          {saving ? "Saving" : "Save"}
        </button>
      </div>

      {error ? (
        <p className="mt-1.5 text-[10px] text-signal-rose">{error}</p>
      ) : saved ? (
        <p className="mt-1.5 text-[10px] text-carbon-400">Pin saved.</p>
      ) : null}
    </div>
  );
}
