"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ACCOUNTING_TAB_LABEL,
  ACCOUNTING_TABS,
  formatKgCo2e,
  recipeFromTemplate,
  type AccountingTab,
} from "@/lib/accounting";
import { SUBMISSION_STATUS_META } from "@/lib/submissions";
import { useAccounting } from "@/hooks/use-accounting";
import { useDashboard } from "@/store/dashboard-store";
import { usePeriodStore } from "@/store/period-store";
import { boardSlot } from "../scene/requirement-anchor";
import type { Project, RequirementItem, SubmissionBatch } from "@/lib/types";
import { GhgEntryPanel } from "./ghg-entry-panel";
import { LcaRecipeCard } from "./lca-recipe";
import { PeriodCloseBar } from "./period-close";

function StatementPanel({
  project,
  batch,
  snapshot,
  onReload,
}: {
  project: Project;
  batch: SubmissionBatch;
  snapshot: ReturnType<typeof useAccounting>["snapshot"];
  onReload: () => Promise<void>;
}) {
  const tenantId = useDashboard((state) => state.tenantId);
  const selectRequirement = useDashboard((state) => state.selectRequirement);
  const markStatus = usePeriodStore((state) => state.markStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const statement = snapshot?.statements[0];
  const due = batch.items.filter((item) => item.dueThisPeriod && item.mandatory);

  async function createStatement() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("action", "create-statement");
    form.set("project_id", project.id);
    form.set("batch_id", batch.id);
    form.set("end_on", batch.periodEnd);
    try {
      const response = await fetch("/api/registry/accounting", {
        method: "POST",
        headers: { "x-tenant-id": tenantId },
        body: form,
      });
      const body = (await response.json()) as {
        ok?: boolean;
        blocked?: string;
        error?: string;
        statementId?: string;
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.blocked || body.error || response.statusText);
      }
      if (body.statementId) {
        markStatus(project.id, batch.id, "assembling", body.statementId);
      }
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create statement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-mist">
        A GHG statement is the folder for this reporting period. GHG entries
        whose completed-on date falls in the window are pulled in automatically.
        Periods must stay contiguous — Certify infers the start from the previous
        statement or the earliest entry.
      </p>

      {statement ? (
        <article className="rounded-xl bg-off-white/80 px-3 py-2.5 ring-1 ring-line/60">
          <p className="font-mono text-[12px] font-semibold text-frost">{statement.id}</p>
          <p className="mt-1 text-[11px] text-mist">
            {statement.status} · {statement.periodStart ?? batch.periodStart} →{" "}
            {statement.periodEnd ?? batch.periodEnd} · {formatKgCo2e(statement.netKg)}
          </p>
          <p className="mt-1 text-[10px] text-mist">
            {snapshot?.entries.filter((entry) => entry.statementId === statement.id).length ?? 0}{" "}
            assigned GHG entries
          </p>
        </article>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void createStatement()}
          className="rounded-xl bg-carbon-400 px-3 py-2 text-[12px] font-semibold text-off-white disabled:bg-ink-700 disabled:text-mist"
        >
          {busy ? "Creating…" : "Create GHG statement"}
        </button>
      )}

      <section>
        <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
          GHG entries in this window
        </h3>
        {(snapshot?.entries.length ?? 0) === 0 ? (
          <p className="mt-1 text-[11px] text-mist">
            None yet. Fill monitored inputs on GHG entry data, run quality, then
            create the entry.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {snapshot?.entries.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] text-frost ring-1 ring-line/50"
              >
                {entry.id}
                <span className="ml-2 font-sans text-[10px] text-mist">
                  {entry.completedOn} · {formatKgCo2e(entry.netKg)}
                  {entry.statementId ? " · assigned" : " · not on a statement"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
          Monitoring coverage
        </h3>
        <p className="mt-1 text-[11px] text-mist">
          {batch.monitoringCoverage === "valid"
            ? "Every due monitoring requirement is covered for this window."
            : batch.monitoringCoverage === "partial"
              ? "Some monitoring dates are still missing."
              : due.length === 0
                ? "No operational monitoring slots are due in this window."
                : "Nothing filed against due monitoring requirements yet."}
        </p>
        {due.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {due.map((item: RequirementItem) => (
              <li key={item.slotId}>
                <button
                  type="button"
                  onClick={() => selectRequirement(item.slotId)}
                  className="flex w-full items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-left text-[11px] ring-1 ring-line/50 hover:ring-carbon-400/40"
                >
                  <span className="text-frost">{item.label}</span>
                  <span className="text-[10px] tracking-wide text-mist uppercase">
                    {item.state}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {error ? <p className="text-[11px] text-signal-rose">{error}</p> : null}
      <PeriodCloseBar batch={batch} />
    </div>
  );
}

function EmissionsPanel({
  snapshot,
}: {
  snapshot: ReturnType<typeof useAccounting>["snapshot"];
}) {
  const groups =
    snapshot?.templates[0]?.groups.filter((group) => group.role === "project-emissions") ??
    [];
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-mist">
        Project emissions are one-off establishment and end-of-life GHGs — well
        construction, plant steel, decommissioning — not this month’s kWh. They
        are amortized onto unverified statements. Create them on the LCA in
        Certify; this desk shows the recipe Certify already holds.
      </p>
      {groups.length === 0 ? (
        <p className="text-[12px] text-mist">
          No project-emission components came back on the GHG entry template.
          Add them under Project establishment &amp; end of life in Certify, then
          pick an amortization rule (estimated tonnage, lifetime, target date, or
          manual).
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.id}
            className="rounded-xl bg-off-white/80 px-3 py-2.5 ring-1 ring-line/60"
          >
            <h3 className="text-[13px] font-semibold text-frost">{group.name}</h3>
            {group.description ? (
              <p className="mt-1 text-[11px] text-mist">{group.description}</p>
            ) : null}
            <ul className="mt-2 space-y-1.5">
              {group.components.map((component) => (
                <li
                  key={component.id}
                  className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-line/50"
                >
                  <p className="text-[12px] font-medium text-frost">{component.name}</p>
                  {component.blueprint ? (
                    <p className="text-[10px] text-mist">{component.blueprint}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function LcaPanel({
  snapshot,
}: {
  snapshot: ReturnType<typeof useAccounting>["snapshot"];
}) {
  const template = snapshot?.templates[0];
  if (!template) {
    return (
      <p className="py-8 text-[13px] leading-relaxed text-mist">
        The LCA lives in Certify. Start from the protocol default, fill project
        operations and project emissions, run data checks, then convert project
        operations into a GHG entry template. This desk reads that template; it
        does not edit the LCA.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-mist">
        Read-only copy of the frozen GHG entry template. Fixed inputs stay on the
        LCA; monitored inputs are filled each period on GHG entry data. Net
        negativity needs sequestration, operational emissions, and project
        emissions.
      </p>
      <LcaRecipeCard recipe={recipeFromTemplate(template)} />
    </div>
  );
}

export function PeriodDesk({
  project,
  batch,
}: {
  project: Project;
  batch: SubmissionBatch;
}) {
  const [tab, setTab] = useState<AccountingTab>("entries");
  const { snapshot, loading, reload } = useAccounting(
    project,
    batch.periodStart,
    batch.periodEnd,
  );
  const status = SUBMISSION_STATUS_META[batch.status];
  const ready = batch.items.length - batch.outstanding;

  useEffect(() => {
    boardSlot.covered = true;
    return () => {
      boardSlot.covered = false;
    };
  }, []);

  const headerMeta = useMemo(
    () =>
      `${batch.periodLabel} · ${batch.volume} tCO₂e · ${batch.specVersion}`,
    [batch.periodLabel, batch.specVersion, batch.volume],
  );

  return (
    <article className="pointer-events-auto flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgba(2,6,14,0.12)] ring-1 ring-line/70">
      <header className="flex items-start justify-between gap-3 border-b border-line/60 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-[15px] font-semibold text-frost">
            {batch.id}
          </h2>
          <p className="mt-1 text-[12px] text-mist">{headerMeta}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[28px] leading-none font-semibold text-canyon">
            {batch.completion}%
          </p>
          <p className="mt-1 text-[10px] font-semibold tracking-[0.12em] text-mist uppercase">
            {status.label} · {ready}/{batch.items.length} ready
          </p>
        </div>
      </header>

      <div className="flex gap-1 border-b border-line/60 px-3 pt-2">
        {ACCOUNTING_TABS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-t-lg px-3 py-2 text-[11px] font-semibold ${
              tab === id
                ? "bg-off-white text-frost"
                : "text-mist hover:text-frost"
            }`}
          >
            {ACCOUNTING_TAB_LABEL[id]}
          </button>
        ))}
      </div>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="py-8 text-[13px] text-mist">Reading GHG templates from Certify…</p>
        ) : null}
        {!loading && tab === "entries" && snapshot ? (
          <GhgEntryPanel
            project={project}
            batch={batch}
            snapshot={snapshot}
            onReload={reload}
          />
        ) : null}
        {!loading && tab === "statements" ? (
          <StatementPanel
            project={project}
            batch={batch}
            snapshot={snapshot}
            onReload={reload}
          />
        ) : null}
        {!loading && tab === "emissions" ? <EmissionsPanel snapshot={snapshot} /> : null}
        {!loading && tab === "lca" ? <LcaPanel snapshot={snapshot} /> : null}
      </div>

      <footer className="flex items-center justify-between border-t border-line/60 px-5 py-2.5 font-mono text-[11px] text-mist">
        <span>hash {batch.hash}</span>
        <span>parent {batch.parentHash ?? "genesis"}</span>
      </footer>
    </article>
  );
}
