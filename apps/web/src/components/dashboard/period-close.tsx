"use client";

import { useState } from "react";
import { dueMandatorySlots, periodCloseReady } from "@/lib/submissions";
import { useDashboard } from "@/store/dashboard-store";
import { usePeriodStore } from "@/store/period-store";
import type { SubmissionBatch } from "@/lib/types";

export function PeriodCloseBar({ batch }: { batch: SubmissionBatch }) {
  const tenantId = useDashboard((state) => state.tenantId);
  const specMeta = useDashboard((state) => state.specMeta);
  const markStatus = usePeriodStore((state) => state.markStatus);
  const [reportUrl, setReportUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = periodCloseReady(batch);
  const due = dueMandatorySlots(batch);
  const live = specMeta?.origin === "registry-api";

  if (batch.status !== "assembling" || !ready || !live) return null;

  async function closePeriod() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("target", "ghg");
    form.set("project_id", batch.projectId);
    form.set("batch_id", batch.id);
    form.set("ghg_statement_report_url", reportUrl.trim());
    form.set("submitted_slot_ids", due.map((item) => item.slotId).join(","));
    form.set("mandatory_slot_ids", due.map((item) => item.slotId).join(","));
    if (batch.ghgStatementId) form.set("ghg_statement_id", batch.ghgStatementId);

    try {
      const response = await fetch("/api/registry/submit", {
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
      markStatus(
        batch.projectId,
        batch.id,
        "in-verification",
        body.statementId ?? batch.ghgStatementId,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Period close failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-1.5">
      <input
        type="url"
        value={reportUrl}
        onChange={(event) => setReportUrl(event.target.value)}
        placeholder="GHG statement report URL"
        className="w-full rounded-lg bg-ink-800/60 px-2.5 py-1.5 text-[11px] text-frost ring-1 ring-line/70 focus:outline-none"
      />
      <button
        type="button"
        disabled={busy || !reportUrl.trim()}
        onClick={() => void closePeriod()}
        className="rounded-lg bg-serpentine px-2.5 py-1 text-[11px] font-semibold text-off-white disabled:bg-ink-700 disabled:text-mist"
      >
        {busy ? "Closing…" : "Close period"}
      </button>
      {error ? <p className="text-[10px] text-signal-rose">{error}</p> : null}
    </div>
  );
}
