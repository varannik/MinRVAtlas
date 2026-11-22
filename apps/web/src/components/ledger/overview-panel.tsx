"use client";

import { useEffect, useState } from "react";

import { formatTonnes } from "@/lib/ledger/units";
import type { LedgerConnection, LedgerSummary } from "@/lib/ledger/types";
import { ledgerRequest } from "./client";
import { Banner } from "./ui";

export function OverviewPanel({
  registry,
  connection,
  reloadToken,
}: {
  registry: string;
  connection: LedgerConnection;
  reloadToken: number;
}) {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ledgerRequest<LedgerSummary>(`/api/ledger/summary?registry=${registry}`)
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the ledger.");
      });
    return () => {
      cancelled = true;
    };
  }, [registry, reloadToken]);

  const expires = connection.credentialExpiresAt
    ? new Date(connection.credentialExpiresAt)
    : null;
  const expiryLabel =
    expires && !Number.isNaN(expires.getTime())
      ? expires.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : null;
  const expirySoon = connection.credentialExpiresSoon;

  return (
    <div className="space-y-4">
      {expiryLabel ? (
        <Banner kind={expirySoon ? "error" : "info"}>
          The Isometric access token expires on {expiryLabel}, one year after it was issued.
        </Banner>
      ) : null}
      {registry === "all" ? (
        <Banner kind="info">
          All registries are shown separately. Totals are not added together, and changes stay off.
        </Banner>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {(summary?.entries ?? []).map((entry) => (
          <article key={entry.registry} className="glass-card rounded-2xl p-5">
            <div className="text-[10.5px] font-semibold tracking-[0.14em] text-strata-700 uppercase">{entry.label}</div>
            {!entry.enabled || !entry.balance ? (
              <p className="mt-3 text-sm text-strata-700">{entry.message ?? "No inventory."}</p>
            ) : (
              <>
                <dl className="mt-3 grid grid-cols-2 gap-2">
                  <div className="glass-well rounded-xl px-3 py-2.5">
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium text-strata-700">
                      <span className="size-1.5 rounded-full bg-olivine-500" aria-hidden />
                      Active
                    </dt>
                    <dd className="mt-1 text-[22px] leading-none font-semibold tracking-tight text-earth tabular-nums">
                      {formatTonnes(entry.balance.activeKg)} <span className="text-[12px] font-medium text-strata-700">t</span>
                    </dd>
                  </div>
                  <div className="glass-well rounded-xl px-3 py-2.5">
                    <dt className="flex items-center gap-1.5 text-[11px] font-medium text-strata-700">
                      <span className="size-1.5 rounded-full bg-olivine-800" aria-hidden />
                      Retired
                    </dt>
                    <dd className="mt-1 text-[22px] leading-none font-semibold tracking-tight text-earth tabular-nums">
                      {formatTonnes(entry.balance.retiredKg)} <span className="text-[12px] font-medium text-strata-700">t</span>
                    </dd>
                  </div>
                </dl>
                <ul className="mt-4 space-y-2 text-sm">
                  {entry.balance.projects.length === 0 ? (
                    <li className="text-strata-700">No project totals.</li>
                  ) : (
                    entry.balance.projects.map((project) => (
                      <li key={project.projectId} className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-mono text-xs text-strata-700">{project.projectId}</span>
                        <span className="shrink-0 text-earth tabular-nums">
                          {formatTonnes(project.activeKg)} t active
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
