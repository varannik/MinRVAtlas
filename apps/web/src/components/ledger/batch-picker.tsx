"use client";

import { useEffect, useState } from "react";

import { formatTonnes, tonnesInputToKg } from "@/lib/ledger/units";
import type { NormalizedCreditBatch, Page } from "@/lib/ledger/types";
import { ledgerRequest } from "./client";
import { Banner, checkClass, fieldClass } from "./ui";

export type SelectedLine = {
  credit_batch_id: string;
  credit_quantity_kg: number;
  availableKg: number;
};

export function BatchPicker({
  reloadToken,
  onChange,
}: {
  reloadToken: number;
  onChange: (lines: SelectedLine[]) => void;
}) {
  const [batches, setBatches] = useState<NormalizedCreditBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void ledgerRequest<Page<NormalizedCreditBatch>>(
      "/api/ledger/isometric/batches?status=ACTIVE&first=50",
    )
      .then((page) => {
        if (cancelled) return;
        setBatches(page.nodes);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load batches.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    const lines: SelectedLine[] = [];
    for (const batch of batches) {
      if (!selected[batch.id]) continue;
      const kg = tonnesInputToKg(quantities[batch.id] ?? "");
      if (kg == null) continue;
      lines.push({
        credit_batch_id: batch.id,
        credit_quantity_kg: kg,
        availableKg: batch.sizeKg,
      });
    }
    onChange(lines);
  }, [batches, quantities, selected, onChange]);

  const incomplete = batches.some(
    (batch) => selected[batch.id] && tonnesInputToKg(quantities[batch.id] ?? "") == null,
  );

  return (
    <div className="space-y-2">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {incomplete ? (
        <p className="text-sm text-jasper">
          Enter tonnes for each selected batch, up to three decimal places.
        </p>
      ) : null}
      {batches.length === 0 && !error ? (
        <p className="text-sm text-strata-700">No active batches.</p>
      ) : null}
      {batches.map((batch) => (
        <label key={batch.id} className="glass-card grid cursor-pointer grid-cols-[auto_1fr_8rem] items-center gap-3 rounded-xl px-3 py-2 text-sm">
          <input
            className={checkClass}
            type="checkbox"
            checked={Boolean(selected[batch.id])}
            onChange={(event) => {
              setSelected((current) => ({ ...current, [batch.id]: event.target.checked }));
            }}
          />
          <span>
            <span className="font-mono text-xs text-earth">{batch.id}</span>
            <span className="ml-2 text-strata-700 tabular-nums">{formatTonnes(batch.sizeKg)} t active</span>
          </span>
          <input
            className={fieldClass}
            inputMode="decimal"
            placeholder="tonnes"
            disabled={!selected[batch.id]}
            value={quantities[batch.id] ?? ""}
            onChange={(event) => {
              setQuantities((current) => ({ ...current, [batch.id]: event.target.value }));
            }}
          />
        </label>
      ))}
    </div>
  );
}
