"use client";

import { useState } from "react";
import { CERTIFY_ACCOUNT_URL, feedstockSourcePrefix } from "@/lib/registries/isometric/pdd-catalog";
import type { FeedstockType } from "@/lib/registries/isometric/api";
import type { ProjectSetupSnapshot } from "@/lib/registries/isometric/setup-types";
import type { Project } from "@/lib/types";
import { useProjectSetup } from "@/hooks/use-project-setup";

export function FeedstocksTab({
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
    snapshot.feedstockTypes[0]?.id ?? null,
  );
  const selected =
    snapshot.feedstockTypes.find((row) => row.id === selectedId) ??
    snapshot.feedstockTypes[0];
  const batches = snapshot.feedstockBatches.filter(
    (row) => !selected || row.feedstock_type_id === selected.id,
  );

  return (
    <div className="scroll-slim min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <p className="text-[12px] leading-relaxed text-mist">
        Feedstock types can only be created in Certify. Once they exist, you can
        rename them, add batches, and attach evidence here.
      </p>
      <a
        href={CERTIFY_ACCOUNT_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex text-[11px] font-medium text-carbon-400 hover:underline"
      >
        Create feedstock type in Certify
      </a>

      {snapshot.feedstockTypes.length === 0 ? (
        <p className="py-4 text-sm text-mist">No feedstock types in this organisation yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {snapshot.feedstockTypes.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setSelectedId(row.id)}
                className={`w-full rounded-xl px-3 py-2 text-left ring-1 ${
                  selected?.id === row.id
                    ? "bg-carbon-400/10 ring-carbon-400/40"
                    : "bg-white/70 ring-line/60"
                }`}
              >
                <p className="text-[13px] font-medium text-frost">{row.name}</p>
                <p className="font-mono text-[10px] text-mist">{row.id}</p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <TypeDetail
          key={selected.id}
          type={selected}
          batches={batches}
          snapshot={snapshot}
          locked={locked}
          saving={saving}
          onPatch={(name, supplierReferenceId) =>
            submit({
              action: "patchFeedstockType",
              feedstockTypeId: selected.id,
              name,
              supplierReferenceId,
            })
          }
          onBatch={(draft) =>
            submit({
              action: "createFeedstockBatch",
              feedstockTypeId: selected.id,
              ...draft,
            })
          }
          onDeleteBatch={(batchId) => submit({ action: "deleteFeedstockBatch", batchId })}
          onEvidence={(notes, file) =>
            submit(
              {
                action: "uploadFeedstockSource",
                feedstockTypeId: selected.id,
                notes,
              },
              [file],
            )
          }
        />
      ) : null}
    </div>
  );
}

function TypeDetail({
  type,
  batches,
  snapshot,
  locked,
  saving,
  onPatch,
  onBatch,
  onDeleteBatch,
  onEvidence,
}: {
  type: FeedstockType;
  batches: ProjectSetupSnapshot["feedstockBatches"];
  snapshot: ProjectSetupSnapshot;
  locked: boolean;
  saving: boolean;
  onPatch: (name: string, supplierReferenceId?: string) => Promise<unknown>;
  onBatch: (draft: {
    displayName: string;
    deliveryDate: string;
    magnitude: number;
    unit: string;
    supplierReferenceId?: string;
  }) => Promise<unknown>;
  onDeleteBatch: (batchId: string) => Promise<unknown>;
  onEvidence: (notes: string, file: File) => Promise<unknown>;
}) {
  const [name, setName] = useState(type.name);
  const [ref, setRef] = useState(type.supplier_reference_id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [mass, setMass] = useState("");
  const [unit, setUnit] = useState("kg");
  const files = snapshot.sources.filter((source) =>
    (source.supplier_reference_id ?? "").startsWith(feedstockSourcePrefix(type.id)),
  );

  return (
    <div className="space-y-3 rounded-xl bg-white/70 p-3 ring-1 ring-line/60">
      <div className="grid grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={locked}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <input
          value={ref}
          onChange={(event) => setRef(event.target.value)}
          disabled={locked}
          placeholder="Supplier reference"
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
      </div>
      <button
        type="button"
        disabled={locked || saving}
        onClick={() => void onPatch(name, ref)}
        className="rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400 disabled:opacity-40"
      >
        Save type
      </button>

      <p className="text-[10px] font-semibold tracking-[0.14em] text-mist uppercase">
        Batches
      </p>
      {batches.length === 0 ? (
        <p className="text-[11px] text-mist">No batches for this type.</p>
      ) : (
        <ul className="space-y-1">
          {batches.map((batch) => (
            <li
              key={batch.id}
              className="flex items-center justify-between gap-2 text-[12px] text-frost"
            >
              <span>
                {batch.display_name} · {batch.delivery_date}
                {batch.mass
                  ? ` · ${batch.mass.magnitude} ${batch.mass.unit}`
                  : ""}
              </span>
              <button
                type="button"
                disabled={locked || saving}
                onClick={() => void onDeleteBatch(batch.id)}
                className="text-[10px] text-signal-rose disabled:opacity-40"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Batch name"
          disabled={locked}
          className="col-span-2 rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <input
          type="date"
          value={deliveryDate}
          onChange={(event) => setDeliveryDate(event.target.value)}
          disabled={locked}
          className="rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
        />
        <div className="flex gap-1">
          <input
            value={mass}
            onChange={(event) => setMass(event.target.value)}
            placeholder="Mass"
            disabled={locked}
            className="w-full rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
          />
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            disabled={locked}
            className="w-16 rounded-lg bg-ink-800/80 px-2 py-1.5 text-[12px] text-frost"
          />
        </div>
      </div>
      <button
        type="button"
        disabled={locked || saving || !displayName || !deliveryDate || !mass}
        onClick={() =>
          void onBatch({
            displayName,
            deliveryDate,
            magnitude: Number(mass),
            unit,
          })
        }
        className="rounded-lg bg-carbon-400/15 px-3 py-1.5 text-[11px] font-semibold text-carbon-400 disabled:opacity-40"
      >
        Add batch
      </button>

      <label className="block text-[11px] text-mist">
        Supporting evidence
        <input
          type="file"
          className="mt-1 block text-[11px]"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onEvidence("Feedstock supporting evidence", file);
          }}
        />
      </label>
      {files.length > 0 ? (
        <ul className="space-y-1 text-[11px] text-mist">
          {files.map((source) => (
            <li key={source.id}>{source.display_name || source.original_filename}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
