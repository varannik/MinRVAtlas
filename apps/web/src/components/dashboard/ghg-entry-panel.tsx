"use client";

import { useMemo, useRef, useState } from "react";
import { CloudDownload, FileUp, X } from "lucide-react";
import {
  defaultUnit,
  formatKgCo2e,
  isExSituMineralizationBlueprint,
  isMonitoredInput,
  type AccountingComponent,
  type AccountingSnapshot,
  type AccountingTemplate,
} from "@/lib/accounting";
import { pipelineKey } from "@/lib/sentinel/pipeline-types";
import type { PipelineResult } from "@/lib/sentinel/pipeline-types";
import { getDraftFiles, useRequirementDrafts } from "@/store/requirement-draft-store";
import {
  emptyInputDraft,
  inputDraftKey,
  useAccountingDrafts,
} from "@/store/accounting-draft-store";
import { useDashboard } from "@/store/dashboard-store";
import { usePipeline } from "@/store/pipeline-store";
import { useGhgQualityReview } from "@/store/ghg-quality-review-store";
import type { Project, SubmissionBatch } from "@/lib/types";
import { CalculationTree } from "./calculation-tree";
import { GhgQualityOverlay } from "./ghg-quality/quality-overlay";
import type { StreamCoverage } from "@/lib/stream-coverage";

function findComponent(
  template: AccountingTemplate,
  id: string | null,
): AccountingComponent | null {
  if (!id) return null;
  for (const group of template.groups) {
    const hit = group.components.find((row) => row.id === id);
    if (hit) return hit;
  }
  return template.groups[0]?.components[0] ?? null;
}

export function GhgEntryPanel({
  project,
  batch,
  snapshot,
  onReload,
}: {
  project: Project;
  batch: SubmissionBatch;
  snapshot: AccountingSnapshot;
  onReload: () => Promise<void>;
}) {
  const tenantId = useDashboard((state) => state.tenantId);
  const template = snapshot.templates[0] ?? null;
  const selectedEntryId = useAccountingDrafts((state) => state.selectedEntryId);
  const selectedComponentId = useAccountingDrafts((state) => state.selectedComponentId);
  const selectEntry = useAccountingDrafts((state) => state.selectEntry);
  const selectComponent = useAccountingDrafts((state) => state.selectComponent);
  const byKey = useAccountingDrafts((state) => state.byKey);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const addFiles = useRequirementDrafts((state) => state.addFiles);
  const setFiles = useRequirementDrafts((state) => state.setFiles);
  const removeFile = useRequirementDrafts((state) => state.removeFile);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedNotice, setFeedNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "fetch" | null>(null);
  const [insert, setInsert] = useState<{
    key: string;
    kind: "upload" | "stream" | null;
    coverage: StreamCoverage | null;
  }>({ key: "", kind: null, coverage: null });
  const overlayOpen = useGhgQualityReview((state) => state.overlayOpen);
  const qualityRunning = useGhgQualityReview((state) => state.running);
  const openReview = useGhgQualityReview((state) => state.open);

  const qualitySlot = `ghg-entry:${batch.id}`;
  const draftKey = `${project.id}:${batch.id}:${qualitySlot}`;
  const files = useRequirementDrafts((state) => state.bySlot[draftKey]?.files) ?? [];
  const sourceKind = insert.key === draftKey ? insert.kind : null;
  const coverage = insert.key === draftKey ? insert.coverage : null;
  const pipeline: PipelineResult | undefined =
    pipelineByKey[pipelineKey(project.id, batch.id, qualitySlot)];
  const selectedEntry =
    snapshot.entries.find((row) => row.id === selectedEntryId) ??
    snapshot.entries[0] ??
    null;
  const component = template ? findComponent(template, selectedComponentId) : null;

  const readyKeys = useMemo(() => {
    const ready = new Set<string>();
    if (!template) return ready;
    for (const group of template.groups) {
      for (const row of group.components) {
        for (const input of row.inputs) {
          if (input.bound) {
            ready.add(`${row.id}:${input.key}`);
            continue;
          }
          const draft = byKey[inputDraftKey(batch.id, row.id, input.key)];
          if (draft?.magnitude && Number.isFinite(Number(draft.magnitude))) {
            ready.add(`${row.id}:${input.key}`);
          }
        }
      }
    }
    return ready;
  }, [batch.id, byKey, template]);

  const monitoredMissing = useMemo(() => {
    if (!template) return [];
    return template.groups.flatMap((group) =>
      group.components.flatMap((row) =>
        row.inputs
          .filter(
            (input) =>
              isMonitoredInput(input) && !readyKeys.has(`${row.id}:${input.key}`),
          )
          .map((input) => `${row.name} · ${input.name}`),
      ),
    );
  }, [readyKeys, template]);

  const qualityOk =
    pipeline?.engines.dqa?.status === "passed" ||
    pipeline?.engines.dqa?.status === "skipped";
  const canCreate =
    Boolean(template) &&
    files.length > 0 &&
    qualityOk &&
    monitoredMissing.length === 0 &&
    !busy &&
    !qualityRunning &&
    !(sourceKind === "stream" && coverage != null && !coverage.complete);

  const exSitu = template?.groups.some((group) =>
    group.components.some((row) => isExSituMineralizationBlueprint(row.blueprintKey)),
  );

  async function fetchFromStream() {
    if (busy || qualityRunning || !batch.periodStart || !batch.periodEnd) return;
    setBusy("fetch");
    setError(null);
    try {
      const response = await fetch("/api/registry/ghg-source", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": tenantId,
        },
        body: JSON.stringify({
          projectId: project.id,
          periodStart: batch.periodStart,
          periodEnd: batch.periodEnd,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        csv?: string;
        filename?: string;
        coverage?: StreamCoverage;
      };
      if (!response.ok || !payload.csv) {
        setError(payload.error ?? "Stream fetch failed");
        if (payload.coverage) {
          setInsert({ key: draftKey, kind: "stream", coverage: payload.coverage });
        }
        return;
      }
      const file = new File([payload.csv], payload.filename ?? "stream.csv", {
        type: "text/csv",
      });
      setFiles(draftKey, [file]);
      setInsert({ key: draftKey, kind: "stream", coverage: payload.coverage ?? null });
      setFeedNotice(null);
    } catch {
      setError("Stream fetch failed");
    } finally {
      setBusy(null);
    }
  }

  async function startQuality() {
    if (!template || files.length === 0 || qualityRunning) return;
    const uploaded = getDraftFiles(draftKey);
    const csv = uploaded.find((file) => file.name.toLowerCase().endsWith(".csv"));
    if (!csv) {
      setError("Upload a CSV to run quality check");
      return;
    }
    setError(null);
    const text = await csv.text();
    openReview(text, csv.name);
  }

  async function createEntry() {
    if (!canCreate || !template || !pipeline) return;
    const uploaded = getDraftFiles(draftKey);
    const components = template.groups.flatMap((group) =>
      group.components
        .map((row) => ({
          componentId: row.id,
          inputs: row.inputs
            .filter((input) => isMonitoredInput(input) && !input.bound)
            .flatMap((input) => {
              const draft =
                byKey[inputDraftKey(batch.id, row.id, input.key)] ??
                emptyInputDraft(defaultUnit(input.quantityKind));
              const magnitude = Number(draft.magnitude);
              if (!Number.isFinite(magnitude)) return [];
              const stddev = draft.stddev.trim() ? Number(draft.stddev) : undefined;
              return [
                {
                  inputKey: input.key,
                  displayName: input.name,
                  magnitude,
                  unit: draft.unit || defaultUnit(input.quantityKind),
                  stddev:
                    stddev != null && Number.isFinite(stddev) ? stddev : undefined,
                },
              ];
            }),
        }))
        .filter((row) => row.inputs.length > 0),
    );

    const form = new FormData();
    form.set("action", "create-entry");
    form.set("project_id", project.id);
    form.set("batch_id", batch.id);
    form.set("template_id", template.id);
    form.set("started_on", batch.periodStart);
    form.set("completed_on", batch.periodEnd);
    form.set("pipeline", JSON.stringify(pipeline));
    form.set("components", JSON.stringify(components));
    form.set("notes", `GHG entry ${batch.periodLabel}`);
    for (const file of uploaded) form.append("file", file);

    setBusy("create");
    setError(null);
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
        entryId?: string;
      };
      if (!response.ok || !body.ok) {
        throw new Error(body.blocked || body.error || response.statusText);
      }
      if (body.entryId) selectEntry(body.entryId);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create GHG entry");
    } finally {
      setBusy(null);
    }
  }

  if (!template) {
    return (
      <div className="px-1 py-8 text-[13px] leading-relaxed text-mist">
        No GHG entry template is on file for this project. Build the LCA in
        Certify and convert Project operations into a template, then return here.
        {snapshot.warning ? ` ${snapshot.warning}` : ""}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-frost">{template.name}</p>
          <p className="text-[10px] text-mist">
            {snapshot.entries.length} GHG{" "}
            {snapshot.entries.length === 1 ? "entry" : "entries"} in this window · net{" "}
            {formatKgCo2e(selectedEntry?.netKg)}
          </p>
        </div>
        <select
          value={selectedEntry?.id ?? ""}
          onChange={(event) => selectEntry(event.target.value || null)}
          className="rounded-lg bg-off-white px-2 py-1 text-[11px] text-frost ring-1 ring-line/70"
        >
          <option value="">Draft for this period</option>
          {snapshot.entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
              {entry.statementId ? " · on statement" : " · unassigned"}
            </option>
          ))}
        </select>
      </div>

      {exSitu ? (
        <p className="rounded-lg bg-[#f8d7d3]/70 px-2.5 py-1.5 text-[11px] text-signal-rose">
          This template includes the ex-situ dac_mineralized_co2 blueprint. In-situ
          wells should credit injected, isolated mass instead.
        </p>
      ) : null}

      <section>
        <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
          Sources and quality
        </h3>
        <p className="mt-1 mb-2 text-[10px] leading-relaxed text-mist">
          Upload a CSV, or fetch existing data from the stream store for this
          period. Quality check is the same either way.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-1 rounded-xl bg-ink-800/60 px-3 py-4 text-center ring-1 ring-line/70 hover:bg-ink-700/80"
          >
            <FileUp className="size-4 text-mist" />
            <span className="text-[12px] font-medium text-frost">
              Upload CSV for this GHG entry
            </span>
          </button>
          <button
            type="button"
            disabled={busy !== null || qualityRunning || !batch.periodStart}
            onClick={() => void fetchFromStream()}
            className="flex flex-col items-center gap-1 rounded-xl bg-ink-800/60 px-3 py-4 text-center ring-1 ring-line/70 hover:bg-ink-700/80 disabled:opacity-50"
          >
            <CloudDownload className="size-4 text-mist" />
            <span className="text-[12px] font-medium text-frost">
              {busy === "fetch" ? "Fetching…" : "Fetch from stream source"}
            </span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.parquet,.json,.txt"
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) {
              const incoming = Array.from(event.target.files);
              if (sourceKind === "stream") {
                setFiles(draftKey, incoming);
              } else {
                addFiles(draftKey, incoming);
              }
              setInsert({ key: draftKey, kind: "upload", coverage: null });
              setFeedNotice(null);
              setError(null);
            }
            event.target.value = "";
          }}
        />
        {files.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {files.map((file) => (
              <li
                key={`${file.name}-${file.size}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-off-white px-2.5 py-1.5 text-[10px]"
              >
                <span className="truncate font-mono text-frost">{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => {
                    removeFile(draftKey, file.name);
                    if (files.length <= 1) {
                      setInsert({ key: draftKey, kind: null, coverage: null });
                    }
                  }}
                  className="text-mist hover:text-frost"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {sourceKind === "stream" && coverage ? (
          <div className="mt-2 rounded-lg bg-off-white px-2.5 py-2 text-[10px] text-frost">
            <p className="font-medium uppercase tracking-[0.12em] text-mist">Missing data</p>
            {coverage.complete ? (
              <p className="mt-1">Stream window is complete for required series and attributes.</p>
            ) : (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {coverage.daysMissing.map((day) => (
                  <li key={`d-${day}`}>Missing day: {day}</li>
                ))}
                {coverage.seriesMissing.map((metric) => (
                  <li key={`s-${metric}`}>Missing series: {metric}</li>
                ))}
                {coverage.attributesMissing.map((key) => (
                  <li key={`a-${key}`}>Missing attribute: {key}</li>
                ))}
                {coverage.gaps.slice(0, 6).map((gap) => (
                  <li key={`g-${gap.metric}`}>
                    Cadence gaps: {gap.metric} ({gap.missingSlots} slots)
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <button
          type="button"
          disabled={files.length === 0 || qualityRunning || busy !== null}
          onClick={() => void startQuality()}
          className="mt-3 w-full rounded-2xl bg-carbon-400 px-4 py-4 text-[15px] font-semibold text-off-white disabled:bg-ink-700 disabled:text-mist"
        >
          {qualityRunning ? "Running quality checks…" : "Run quality check"}
        </button>
        {feedNotice ? (
          <p className="mt-2 text-[11px] text-frost">{feedNotice}</p>
        ) : null}
        {pipeline?.engines.dqa?.detail ? (
          <p className="mt-2 text-[11px] text-frost">{pipeline.engines.dqa.detail}</p>
        ) : null}
        {monitoredMissing.length > 0 ? (
          <p className="mt-2 text-[11px] text-signal-amber">
            Missing inputs: {monitoredMissing.slice(0, 4).join(" · ")}
            {monitoredMissing.length > 4 ? ` · +${monitoredMissing.length - 4}` : ""}
          </p>
        ) : null}
        {error ? <p className="mt-2 text-[11px] text-signal-rose">{error}</p> : null}
      </section>

      <CalculationTree
        template={template}
        batchId={batch.id}
        netKg={selectedEntry?.netKg}
        selectedComponentId={component?.id ?? null}
        onSelectComponent={selectComponent}
      />

      <button
        type="button"
        disabled={!canCreate}
        onClick={() => void createEntry()}
        className="rounded-xl bg-serpentine px-3 py-2 text-[12px] font-semibold text-off-white disabled:bg-ink-700 disabled:text-mist"
      >
        {busy === "create" ? "Creating…" : "Create GHG entry on Certify"}
      </button>

      {overlayOpen ? (
        <GhgQualityOverlay
          project={project}
          batch={batch}
          template={template}
          draftKey={draftKey}
          qualitySlot={qualitySlot}
          tenantId={tenantId}
          onFed={setFeedNotice}
        />
      ) : null}
    </div>
  );
}
