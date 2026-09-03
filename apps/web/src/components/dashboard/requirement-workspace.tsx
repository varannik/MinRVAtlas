"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  FileUp,
  X,
} from "lucide-react";
import {
  ENGINE_META,
  classifyRequirement,
  orderedEngines,
  payloadLabel,
} from "@/lib/requirement-payload";
import { pipelineOutcomeLabel } from "@/lib/requirement-draft";
import { ITEM_KIND_LABEL, ITEM_STATE_META } from "@/lib/item-state";
import { pipelineKey } from "@/lib/sentinel/pipeline-types";
import type { EngineRunStatus, PipelineResult } from "@/lib/sentinel/pipeline-types";
import { panelAnchor } from "../scene/requirement-anchor";
import {
  emptyDraft,
  getDraftFiles,
  useRequirementDrafts,
  type DraftFileMeta,
} from "@/store/requirement-draft-store";
import { usePipeline } from "@/store/pipeline-store";
import { useRegistrySubmit } from "@/store/registry-submit-store";
import { useDashboard } from "@/store/dashboard-store";
import { slotSubmitBlockReason } from "@/lib/registries/submit-gate";
import type { RequirementItem, SubmissionBatch } from "@/lib/types";
import Link from "next/link";

const EMPTY_FILES: DraftFileMeta[] = [];

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function FileDrop({
  slotId,
  accept,
  label,
}: {
  slotId: string;
  accept: string;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const files = useRequirementDrafts(
    (state) => state.bySlot[slotId]?.files,
  ) ?? EMPTY_FILES;
  const addFiles = useRequirementDrafts((state) => state.addFiles);
  const removeFile = useRequirementDrafts((state) => state.removeFile);

  function take(list: FileList | File[]) {
    addFiles(slotId, Array.from(list));
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (event.dataTransfer.files.length) take(event.dataTransfer.files);
        }}
        className={`flex w-full flex-col items-center gap-2 rounded-xl px-4 py-5 text-center ring-1 transition-colors ${
          over
            ? "bg-cyan/10 ring-cyan/40"
            : "bg-ink-800/60 ring-line/70 hover:bg-ink-700/80"
        }`}
      >
        <FileUp className="size-4 text-mist" />
        <span className="text-[12px] font-medium text-frost">{label}</span>
        <span className="text-[10px] text-mist">
          Drop files here or click to browse
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) take(event.target.files);
          event.target.value = "";
        }}
      />
      {files.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/70 px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate font-mono text-[10px] text-frost">
                {file.name}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[10px] text-mist">
                {formatBytes(file.size)}
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => removeFile(slotId, file.name)}
                  className="rounded p-0.5 text-mist hover:text-frost"
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function engineStatusLabel(status: EngineRunStatus | undefined): string {
  if (status === "passed") return "Pass";
  if (status === "failed") return "Fail";
  if (status === "running") return "Running";
  if (status === "skipped") return "Skipped";
  if (status === "deferred") return "Later";
  return "Waiting";
}

function engineStatusClass(status: EngineRunStatus | undefined): string {
  if (status === "passed") return "text-carbon-400";
  if (status === "failed") return "text-signal-rose";
  if (status === "running") return "text-signal-amber";
  return "text-mist";
}

export function RequirementWorkspace({
  item,
  batch,
}: {
  item: RequirementItem;
  batch: SubmissionBatch;
}) {
  const selectRequirement = useDashboard((state) => state.selectRequirement);
  const tenantId = useDashboard((state) => state.tenantId);
  const projectId = useDashboard((state) => state.selectedProjectId);
  const putPipeline = usePipeline((state) => state.put);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const specMeta = useDashboard((state) => state.specMeta);
  const putSubmit = useRegistrySubmit((state) => state.put);
  const submitByKey = useRegistrySubmit((state) => state.byKey);
  const classification = useMemo(() => classifyRequirement(item), [item]);
  const engines = orderedEngines(classification.engines);
  const stored = useRequirementDrafts((state) => state.bySlot[item.slotId]);
  const draft = stored ?? emptyDraft(item.slotId);
  const setNotes = useRequirementDrafts((state) => state.setNotes);
  const setStage = useRequirementDrafts((state) => state.setStage);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);
  const stateMeta = ITEM_STATE_META[item.state];
  const pipeline: PipelineResult | undefined = projectId
    ? pipelineByKey[pipelineKey(projectId, batch.id, item.slotId)]
    : undefined;
  const submitRecord = projectId
    ? submitByKey[pipelineKey(projectId, batch.id, item.slotId)]
    : undefined;
  const staged = pipelineOutcomeLabel(pipeline, draft.stage, submitRecord);
  const canQueue =
    draft.files.length > 0 ||
    (item.kind === "attestation" && draft.notes.trim().length > 0);
  const busy = draft.stage === "running";
  const submitting = submitRecord?.status === "running";
  const certifyBlock = slotSubmitBlockReason(
    pipeline,
    item.kind,
    item.label,
    draft.files.length,
  );
  const canSubmit = Boolean(projectId) && !busy && !submitting && !certifyBlock;

  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (!el) {
        panelAnchor.visible = false;
      } else {
        const box = el.getBoundingClientRect();
        panelAnchor.screenX = box.left;
        panelAnchor.screenY = box.top + box.height / 2;
        panelAnchor.visible = box.width > 0 && box.height > 0;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      panelAnchor.visible = false;
    };
  }, [item.slotId]);

  function close() {
    selectRequirement(null);
  }

  async function queue() {
    if (!canQueue || !projectId || busy) return;
    const files = getDraftFiles(item.slotId);
    const form = new FormData();
    form.set("project_id", projectId);
    form.set("slot_id", item.slotId);
    form.set("batch_id", batch.id);
    form.set("kind", item.kind);
    form.set("label", item.label);
    form.set("origin", classification.origin);
    form.set("notes", draft.notes);
    if (batch.periodStart) form.set("period_start", batch.periodStart);
    if (batch.periodEnd) form.set("period_end", batch.periodEnd);
    for (const file of files) form.append("file", file);

    setSubmitError(null);
    setStage(item.slotId, "running");
    putPipeline({
      tenantId,
      projectId,
      batchId: batch.id,
      slotId: item.slotId,
      kind: item.kind,
      origin: "operator-upload",
      engines: Object.fromEntries(
        engines.map((engine) => [engine, { status: "running" as const }]),
      ),
      updatedAt: new Date().toISOString(),
    });

    try {
      const response = await fetch("/api/sentinel/pipeline", {
        method: "POST",
        headers: { "x-tenant-id": tenantId },
        body: form,
      });
      const body = (await response.json()) as PipelineResult & { error?: string };
      if (!response.ok) {
        throw new Error(body.error || response.statusText);
      }
      putPipeline(body);
      const blocked =
        Boolean(body.error) ||
        body.engines.dqa?.status === "failed" ||
        body.engines.anomaly?.status === "failed" ||
        body.engines.vv?.status === "failed" ||
        body.engines["registry-rules"]?.status === "failed";
      setStage(item.slotId, blocked ? "failed" : "complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pipeline failed";
      setSubmitError(message);
      setStage(item.slotId, "failed");
    }
  }

  async function submitToCertify() {
    if (!canSubmit || !projectId || !pipeline) return;
    const files = getDraftFiles(item.slotId);
    const form = new FormData();
    form.set("target", "slot");
    form.set("project_id", projectId);
    form.set("slot_id", item.slotId);
    form.set("batch_id", batch.id);
    form.set("kind", item.kind);
    form.set("label", item.label);
    form.set("notes", draft.notes);
    form.set("requirement_id", item.id);
    form.set(
      "spec_origin",
      specMeta?.origin === "registry-api" ? "registry-api" : "bundled",
    );
    form.set("pipeline", JSON.stringify(pipeline));
    if (batch.periodStart) form.set("period_start", batch.periodStart);
    if (batch.periodEnd) form.set("period_end", batch.periodEnd);
    for (const file of files) form.append("file", file);

    setSubmitError(null);
    setSubmitWarnings([]);
    putSubmit({
      projectId,
      batchId: batch.id,
      slotId: item.slotId,
      ok: false,
      sourceIds: [],
      datapointIds: [],
      submissionIds: [],
      warnings: [],
      status: "running",
      updatedAt: new Date().toISOString(),
    });

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
        sourceIds?: string[];
        datapointIds?: string[];
        submissionIds?: string[];
        warnings?: string[];
        updatedAt?: string;
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.blocked || body.error || response.statusText);
      }
      putSubmit({
        projectId,
        batchId: batch.id,
        slotId: item.slotId,
        ok: true,
        sourceIds: body.sourceIds ?? [],
        datapointIds: body.datapointIds ?? [],
        submissionIds: body.submissionIds ?? [],
        warnings: body.warnings ?? [],
        status: "submitted",
        updatedAt: body.updatedAt ?? new Date().toISOString(),
      });
      setSubmitWarnings(body.warnings ?? []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Certify write failed";
      setSubmitError(message);
      putSubmit({
        projectId,
        batchId: batch.id,
        slotId: item.slotId,
        ok: false,
        error: message,
        sourceIds: [],
        datapointIds: [],
        submissionIds: [],
        warnings: [],
        status: "failed",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return (
    <div className="glass pointer-events-auto relative z-30 flex max-h-[min(88vh,44rem)] w-[min(36rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl shadow-[0_24px_80px_rgba(2,6,14,0.55)] lg:-ml-5 lg:w-full">
      <div
        ref={anchorRef}
        className="pointer-events-none absolute top-1/2 left-0 h-8 w-px -translate-y-1/2"
        aria-hidden
      />

      <div className="flex items-start justify-between gap-3 border-b border-line/70 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.14em] text-mist uppercase">
            {item.groupCode} · {item.groupTitle}
          </div>
          <h2 className="mt-0.5 text-base leading-snug font-semibold text-frost">
            {item.label}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-mist">
            <span>{ITEM_KIND_LABEL[item.kind]}</span>
            <span className="text-line">·</span>
            <span>{payloadLabel(classification.payload)}</span>
            <span className="text-line">·</span>
            <span style={{ color: stateMeta.color }}>{stateMeta.label}</span>
            {item.mandatory ? null : (
              <>
                <span className="text-line">·</span>
                <span>Optional</span>
              </>
            )}
            {staged ? (
              <>
                <span className="text-line">·</span>
                <span className="font-semibold text-carbon-400">{staged}</span>
              </>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close requirement workspace"
          className="grid size-8 shrink-0 place-items-center rounded-xl text-mist ring-1 ring-line/70 transition-colors hover:bg-ink-700 hover:text-frost"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="text-[11px] leading-relaxed text-mist">{item.detail}</p>
        <p className="mt-1 font-mono text-[9px] text-cyan/70">{item.reference}</p>
        {item.cadence ? (
          <p className="mt-1 text-[10px] text-mist">Cadence · {item.cadence}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-1">
          {engines.map((engine) => (
            <span
              key={engine}
              className={`rounded-lg bg-ink-800/70 px-2 py-1 text-[9px] font-semibold tracking-wide ${engineStatusClass(pipeline?.engines[engine]?.status)}`}
              title={ENGINE_META[engine].label}
            >
              {ENGINE_META[engine].step} {ENGINE_META[engine].short}
            </span>
          ))}
        </div>

        <section className="mt-4">
          <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
            {classification.intakeLabel}
          </h3>
          <p className="mt-1 mb-2 text-[10px] leading-relaxed text-mist">
            {classification.helper}
          </p>
          <FileDrop
            slotId={item.slotId}
            accept={classification.accept}
            label={classification.intakeLabel}
          />
        </section>

        {item.evidence && item.evidence.length > 0 ? (
          <section className="mt-4">
            <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
              Already on file at the registry
            </h3>
            <p className="mt-1 text-[10px] leading-relaxed text-mist">
              Metadata only. DQA still needs an operator CSV — Certify has no
              time-series download.
            </p>
            <ul className="mt-1.5 space-y-1">
              {item.evidence.map((entry) => {
                const title =
                  entry.filename ?? entry.sourceId ?? entry.id;
                const bits = [
                  entry.kind === "datapoint"
                    ? "Datapoint"
                    : entry.kind === "registry-document"
                      ? "Published"
                      : "Submission",
                  entry.quantity,
                  entry.fetchNote,
                  entry.validTo ? `to ${entry.validTo}` : null,
                ].filter(Boolean);
                return (
                  <li
                    key={entry.id}
                    className="rounded-lg bg-ink-800/50 px-2.5 py-1.5 text-[10px] text-mist"
                  >
                    {entry.href ? (
                      <a
                        href={entry.href}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-carbon-400 hover:underline"
                      >
                        {title}
                      </a>
                    ) : (
                      <span className="font-mono text-frost">{title}</span>
                    )}
                    {bits.length > 0 ? (
                      <span className="mt-0.5 block text-[9px] leading-relaxed">
                        {bits.join(" · ")}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="mt-4">
          <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
            Supporting information
          </h3>
          <textarea
            value={draft.notes}
            onChange={(event) => setNotes(item.slotId, event.target.value)}
            rows={3}
            placeholder="Context for this period: instrument, lab, or why this file belongs here."
            className="mt-1.5 w-full resize-none rounded-xl bg-ink-800/60 px-3 py-2 text-[12px] text-frost placeholder:text-mist/50 ring-1 ring-line/70 focus:outline-none"
          />
        </section>

        <section className="mt-4">
          <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
            Review and validation
          </h3>
          <p className="mt-1 text-[10px] leading-relaxed text-mist">
            {pipeline?.readyToSubmit
              ? certifyBlock
                ? `Ready for quality, but Certify write is blocked — ${certifyBlock}`
                : "Quality and Step-3 passed. Submit to Certify is explicit and never runs from a failed DQA."
              : pipeline?.blockReason
                ? `Not ready to submit — ${pipeline.blockReason}`
                : "Run quality check first. Nothing is posted to Certify until you click Submit."}
          </p>
          {submitError ? (
            <p className="mt-2 text-[11px] text-signal-rose">{submitError}</p>
          ) : null}
          {submitRecord?.ok ? (
            <p className="mt-2 text-[11px] text-carbon-400">
              On Certify: {submitRecord.sourceIds.length} source
              {submitRecord.sourceIds.length === 1 ? "" : "s"}
              {submitRecord.submissionIds.length
                ? ` · ${submitRecord.submissionIds.length} monitoring submission${submitRecord.submissionIds.length === 1 ? "" : "s"}`
                : ""}
              {submitRecord.datapointIds.length
                ? ` · ${submitRecord.datapointIds.length} datapoint${submitRecord.datapointIds.length === 1 ? "" : "s"}`
                : ""}
              .
            </p>
          ) : null}
          {submitWarnings.length > 0 ? (
            <p className="mt-2 text-[11px] text-signal-amber">
              {submitWarnings.join(" · ")}
            </p>
          ) : null}
          {pipeline?.engines.dqa?.detail ? (
            <p className="mt-2 text-[11px] text-frost">
              {pipeline.engines.dqa.detail}
              {pipeline.runId ? (
                <>
                  {" "}
                  <Link
                    href="/quality/runs"
                    className="text-carbon-400 hover:underline"
                  >
                    Open in Quality
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <ul className="mt-2 space-y-1">
            {engines.map((engine) => {
              const run = pipeline?.engines[engine];
              const status = run?.status;
              const ready = status === "passed";
              return (
                <li
                  key={engine}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-ink-800/45 px-2.5 py-1.5 text-[11px]"
                >
                  {ready ? (
                    <CheckCircle2 className="size-3.5 text-carbon-400" />
                  ) : (
                    <CircleDashed
                      className={`size-3.5 ${engineStatusClass(status)}`}
                    />
                  )}
                  <span className="text-frost">{ENGINE_META[engine].label}</span>
                  <span
                    className={`ml-auto text-[9px] tracking-wide ${engineStatusClass(status)}`}
                  >
                    {engineStatusLabel(status)}
                  </span>
                  {run?.detail ? (
                    <span className="basis-full pl-5 text-[9px] text-mist">
                      {run.detail}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {pipeline?.registryChecks && pipeline.registryChecks.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {pipeline.registryChecks.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-2 rounded-lg bg-ink-800/30 px-2.5 py-1.5 text-[10px]"
                >
                  <span
                    className={
                      entry.passed ? "text-carbon-400" : "text-signal-rose"
                    }
                  >
                    {entry.passed ? "Pass" : "Fail"}
                  </span>
                  <span className="text-frost">{entry.label}</span>
                  <span className="ml-auto text-right text-mist">{entry.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line/70 px-4 py-3">
        <button
          type="button"
          onClick={close}
          className="rounded-xl px-3 py-2 text-[12px] font-medium text-mist ring-1 ring-line/70 transition-colors hover:bg-ink-700 hover:text-frost"
        >
          Cancel
        </button>
        <div className="flex items-center gap-2">
          <span className="hidden text-[10px] text-mist sm:inline">
            {batch.periodLabel}
          </span>
          <button
            type="button"
            disabled={!canQueue || busy || submitting}
            onClick={() => void queue()}
            className="rounded-xl bg-carbon-400/15 px-4 py-2 text-[12px] font-semibold text-carbon-400 ring-1 ring-carbon-400/30 transition-colors enabled:hover:bg-carbon-400/25 disabled:cursor-not-allowed disabled:bg-ink-800/60 disabled:text-mist disabled:ring-line/70"
          >
            {busy
              ? "Running Sentinel…"
              : draft.stage === "complete" || draft.stage === "failed"
                ? "Run again"
                : "Run quality check"}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submitToCertify()}
            className="rounded-xl bg-cyan/15 px-4 py-2 text-[12px] font-semibold text-cyan ring-1 ring-cyan/30 transition-colors enabled:hover:bg-cyan/25 disabled:cursor-not-allowed disabled:bg-ink-800/60 disabled:text-mist disabled:ring-line/70"
          >
            {submitting
              ? "Submitting…"
              : submitRecord?.ok
                ? "Submit again"
                : "Submit to Certify"}
          </button>
        </div>
      </div>
    </div>
  );
}
