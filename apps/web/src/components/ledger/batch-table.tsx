"use client";

import { useEffect, useState } from "react";

import { formatTonnes } from "@/lib/ledger/units";
import type { CreditBatchStatus, NormalizedCreditBatch, Page } from "@/lib/ledger/types";
import { ledgerRequest } from "./client";
import { Banner, fieldClass, quietButtonClass } from "./ui";

const STATUSES: Array<CreditBatchStatus | ""> = ["", "ACTIVE", "RETIRED", "SPLIT"];

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
      <label className="flex items-center gap-2 text-xs text-mist">
        Status
        <select
          className={`${fieldClass} w-auto`}
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
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-900 text-[11px] tracking-wide text-mist uppercase">
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
                <tr key={batch.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs text-frost">{batch.id}</td>
                  <td className="px-3 py-2 text-mist">{batch.status}</td>
                  <td className="px-3 py-2 text-frost">{formatTonnes(batch.sizeKg)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-mist">{batch.projectId}</td>
                  <td className="px-3 py-2 text-mist">{batch.ownerName}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-mist">
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
