"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock3,
  Database,
  FileText,
  KeyRound,
  Link2,
  Plug,
  RadioTower,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { STATUS_META } from "@/lib/projects";
import { formatCompact, formatIsoDate } from "@/lib/format";
import { ITEM_STATE_META } from "@/lib/item-state";
import { getAdapter } from "@/lib/registries";
import { SUBMISSION_STATUS_META } from "@/lib/submissions";
import { SiteLocationFields } from "./site-location-fields";
import { pipelineOutcomeLabel } from "@/lib/requirement-draft";
import { useDashboard } from "@/store/dashboard-store";
import { usePipeline } from "@/store/pipeline-store";
import { useRegistrySubmit } from "@/store/registry-submit-store";
import { pipelineKey } from "@/lib/sentinel/pipeline-types";
import { useRequirementDrafts } from "@/store/requirement-draft-store";
import { isGhgStatementSlot } from "@/lib/registries/submit-gate";
import type {
  ItemKind,
  ItemState,
  Project,
  SubmissionBatch,
} from "@/lib/types";

const KIND_ICON: Record<ItemKind, LucideIcon> = {
  document: FileText,
  dataset: Database,
  "sensor-stream": RadioTower,
  attestation: ShieldCheck,
};

const STATE_ICON: Record<ItemState, LucideIcon> = {
  complete: CheckCircle2,
  pending: Clock3,
  rejected: XCircle,
  missing: CircleDashed,
};

export function SubmissionPanel({
  project,
  batches,
  batch,
}: {
  project: Project;
  batches: SubmissionBatch[];
  batch: SubmissionBatch;
}) {
  const hoveredSlotId = useDashboard((state) => state.hoveredSlotId);
  const selectedSlotId = useDashboard((state) => state.selectedSlotId);
  const hoverSlot = useDashboard((state) => state.hoverSlot);
  const selectRequirement = useDashboard((state) => state.selectRequirement);
  const selectSubmission = useDashboard((state) => state.selectSubmission);
  const drafts = useRequirementDrafts((state) => state.bySlot);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const submitByKey = useRegistrySubmit((state) => state.byKey);
  const putSubmit = useRegistrySubmit((state) => state.put);
  const tenantId = useDashboard((state) => state.tenantId);
  const [reportUrl, setReportUrl] = useState("");
  const [ghgError, setGhgError] = useState<string | null>(null);
  const [ghgBusy, setGhgBusy] = useState(false);

  const specMeta = useDashboard((state) => state.specMeta);

  const projectStatus = STATUS_META[project.status];
  const batchStatus = SUBMISSION_STATUS_META[batch.status];
  const adapter = getAdapter(project.registry);
  const index = batches.findIndex((entry) => entry.id === batch.id);

  const live = specMeta?.origin === "registry-api";
  const monitoringSlots = batch.items.filter(
    (item) => item.mandatory && !isGhgStatementSlot(item.slotId, item.label, item.id),
  );
  const submittedSlotIds = monitoringSlots
    .filter(
      (item) =>
        submitByKey[pipelineKey(batch.projectId, batch.id, item.slotId)]?.ok,
    )
    .map((item) => item.slotId);
  const monitoringLeft = monitoringSlots.length - submittedSlotIds.length;

  async function submitGhg() {
    if (batch.status !== "assembling" || ghgBusy) return;
    setGhgError(null);
    setGhgBusy(true);
    const form = new FormData();
    form.set("target", "ghg");
    form.set("project_id", project.id);
    form.set("batch_id", batch.id);
    form.set("ghg_statement_report_url", reportUrl);
    form.set("submitted_slot_ids", submittedSlotIds.join(","));
    form.set(
      "mandatory_slot_ids",
      monitoringSlots.map((item) => item.slotId).join(","),
    );
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
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.blocked || body.error || response.statusText);
      }
      putSubmit({
        projectId: project.id,
        batchId: batch.id,
        slotId: "ghg-statement",
        ok: true,
        sourceIds: [],
        datapointIds: [],
        submissionIds: [],
        warnings: [],
        status: "submitted",
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setGhgError(error instanceof Error ? error.message : "GHG submit failed");
    } finally {
      setGhgBusy(false);
    }
  }

  return (
    <aside className="glass pointer-events-auto flex h-full w-[27rem] max-w-[92vw] flex-col overflow-hidden rounded-2xl">
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

      <div className="border-b border-line/70 px-4 py-3">
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

      <div className="scroll-slim flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2.5 flex items-start gap-2 rounded-xl bg-ink-800/45 px-3 py-2">
          <Plug
            className={`mt-0.5 size-3.5 shrink-0 ${live ? "text-carbon-400" : "text-cyan/80"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-frost">
                {batch.specVersion}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-px text-[9px] font-bold tracking-wide ${
                  live
                    ? "bg-carbon-400/15 text-carbon-400"
                    : "bg-ink-700 text-mist"
                }`}
              >
                {live
                  ? `LIVE · ${specMeta?.environment?.toUpperCase() ?? "API"}`
                  : "BUNDLED SPEC"}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] leading-relaxed text-mist">
              {live
                ? `${specMeta?.requirementCount ?? 0} monitoring requirements read from ${adapter.platform} for project `
                : `${adapter.platform} · ${specMeta?.message ?? "requirements from the published rulebook."} `}
              {live ? (
                <span className="font-mono text-cyan/70">
                  {specMeta?.externalProjectId}
                </span>
              ) : null}
            </p>
            {live &&
            (specMeta?.sourceCount ||
              specMeta?.datapointCount ||
              specMeta?.documentCount) ? (
              <p className="mt-0.5 text-[10px] leading-relaxed text-mist">
                On file: {specMeta.sourceCount ?? 0} sources,{" "}
                {specMeta.datapointCount ?? 0} datapoints,{" "}
                {specMeta.documentCount ?? 0} published documents. DQA still
                uses operator CSVs.
              </p>
            ) : null}
            {specMeta?.warnings && specMeta.warnings.length > 0 ? (
              <p className="mt-0.5 text-[10px] leading-relaxed text-signal-amber">
                {specMeta.warnings.join(" · ")}
              </p>
            ) : null}
            {!live && specMeta?.fallbackReason ? (
              <p className="mt-0.5 text-[10px] leading-relaxed text-mist">
                Fallback: {specMeta.fallbackReason.replace(/-/g, " ")}.
              </p>
            ) : null}
            <p className="mt-0.5 text-[9px] leading-relaxed text-mist/70">
              Server-side machine-to-machine read. Tenant users never hold
              registry credentials.
            </p>
          </div>
        </div>

        {batch.groups.map((group) => (
          <section key={group.id} className="mb-3 last:mb-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                style={{
                  background: `${group.accent}1f`,
                  color: group.accent,
                }}
              >
                {group.code}
              </span>
              <h3 className="text-xs font-semibold text-frost">
                {group.title}
              </h3>
            </div>

            <ul className="space-y-1">
              {group.items.map((item) => {
                const KindIcon = KIND_ICON[item.kind];
                const StateIcon = STATE_ICON[item.state];
                const meta = ITEM_STATE_META[item.state];
                const hot = hoveredSlotId === item.slotId;
                const selected = selectedSlotId === item.slotId;
                const staged = pipelineOutcomeLabel(
                  pipelineByKey[
                    pipelineKey(batch.projectId, batch.id, item.slotId)
                  ],
                  drafts[item.slotId]?.stage,
                  submitByKey[pipelineKey(batch.projectId, batch.id, item.slotId)],
                );
                const failTag =
                  staged === "DQA FAIL" ||
                  staged === "STEP-3 FAIL" ||
                  staged === "ANOMALY FAIL" ||
                  staged === "V&V FAIL" ||
                  staged === "SUBMIT FAIL";

                return (
                  <li key={item.slotId}>
                    <button
                      type="button"
                      onClick={() => selectRequirement(item.slotId)}
                      onMouseEnter={() => hoverSlot(item.slotId)}
                      onMouseLeave={() => hoverSlot(null)}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                        selected
                          ? "bg-ink-700"
                          : hot
                            ? "bg-ink-700"
                            : "bg-ink-800/45 hover:bg-ink-800/80"
                      }`}
                      style={
                        selected || hot
                          ? { boxShadow: `inset 0 0 0 1px ${item.accent}59` }
                          : undefined
                      }
                    >
                      <span
                        className="mt-px grid size-6 shrink-0 place-items-center rounded-lg"
                        style={{
                          background: `${item.accent}14`,
                          color: item.accent,
                        }}
                      >
                        <KindIcon className="size-3" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 flex-1 text-[12px] leading-snug font-medium text-frost">
                            {item.label}
                          </span>
                          <span
                            className="flex shrink-0 items-center gap-1 text-[10px] font-medium"
                            style={{ color: meta.color }}
                          >
                            <StateIcon className="size-3" />
                            {meta.label}
                          </span>
                        </div>
                        {item.mandatory && !staged ? null : (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {item.mandatory ? null : (
                              <span className="rounded px-1 py-px text-[9px] font-semibold text-mist ring-1 ring-line/70">
                                OPT
                              </span>
                            )}
                            {staged ? (
                              <span
                                className={`rounded px-1 py-px text-[9px] font-semibold ring-1 ${
                                  failTag
                                    ? "text-signal-rose ring-signal-rose/30"
                                    : drafts[item.slotId]?.stage === "running"
                                      ? "text-signal-amber ring-signal-amber/30"
                                      : "text-carbon-400 ring-carbon-400/30"
                                }`}
                              >
                                {staged}
                              </span>
                            ) : null}
                          </div>
                        )}

                        {hot ? (
                          <p className="mt-1 text-[10px] leading-relaxed text-mist">
                            {item.detail}
                          </p>
                        ) : null}

                        <div className="tabular mt-0.5 flex items-center gap-1.5 text-[10px] text-mist/80">
                          <span className="truncate font-mono text-[9px] text-cyan/60">
                            {item.reference}
                          </span>
                          {item.state !== "missing" ? (
                            <>
                              <span className="text-line">·</span>
                              <span className="shrink-0">
                                {item.updatedDaysAgo}d ago
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="border-t border-line/70 px-4 py-3">
        {batch.status === "assembling" ? (
          <div className="space-y-2">
            <input
              type="url"
              value={reportUrl}
              onChange={(event) => setReportUrl(event.target.value)}
              placeholder="GHG statement report URL (verifier-accessible)"
              className="w-full rounded-xl bg-ink-800/60 px-3 py-2 text-[11px] text-frost placeholder:text-mist/50 ring-1 ring-line/70 focus:outline-none"
            />
            {ghgError ? (
              <p className="text-[11px] text-signal-rose">{ghgError}</p>
            ) : (
              <p className="text-[10px] leading-relaxed text-mist">
                GHG statement is last. Submit each requirement to Certify first.
                {monitoringLeft > 0
                  ? ` ${monitoringLeft} mandatory slot${monitoringLeft === 1 ? "" : "s"} still unsubmitted.`
                  : " Monitoring slots for this session are on file."}
              </p>
            )}
            <button
              type="button"
              disabled={batch.blockers > 0 || ghgBusy || monitoringLeft > 0}
              onClick={() => void submitGhg()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-carbon-400/15 px-4 py-2.5 text-sm font-semibold text-carbon-400 ring-1 ring-carbon-400/30 transition-colors enabled:hover:bg-carbon-400/25 disabled:cursor-not-allowed disabled:bg-ink-800/60 disabled:text-mist disabled:ring-line/70"
            >
              <Send className="size-4" />
              {ghgBusy
                ? "Submitting GHG statement…"
                : batch.blockers > 0
                  ? `${batch.blockers} requirement${batch.blockers === 1 ? "" : "s"} still open`
                  : monitoringLeft > 0
                    ? "Submit requirements to Certify first"
                    : `Submit GHG statement last`}
            </button>
          </div>
        ) : (
          <div className="rounded-xl bg-ink-800/60 px-4 py-2.5 text-center text-[11px] text-mist">
            Batch sealed and sent to {project.registry}
            {batch.anchoredAt
              ? ` · anchored ${formatIsoDate(batch.anchoredAt)}`
              : ""}
          </div>
        )}
      </div>
    </aside>
  );
}
