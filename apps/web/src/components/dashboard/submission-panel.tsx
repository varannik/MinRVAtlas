"use client";

import { ChevronLeft, ChevronRight, KeyRound, Link2 } from "lucide-react";
import { STATUS_META } from "@/lib/projects";
import { formatCompact, formatIsoDate } from "@/lib/format";
import { SUBMISSION_STATUS_META } from "@/lib/submissions";
import { SiteLocationFields } from "./site-location-fields";
import { useDashboard } from "@/store/dashboard-store";
import type { Project, SubmissionBatch } from "@/lib/types";

export function SubmissionPanel({
  project,
  batches,
  batch,
}: {
  project: Project;
  batches: SubmissionBatch[];
  batch: SubmissionBatch;
}) {
  const selectSubmission = useDashboard((state) => state.selectSubmission);

  const projectStatus = STATUS_META[project.status];
  const batchStatus = SUBMISSION_STATUS_META[batch.status];
  const index = batches.findIndex((entry) => entry.id === batch.id);

  return (
    <aside className="pointer-events-auto flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-white">
      <div className="border-b border-line/70 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base leading-tight font-semibold text-frost">
              {project.name}
            </h2>
            <p className="mt-0.5 text-xs text-mist">
              {project.region}, {project.country} · {project.methodology}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide"
            style={{
              background: `${projectStatus.color}1f`,
              color: projectStatus.color,
            }}
          >
            {projectStatus.label}
          </span>
        </div>
      </div>

      <SiteLocationFields key={project.id} project={project} />

      <div className="flex items-center justify-between border-b border-line/70 px-4 py-2.5">
        <div className="text-[10px] tracking-[0.14em] text-mist uppercase">
          Submission chain
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => selectSubmission(batches[index - 1].id)}
            className="grid size-6 place-items-center rounded-lg text-mist transition-colors enabled:hover:bg-ink-700 enabled:hover:text-frost disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="tabular text-[11px] text-mist">
            {index + 1} / {batches.length}
          </span>
          <button
            type="button"
            disabled={index >= batches.length - 1}
            onClick={() => selectSubmission(batches[index + 1].id)}
            className="grid size-6 place-items-center rounded-lg text-mist transition-colors enabled:hover:bg-ink-700 enabled:hover:text-frost disabled:opacity-30"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[13px] font-medium text-frost">
            {batch.id}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              background: `${batchStatus.color}1f`,
              color: batchStatus.color,
            }}
          >
            {batchStatus.label}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <div className="rounded-xl bg-ink-800/60 px-3 py-2">
            <div className="text-[10px] tracking-[0.12em] text-mist uppercase">
              Monitoring period
            </div>
            <div className="mt-0.5 text-sm font-medium text-frost">
              {batch.periodLabel}
            </div>
          </div>
          <div className="rounded-xl bg-ink-800/60 px-3 py-2">
            <div className="text-[10px] tracking-[0.12em] text-mist uppercase">
              Batch volume
            </div>
            <div className="tabular mt-0.5 text-sm font-medium text-frost">
              {formatCompact(batch.volume)} tCO₂e
            </div>
          </div>
        </div>

        <div className="mt-1.5 space-y-1 rounded-xl bg-ink-800/40 px-3 py-2 font-mono text-[10px]">
          <div className="flex items-center gap-1.5 text-mist">
            <Link2 className="size-3 shrink-0" />
            <span className="text-frost">{batch.hash}</span>
          </div>
          <div className="truncate pl-4.5 text-mist">
            parent {batch.parentHash ?? "genesis batch"}
          </div>
          {batch.anchoredAt ? (
            <div className="pl-4.5 text-mist">
              anchored {formatIsoDate(batch.anchoredAt)}
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 pt-0.5 font-sans text-[9px] text-mist/70">
            <KeyRound className="size-2.5 shrink-0" />
            Key seals {batch.periodLabel} against re-crediting
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-600/70">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${batch.completion}%`,
                background: batchStatus.color,
              }}
            />
          </div>
          <span className="tabular text-xs font-medium text-frost">
            {batch.items.length - batch.outstanding}/{batch.items.length} ready
          </span>
        </div>

        <div
          className="mt-2 grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${batch.groups.length}, minmax(0, 1fr))`,
          }}
        >
          {batch.groups.map((group) => {
            const complete = group.items.filter(
              (item) => item.state === "complete",
            ).length;
            return (
              <div
                key={group.id}
                title={`${group.title}: ${complete} of ${group.items.length}`}
                className="rounded-lg bg-ink-800/60 px-1 py-1.5 text-center"
              >
                <div
                  className="text-[10px] font-semibold"
                  style={{ color: group.accent }}
                >
                  {group.code}
                </div>
                <div className="tabular text-[9px] text-mist">
                  {complete}/{group.items.length}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
