"use client";

import { useEffect, useState } from "react";

import { formatTonnes } from "@/lib/ledger/units";
import type { NormalizedCreditBatch, NormalizedTransaction, Page } from "@/lib/ledger/types";
import { ledgerRequest } from "./client";
import { Banner, quietButtonClass } from "./ui";

type Kind = "delivery" | "transfer" | "retirement";

type Row = NormalizedTransaction & { kind: Kind };

const PATHS: Record<Kind, string> = {
  delivery: "deliveries",
  transfer: "transfers",
  retirement: "retirements",
};

async function quantityFor(kind: Kind, row: NormalizedTransaction): Promise<number | null> {
  if (row.quantityKg != null) return row.quantityKg;
  let after: string | null = null;
  let total = 0;
  let sawBatch = false;
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const params = new URLSearchParams({ first: "50" });
    if (after) params.set("after", after);
    const page = await ledgerRequest<Page<NormalizedCreditBatch>>(
      `/api/ledger/isometric/${PATHS[kind]}/${row.id}/credit-batches?${params}`,
    );
    for (const batch of page.nodes) {
      sawBatch = true;
      total += batch.sizeKg;
    }
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return sawBatch ? total : null;
}

async function loadKind(kind: Kind, after: string | null): Promise<Page<Row>> {
  const params = new URLSearchParams({ first: "20" });
  if (after) params.set("after", after);
  const page = await ledgerRequest<Page<NormalizedTransaction>>(
    `/api/ledger/isometric/${PATHS[kind]}?${params}`,
  );
  const nodes = await Promise.all(
    page.nodes.map(async (row) => ({
      ...row,
      kind,
      quantityKg: await quantityFor(kind, row),
    })),
  );
  return { ...page, nodes };
}

export function ActivityPanel({ reloadToken }: { reloadToken: number }) {
  const [rows, setRows] = useState<Record<Kind, Row[]>>({
    delivery: [],
    transfer: [],
    retirement: [],
  });
  const [more, setMore] = useState<Record<Kind, string | null>>({
    delivery: null,
    transfer: null,
    retirement: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const lists = await Promise.all(
          (Object.keys(PATHS) as Kind[]).map((kind) => loadKind(kind, null)),
        );
        if (cancelled) return;
        const nextRows = { delivery: [], transfer: [], retirement: [] } as Record<Kind, Row[]>;
        const nextMore = { delivery: null, transfer: null, retirement: null } as Record<Kind, string | null>;
        (Object.keys(PATHS) as Kind[]).forEach((kind, index) => {
          nextRows[kind] = lists[index].nodes;
          nextMore[kind] = lists[index].pageInfo.hasNextPage ? lists[index].pageInfo.endCursor : null;
        });
        setRows(nextRows);
        setMore(nextMore);
        setReady(true);
        setError(null);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load activity.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const merged = (Object.keys(PATHS) as Kind[])
    .flatMap((kind) => rows[kind])
    .sort((a, b) => b.at.localeCompare(a.at));

  async function older(kind: Kind) {
    const cursor = more[kind];
    if (!cursor) return;
    try {
      const page = await loadKind(kind, cursor);
      setRows((current) => ({ ...current, [kind]: [...current[kind], ...page.nodes] }));
      setMore((current) => ({
        ...current,
        [kind]: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load older activity.");
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Banner kind="error">{error}</Banner> : null}
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {merged.length ? (
          merged.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="grid grid-cols-[7rem_1fr_auto] gap-3 px-3 py-2 text-sm">
              <span className="text-mist capitalize">{row.kind}</span>
              <span>
                <span className="font-mono text-xs text-frost">{row.id}</span>
                {row.counterparty ? <span className="ml-2 text-mist">{row.counterparty}</span> : null}
                {row.url ? (
                  <a href={row.url} target="_blank" rel="noreferrer" className="ml-2 text-carbon-400 underline">
                    Certificate
                  </a>
                ) : null}
              </span>
              <span className="text-frost">
                {row.quantityKg == null ? "Quantity unavailable" : `${formatTonnes(row.quantityKg)} t`}
              </span>
            </li>
          ))
        ) : (
          <li className="px-3 py-4 text-sm text-mist">{ready ? "No activity yet." : "Loading activity…"}</li>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PATHS) as Kind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className={quietButtonClass}
            disabled={!more[kind]}
            onClick={() => void older(kind)}
          >
            Older {kind}s
          </button>
        ))}
      </div>
    </div>
  );
}
