"use client";

import { useState } from "react";
import {
  FREQUENCY_LABEL,
  PHASE_META,
  STORAGE_METHOD_LABEL,
  STORAGE_METHODS,
  type StorageMethod,
} from "@/lib/registries/isometric/api";
import { siteSourcePrefix } from "@/lib/registries/isometric/pdd-catalog";
import type { ProjectSetupSnapshot, SetupSite } from "@/lib/registries/isometric/setup-types";
import type { Project } from "@/lib/types";
import { useProjectSetup } from "@/hooks/use-project-setup";

function methodLabel(value: string | undefined): string {
  if (!value) return "Storage method not set";
  return STORAGE_METHOD_LABEL[value as StorageMethod] ?? value.replaceAll("_", " ");
}

export function SitesTab({
  project,
  snapshot,
  locked,
}: {
  project: Project;
  snapshot: ProjectSetupSnapshot;
  locked: boolean;
}) {
  const { submit, saving } = useProjectSetup(project);
  const [selectedId, setSelectedId] = useState<string | null>(
    snapshot.sites[0]?.location.id ?? null,
  );
  const selected =
    snapshot.sites.find((row) => row.location.id === selectedId) ?? snapshot.sites[0];

  return (
    <div className="scroll-slim min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <AddSiteForm
        disabled={locked}
        saving={saving}
        onCreate={async (draft) => {
          const result = await submit({
            action: "createStorageLocation",
            ...draft,
          });
          if (result.ids[0]) setSelectedId(result.ids[0]);
        }}
      />

      {snapshot.sites.length === 0 ? (
        <p className="px-1 py-4 text-sm text-mist">
          No storage sites in Certify yet. Add a point site here, or upload polygons in
          Certify.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {snapshot.sites.map((site) => (
            <li key={site.location.id}>
              <button
                type="button"
                onClick={() => setSelectedId(site.location.id)}
                className={`w-full rounded-xl px-3 py-2 text-left ring-1 ${
                  selected?.location.id === site.location.id
                    ? "bg-carbon-400/10 ring-carbon-400/40"
                    : "bg-white/70 ring-line/60"
                }`}
              >
                <p className="text-[13px] font-medium text-frost">{site.location.name}</p>
                <p className="mt-0.5 text-[11px] text-mist">
                  {methodLabel(site.location.storage_method)}
                  {site.location.latitude != null && site.location.longitude != null
                    ? ` · ${site.location.latitude.toFixed(4)}, ${site.location.longitude.toFixed(4)}`
                    : ""}
                  {` · ${site.submissions.length} monitoring file${site.submissions.length === 1 ? "" : "s"}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <SiteDetail
          key={selected.location.id}
          site={selected}
          snapshot={snapshot}
          locked={locked}
          saving={saving}
          onPatch={(draft) =>
            submit({
              action: "patchStorageLocation",
              locationId: selected.location.id,
              ...draft,
            })
          }
          onUpload={(notes, file) =>
            submit(
              { action: "uploadSiteSource", locationId: selected.location.id, notes },
              [file],
            )
          }
          onMonitor={(requirementIds, notes, file, periodStart, periodEnd) =>
            submit(
              {
                action: "submitSiteMonitoring",
                locationId: selected.location.id,
                requirementIds,
                notes,
                periodStart,
                periodEnd,
              },
              [file],
            )
          }
        />
      ) : null}
    </div>
  );
}

function AddSiteForm({
  disabled,
  saving,
  onCreate,
}: {
  disabled: boolean;
  saving: boolean;
  onCreate: (draft: {
    name: string;
    latitude: number;
    longitude: number;
    storageMethod: StorageMethod;
    description?: string;
    supplierReferenceId?: string;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [method, setMethod] = useState<StorageMethod>("in_situ_mineralization");
  const [ref, setRef] = useState("");

  return (
    <form
      className="rounded-xl bg-white/70 p-3 ring-1 ring-line/60"
      onSubmit={(event) => {
        event.preventDefault();
        const latitude = Number(lat);
        const longitude = Number(lng);
        if (!name.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        void onCreate({
          name: name.trim(),
          latitude,
          longitude,
          storageMethod: method,
          supplierReferenceId: ref.trim() || undefined,
        }).then(() => {
          setName("");
          setLat("");
          setLng("");
          setRef("");
        });
      }}
    >
      <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
        Add point site
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          disabled={disabled}
          className="col-span-2 rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <input
          value={lat}
          onChange={(event) => setLat(event.target.value)}
          placeholder="Latitude"
          disabled={disabled}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <input
          value={lng}
          onChange={(event) => setLng(event.target.value)}
          placeholder="Longitude"
          disabled={disabled}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value as StorageMethod)}
          disabled={disabled}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        >
          {STORAGE_METHODS.map((row) => (
            <option key={row} value={row}>
              {STORAGE_METHOD_LABEL[row]}
            </option>
          ))}
        </select>
        <input
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          placeholder="Supplier reference (optional)"
          disabled={disabled}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
      </div>
      <button
        type="submit"
        disabled={disabled || saving}
        className="mt-2 rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400 disabled:opacity-40"
      >
        Create in Certify
      </button>
      <p className="mt-1.5 text-[10px] text-mist">
        API sites are latitude/longitude points. Native polygon geometry still
        has to be uploaded in Certify.
      </p>
    </form>
  );
}

function SiteDetail({
  site,
  snapshot,
  locked,
  saving,
  onPatch,
  onUpload,
  onMonitor,
}: {
  site: SetupSite;
  snapshot: ProjectSetupSnapshot;
  locked: boolean;
  saving: boolean;
  onPatch: (draft: {
    name?: string;
    latitude?: number;
    longitude?: number;
    storageMethod?: StorageMethod;
    description?: string;
  }) => Promise<unknown>;
  onUpload: (notes: string, file: File) => Promise<unknown>;
  onMonitor: (
    requirementIds: string[],
    notes: string,
    file: File,
    periodStart?: string,
    periodEnd?: string,
  ) => Promise<unknown>;
}) {
  const [name, setName] = useState(site.location.name);
  const [lat, setLat] = useState(String(site.location.latitude ?? ""));
  const [lng, setLng] = useState(String(site.location.longitude ?? ""));
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [requirementId, setRequirementId] = useState(
    site.requirements[0]?.id ?? "",
  );
  const siteFiles = snapshot.sources.filter((source) =>
    (source.supplier_reference_id ?? "").startsWith(siteSourcePrefix(site.location.id)),
  );

  return (
    <div className="space-y-3 rounded-xl bg-white/70 p-3 ring-1 ring-line/60">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-frost">Site details</p>
        <span className="font-mono text-[10px] text-mist">{site.location.id}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={locked}
          className="col-span-2 rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <input
          value={lat}
          onChange={(event) => setLat(event.target.value)}
          disabled={locked}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <input
          value={lng}
          onChange={(event) => setLng(event.target.value)}
          disabled={locked}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
      </div>
      <button
        type="button"
        disabled={locked || saving}
        onClick={() =>
          void onPatch({
            name,
            latitude: Number(lat),
            longitude: Number(lng),
          })
        }
        className="rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400 disabled:opacity-40"
      >
        Save site
      </button>

      <div>
        <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
          Monitoring requirements
        </p>
        {site.requirements.length === 0 ? (
          <p className="mt-1 text-[11px] text-mist">
            No site-level monitoring requirements came back from Certify.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {site.requirements.map((row) => (
              <li key={row.id} className="text-[11px] text-frost">
                {row.display_name}
                <span className="ml-1 text-mist">
                  {PHASE_META[row.monitoring_phase]?.title ?? row.monitoring_phase}
                  {row.frequency ? ` · ${FREQUENCY_LABEL[row.frequency]}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {site.requirements.length > 0 ? (
        <div className="space-y-2">
          <select
            value={requirementId}
            onChange={(event) => setRequirementId(event.target.value)}
            className="w-full rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
          >
            {site.requirements.map((row) => (
              <option key={row.id} value={row.id}>
                {row.display_name}
              </option>
            ))}
          </select>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notes / page numbers"
            className="w-full rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
          />
          <div className="flex items-center justify-between gap-2">
            <input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="text-[11px] text-mist"
            />
            <button
              type="button"
              disabled={!file || !requirementId || saving}
              onClick={() => {
                if (!file) return;
                void onMonitor([requirementId], notes, file);
              }}
              className="rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400 disabled:opacity-40"
            >
              Attach monitoring
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <input
            type="file"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (next) void onUpload("Site geometry or evidence", next);
            }}
            className="text-[11px] text-mist"
          />
        </div>
      )}

      {siteFiles.length > 0 ? (
        <ul className="space-y-1 text-[11px] text-mist">
          {siteFiles.map((source) => (
            <li key={source.id}>{source.display_name || source.original_filename}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
