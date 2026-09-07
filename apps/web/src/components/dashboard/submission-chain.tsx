"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { statusFill } from "@/lib/brand";
import { SUBMISSION_STATUS_META } from "@/lib/submissions";
import { useDashboard } from "@/store/dashboard-store";
import { usePeriodStore } from "@/store/period-store";
import type { ReportingPeriod } from "@/lib/period-desk";
import type { SubmissionBatch } from "@/lib/types";

const WINDOW_SIZE = 3;

export function SubmissionChain({
  batches,
  activeId,
  notBefore,
  tenantId,
}: {
  batches: SubmissionBatch[];
  activeId: string | null;
  notBefore?: string | null;
  tenantId: string;
}) {
  const selectSubmission = useDashboard((state) => state.selectSubmission);
  const projectId = useDashboard((state) => state.selectedProjectId);
  const addDraft = usePeriodStore((state) => state.addDraft);
  const removePeriod = usePeriodStore((state) => state.removePeriod);
  const mergeFetched = usePeriodStore((state) => state.mergeFetched);
  const activeIndex = batches.findIndex((b) => b.id === activeId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const defaultStart = Math.max(
    0,
    Math.min(Math.max(batches.length - WINDOW_SIZE, 0), Math.max(activeIndex, 0) - 1),
  );
  const [windowStart, setWindowStart] = useState(defaultStart);

  const clampedStart = useMemo(() => {
    const ideal = Math.max(
      0,
      Math.min(Math.max(batches.length - WINDOW_SIZE, 0), Math.max(activeIndex, 0) - 1),
    );
    if (activeIndex < windowStart || activeIndex >= windowStart + WINDOW_SIZE) {
      return ideal;
    }
    return windowStart;
  }, [activeIndex, batches.length, windowStart]);

  const start = Math.max(0, clampedStart);
  const end = Math.min(batches.length, start + WINDOW_SIZE);
  const visible = batches.slice(start, end);
  const showWindow = batches.length > WINDOW_SIZE;
  const hasOlder = showWindow && start > 0;
  const hasNewer = showWindow && end < batches.length;

  function startPeriod() {
    if (!projectId) return;
    const result = addDraft(projectId, startDate, endDate, notBefore);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setFormError(null);
    setFormOpen(false);
    selectSubmission(result.period.id);
  }

  async function removeBox(batch: SubmissionBatch) {
    if (!projectId || removingId) return;
    const filed = batch.origin === "certify";
    const confirmed = window.confirm(
      filed
        ? `Remove ${batch.periodLabel}? Monitoring files already in Certify for these dates will be deleted. A GHG statement that has already been submitted cannot be deleted by Certify’s API.`
        : `Remove ${batch.periodLabel}? This period has not been sent to the registry.`,
    );
    if (!confirmed) return;

    setRemovingId(batch.id);
    setFormError(null);
    try {
      if (filed) {
        const response = await fetch("/api/registry/periods", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-tenant-id": tenantId,
          },
          body: JSON.stringify({
            projectId,
            periodStart: batch.periodStart,
            periodEnd: batch.periodEnd,
            ghgStatementId: batch.ghgStatementId,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          warnings?: string[];
        } | null;
        if (!response.ok) {
          setFormError(payload?.error ?? "Could not withdraw this period from Certify.");
          return;
        }
        if (payload?.warnings?.length) {
          setFormError(payload.warnings[payload.warnings.length - 1]);
        }
        const listed = await fetch(
          `/api/registry/periods?projectId=${encodeURIComponent(projectId)}`,
          { headers: { "x-tenant-id": tenantId } },
        );
        const next = (await listed.json().catch(() => null)) as {
          periods?: ReportingPeriod[];
        } | null;
        mergeFetched(projectId, next?.periods ?? []);
      } else {
        removePeriod(projectId, batch.id);
      }
      const remaining = usePeriodStore.getState().byProject[projectId] ?? [];
      if (!remaining.some((period) => period.id === batch.id) && activeId === batch.id) {
        selectSubmission(null);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Remove failed");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <nav
      aria-label="Reporting periods"
      className="pointer-events-auto relative flex h-12 items-center justify-center gap-1"
    >
      {showWindow ? (
        <button
          type="button"
          disabled={!hasOlder}
          onClick={() => setWindowStart(Math.max(0, start - 1))}
          aria-label="Show older periods"
          className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${
            hasOlder
              ? "bg-white text-frost ring-1 ring-line hover:ring-carbon-400/40"
              : "text-transparent"
          }`}
        >
          <ChevronLeft className="size-4" />
        </button>
      ) : null}

      {visible.map((batch, i) => {
        const active = batch.id === activeId;
        const status = SUBMISSION_STATUS_META[batch.status];
        const prev = i > 0 ? visible[i - 1] : null;

        return (
          <div key={batch.id} className="flex shrink-0 items-center">
            {prev ? (
              <div className="mx-1 h-0 w-8 border-t-2 border-dashed border-sand sm:w-10" />
            ) : null}

            <div
              className={`relative w-40 shrink-0 rounded-xl bg-white px-2 py-1 text-center ring-1 transition-shadow ${
                active
                  ? "ring-2 ring-carbon-400 shadow-sm"
                  : "ring-line/80 hover:ring-line"
              }`}
            >
              <button
                type="button"
                onClick={() => selectSubmission(batch.id)}
                aria-pressed={active}
                className="w-full"
              >
                <div className="truncate pr-4 text-[10px] font-semibold text-frost">
                  {batch.periodLabel}
                </div>
                <div className="whitespace-nowrap text-[9px] font-medium text-mist">
                  {status.label} · {batch.monitoringCoverage} · {batch.completion}%
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-off-white">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${batch.completion}%`,
                      background: statusFill(batch.status),
                    }}
                  />
                </div>
              </button>
              <button
                type="button"
                aria-label={`Remove ${batch.periodLabel}`}
                disabled={removingId === batch.id}
                onClick={() => void removeBox(batch)}
                className="absolute top-1 right-1 grid size-4 place-items-center rounded-full text-mist hover:bg-off-white hover:text-frost"
              >
                <X className="size-3" />
              </button>
            </div>
          </div>
        );
      })}

      {showWindow ? (
        <button
          type="button"
          disabled={!hasNewer}
          onClick={() =>
            setWindowStart(Math.min(batches.length - WINDOW_SIZE, start + 1))
          }
          aria-label="Show newer periods"
          className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${
            hasNewer
              ? "bg-white text-frost ring-1 ring-line hover:ring-carbon-400/40"
              : "text-transparent"
          }`}
        >
          <ChevronRight className="size-4" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => setFormOpen((open) => !open)}
        aria-label="Start reporting period"
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-frost ring-1 ring-line hover:ring-carbon-400/40"
      >
        <Plus className="size-4" />
      </button>

      {formOpen ? (
        <div className="absolute top-14 z-20 flex items-center gap-1 rounded-xl bg-white px-2 py-1.5 ring-1 ring-line/80">
          <input
            type="date"
            value={startDate}
            min={notBefore ?? undefined}
            onChange={(event) => setStartDate(event.target.value)}
            className="rounded-md bg-off-white px-1.5 py-1 text-[11px] text-frost"
          />
          <input
            type="date"
            value={endDate}
            min={startDate || notBefore || undefined}
            onChange={(event) => setEndDate(event.target.value)}
            className="rounded-md bg-off-white px-1.5 py-1 text-[11px] text-frost"
          />
          <button
            type="button"
            onClick={startPeriod}
            className="rounded-md bg-carbon-400 px-2 py-1 text-[11px] font-semibold text-off-white"
          >
            Start
          </button>
          {formError ? (
            <span className="max-w-40 text-[10px] text-signal-rose">{formError}</span>
          ) : null}
        </div>
      ) : formError ? (
        <span className="absolute top-14 z-20 max-w-72 rounded-xl bg-white px-2 py-1 text-[10px] text-signal-rose ring-1 ring-line/80">
          {formError}
        </span>
      ) : null}
    </nav>
  );
}
