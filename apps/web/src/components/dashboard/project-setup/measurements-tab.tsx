"use client";

import { useState } from "react";
import { MEASUREMENT_TYPE_LABEL } from "@/lib/registries/isometric/api";
import { fieldSourcePrefix } from "@/lib/registries/isometric/pdd-catalog";
import type { ProjectSetupSnapshot } from "@/lib/registries/isometric/setup-types";
import type { Project } from "@/lib/types";
import { useProjectSetup } from "@/hooks/use-project-setup";

export function MeasurementsTab({
  project,
  snapshot,
  locked,
}: {
  project: Project;
  snapshot: ProjectSetupSnapshot;
  locked: boolean;
}) {
  const { submit, saving } = useProjectSetup(project);
  const geoFiles = snapshot.sources.filter((source) =>
    (source.supplier_reference_id ?? "").startsWith(fieldSourcePrefix()),
  );

  return (
    <div className="scroll-slim min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <LocationForm
        locked={locked}
        saving={saving}
        onCreate={(draft) => submit({ action: "createMeasurementLocation", ...draft })}
      />

      {snapshot.measurementLocations.length === 0 ? (
        <p className="text-sm text-mist">No measurement locations in Certify yet.</p>
      ) : (
        <ul className="space-y-1">
          {snapshot.measurementLocations.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 ring-1 ring-line/60"
            >
              <div>
                <p className="font-mono text-[11px] text-frost">
                  {row.supplier_reference_id || row.id}
                </p>
                <p className="text-[11px] text-mist">
                  {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
                </p>
              </div>
              <button
                type="button"
                disabled={locked || saving}
                onClick={() =>
                  void submit({
                    action: "deleteMeasurementLocation",
                    locationId: row.id,
                  })
                }
                className="text-[10px] text-signal-rose disabled:opacity-40"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <SampleForm
        locked={locked}
        saving={saving}
        onSubmit={async (csvText, file) => {
          await submit(
            { action: "createMeasurementSamples", csvText },
            file ? [file] : [],
          );
        }}
      />

      {snapshot.measurementSamples.length > 0 ? (
        <ul className="space-y-1">
          {snapshot.measurementSamples.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 text-[12px] text-frost"
            >
              <span>
                {row.supplier_reference_id || row.id} · {row.measured_at.slice(0, 10)}
                {` · ${row.values.length} value${row.values.length === 1 ? "" : "s"}`}
              </span>
              <button
                type="button"
                disabled={locked || saving}
                onClick={() =>
                  void submit({ action: "deleteMeasurementSample", sampleId: row.id })
                }
                className="text-[10px] text-signal-rose disabled:opacity-40"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-xl bg-white/70 p-3 ring-1 ring-line/60">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
          Removal-area GeoJSON
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-mist">
          Certify has no documented REST write for removal areas or project-area
          polygons. The file is stored as a source. Native geometry still has to
          be uploaded in Certify.
        </p>
        <input
          type="file"
          accept=".geojson,.json,.zip"
          className="mt-2 block text-[11px] text-mist"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void submit(
              { action: "uploadFieldGeojson", notes: "Removal-area / project-area geometry" },
              [file],
            );
          }}
        />
        {geoFiles.length > 0 ? (
          <ul className="mt-2 space-y-1 text-[11px] text-mist">
            {geoFiles.map((source) => (
              <li key={source.id}>{source.display_name || source.original_filename}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function LocationForm({
  locked,
  saving,
  onCreate,
}: {
  locked: boolean;
  saving: boolean;
  onCreate: (draft: {
    latitude: number;
    longitude: number;
    supplierReferenceId: string;
  }) => Promise<unknown>;
}) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [ref, setRef] = useState("");

  return (
    <form
      className="rounded-xl bg-white/70 p-3 ring-1 ring-line/60"
      onSubmit={(event) => {
        event.preventDefault();
        const latitude = Number(lat);
        const longitude = Number(lng);
        if (!ref.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        void onCreate({
          latitude,
          longitude,
          supplierReferenceId: ref.trim(),
        }).then(() => {
          setLat("");
          setLng("");
          setRef("");
        });
      }}
    >
      <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
        Measurement location
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <input
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          placeholder="Supplier reference"
          disabled={locked}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <input
          value={lat}
          onChange={(event) => setLat(event.target.value)}
          placeholder="Latitude"
          disabled={locked}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <input
          value={lng}
          onChange={(event) => setLng(event.target.value)}
          placeholder="Longitude"
          disabled={locked}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
      </div>
      <button
        type="submit"
        disabled={locked || saving}
        className="mt-2 rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400 disabled:opacity-40"
      >
        Add location
      </button>
    </form>
  );
}

function SampleForm({
  locked,
  saving,
  onSubmit,
}: {
  locked: boolean;
  saving: boolean;
  onSubmit: (csvText: string, file: File | null) => Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const types = Object.entries(MEASUREMENT_TYPE_LABEL)
    .map(([id, label]) => `${id} (${label})`)
    .join(", ");

  return (
    <div className="rounded-xl bg-white/70 p-3 ring-1 ring-line/60">
      <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
        Sample CSV
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-mist">
        Required columns: <span className="font-mono">supplier_reference_id</span>,{" "}
        <span className="font-mono">measurement_location_id</span>,{" "}
        <span className="font-mono">measurement_date</span>,{" "}
        <span className="font-mono">measurement_type</span>. Extra numeric columns
        become measured values. Types: {types}.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        className="mt-2 block text-[11px] text-mist"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={locked || saving || !file}
        onClick={async () => {
          if (!file) return;
          const csvText = await file.text();
          await onSubmit(csvText, file);
        }}
        className="mt-2 rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400 disabled:opacity-40"
      >
        Upload samples
      </button>
    </div>
  );
}
