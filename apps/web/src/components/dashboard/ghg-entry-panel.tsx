"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
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
import type { Project, SubmissionBatch } from "@/lib/types";
import { CalculationTree } from "./calculation-tree";

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
  const putPipeline = usePipeline((state) => state.put);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const addFiles = useRequirementDrafts((state) => state.addFiles);
  const removeFile = useRequirementDrafts((state) => state.removeFile);
  const setStage = useRequirementDrafts((state) => state.setStage);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"quality" | "create" | null>(null);

  const qualitySlot = `ghg-entry:${batch.id}`;
  const draftKey = `${project.id}:${batch.id}:${qualitySlot}`;
  const files = useRequirementDrafts((state) => state.bySlot[draftKey]?.files) ?? [];
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
    !busy;

  const exSitu = template?.groups.some((group) =>
    group.components.some((row) => isExSituMineralizationBlueprint(row.blueprintKey)),
  );

  async function runQuality() {
    if (!template || files.length === 0 || busy) return;
    const uploaded = getDraftFiles(draftKey);
    const form = new FormData();
    form.set("project_id", project.id);
    form.set("slot_id", qualitySlot);
    form.set("batch_id", batch.id);
    form.set("kind", "dataset");
    form.set("label", "GHG entry datapoints");
    form.set("origin", "operator-upload");
    form.set("notes", "GHG entry sources for this reporting period");
    form.set("period_start", batch.periodStart);
    form.set("period_end", batch.periodEnd);
    for (const file of uploaded) form.append("file", file);

    setError(null);
    setBusy("quality");
    setStage(draftKey, "running");
    putPipeline({
      tenantId,
      projectId: project.id,
      batchId: batch.id,
      slotId: qualitySlot,
      kind: "dataset",
      origin: "operator-upload",
      engines: {
        dqa: { status: "running" },
        anomaly: { status: "running" },
        "registry-rules": { status: "running" },
      },
      updatedAt: new Date().toISOString(),
    });
    try {
      const response = await fetch("/api/sentinel/pipeline", {
        method: "POST",
        headers: { "x-tenant-id": tenantId },
        body: form,
      });
      const body = (await response.json()) as PipelineResult & { error?: string };
      if (!response.ok) throw new Error(body.error || response.statusText);
      putPipeline(body);
      const blocked =
        Boolean(body.error) ||
        body.schemaBlocked ||
        body.engines.dqa?.status === "failed";
      setStage(draftKey, blocked ? "failed" : "complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Quality check failed");
      setStage(draftKey, "failed");
    } finally {
      setBusy(null);
    }
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

      <CalculationTree
        template={template}
        batchId={batch.id}
        netKg={selectedEntry?.netKg}
        selectedComponentId={component?.id ?? null}
        onSelectComponent={selectComponent}
      />

      <section>
        <h3 className="text-[10px] tracking-[0.14em] text-mist uppercase">
          Sources and quality
        </h3>
        <p className="mt-1 mb-2 text-[10px] leading-relaxed text-mist">
          Upload bills, meter exports or lab certificates for this period’s
          monitored values. Data quality must pass before the GHG entry is written
          to Certify. Entries whose end date falls in a statement period are
          assigned to that statement automatically.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center gap-1 rounded-xl bg-ink-800/60 px-4 py-4 text-center ring-1 ring-line/70 hover:bg-ink-700/80"
        >
          <FileUp className="size-4 text-mist" />
          <span className="text-[12px] font-medium text-frost">
            Drop source files for this GHG entry
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.parquet,.json,.txt"
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) {
              addFiles(draftKey, Array.from(event.target.files));
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
                  onClick={() => removeFile(draftKey, file.name)}
                  className="text-mist hover:text-frost"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
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
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={files.length === 0 || busy !== null}
            onClick={() => void runQuality()}
            className="rounded-xl bg-carbon-400 px-3 py-2 text-[12px] font-semibold text-off-white disabled:bg-ink-700 disabled:text-mist"
          >
            {busy === "quality" ? "Running Sentinel…" : "Run quality check"}
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => void createEntry()}
            className="rounded-xl bg-serpentine px-3 py-2 text-[12px] font-semibold text-off-white disabled:bg-ink-700 disabled:text-mist"
          >
            {busy === "create" ? "Creating…" : "Create GHG entry on Certify"}
          </button>
        </div>
      </section>
    </div>
  );
}
