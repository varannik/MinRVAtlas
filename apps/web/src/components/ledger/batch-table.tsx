"use client";

import { useEffect, useState } from "react";

import { formatTonnes } from "@/lib/ledger/units";
import type { CreditBatchStatus, NormalizedCreditBatch, Page } from "@/lib/ledger/types";
import { ledgerRequest } from "./client";
import { Banner, fieldClass, quietButtonClass } from "./ui";

const STATUSES: Array<CreditBatchStatus | ""> = ["", "ACTIVE", "RETIRED", "SPLIT"];

/** Status pills on the palette: live credits in olivine, retired ones in deep olivine. */
const STATUS_TONE: Partial<Record<string, string>> = {
  ACTIVE: "bg-olivine-100 text-olivine-800",
  RETIRED: "bg-olivine-800 text-off-white",
  SPLIT: "bg-serpentine-50 text-serpentine-700",
};

export function BatchTable({ reloadToken }: { reloadToken: number }) {
  const [status, setStatus] = useState<CreditBatchStatus | "">("ACTIVE");
  const [after, setAfter] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState<Page<NormalizedCreditBatch> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ first: "20" });
    if (status) params.set("status", status);
    if (after) params.set("after", after);
    void ledgerRequest<Page<NormalizedCreditBatch>>(`/api/ledger/isometric/batches?${params}`)
      .then((data) => {
        if (!cancelled) {
          setPage(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load batches.");
      });
    return () => {
      cancelled = true;
    };
  }, [status, after, reloadToken]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[11.5px] font-medium text-strata-700">
        Status
        <select
          className={`${fieldClass.replace("w-full", "w-44")}`}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as CreditBatchStatus | "");
            setAfter(null);
            setCursorStack([null]);
          }}
        >
          {STATUSES.map((item) => (
            <option key={item || "all"} value={item}>
              {item || "All"}
            </option>
          ))}
        </select>
      </label>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="glass-card overflow-x-auto rounded-2xl">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-strata-300/60 text-[10.5px] font-semibold tracking-[0.12em] text-strata-700 uppercase">
            <tr>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Tonnes</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Owner</th>
            </tr>
          </thead>
          <tbody>
            {page?.nodes.length ? (
              page.nodes.map((batch) => (
                <tr key={batch.id} className="border-t border-strata-300/40 transition-colors first:border-t-0 hover:bg-white/50">
                  <td className="px-3 py-2.5 font-mono text-xs text-earth">{batch.id}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_TONE[batch.status] ?? "bg-strata-300/45 text-strata-700"}`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-earth tabular-nums">{formatTonnes(batch.sizeKg)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-strata-700">{batch.projectId}</td>
                  <td className="px-3 py-2.5 text-strata-700">{batch.ownerName}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-strata-700">
                  {page ? "No credit batches." : "Loading batches…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={quietButtonClass}
          disabled={cursorStack.length <= 1}
          onClick={() => {
            const previous = cursorStack.slice(0, -1);
            setCursorStack(previous);
            setAfter(previous[previous.length - 1] ?? null);
          }}
        >
          Previous
        </button>
        <button
          type="button"
          className={quietButtonClass}
          disabled={!page?.pageInfo.hasNextPage || !page.pageInfo.endCursor}
          onClick={() => {
            const next = page?.pageInfo.endCursor;
            if (!next) return;
            setCursorStack((stack) => [...stack, next]);
            setAfter(next);
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
