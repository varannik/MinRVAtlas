"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { AccountingTemplate } from "@/lib/accounting";
import { feedTemplateFromCsv } from "@/lib/ghg-csv-feed";
import {
  findingsForStep,
  findingIdentity,
  findingsByScope,
  isFindingResolved,
  type QualityStep,
} from "@/lib/ghg-quality-findings";
import { tableToFile, serializeGhgTable } from "@/lib/ghg-csv-series";
import { scheduleEffect } from "@/lib/schedule-effect";
import type { PipelineResult } from "@/lib/sentinel/pipeline-types";
import { pipelineKey } from "@/lib/sentinel/pipeline-types";
import type { Project, SubmissionBatch } from "@/lib/types";
import {
  getDraftFiles,
  useRequirementDrafts,
} from "@/store/requirement-draft-store";
import { useAccountingDrafts } from "@/store/accounting-draft-store";
import { useGhgQualityReview } from "@/store/ghg-quality-review-store";
import { usePipeline } from "@/store/pipeline-store";
import { QualityChart } from "./quality-chart";
import { QualityFactors } from "./quality-factors";
import { QualityLoading } from "./quality-loading";
import { QualityStepper } from "./quality-stepper";

const EASE = [0.22, 1, 0.36, 1] as const;

export function GhgQualityOverlay({
  project,
  batch,
  template,
  draftKey,
  qualitySlot,
  tenantId,
  onFed,
}: {
  project: Project;
  batch: SubmissionBatch;
  template: AccountingTemplate;
  draftKey: string;
  qualitySlot: string;
  tenantId: string;
  onFed: (notice: string) => void;
}) {
  const overlayOpen = useGhgQualityReview((state) => state.overlayOpen);
  const step = useGhgQualityReview((state) => state.step);
  const anomalyView = useGhgQualityReview((state) => state.anomalyView);
  const overlayY = useGhgQualityReview((state) => state.overlayY);
  const running = useGhgQualityReview((state) => state.running);
  const table = useGhgQualityReview((state) => state.table);
  const resolutions = useGhgQualityReview((state) => state.resolutions);
  const modifications = useGhgQualityReview((state) => state.modifications);
  const selectedFindingId = useGhgQualityReview((state) => state.selectedFindingId);
  const focusedEntityKey = useGhgQualityReview((state) => state.focusedEntityKey);
  const close = useGhgQualityReview((state) => state.close);
  const setStep = useGhgQualityReview((state) => state.setStep);
  const setAnomalyView = useGhgQualityReview((state) => state.setAnomalyView);
  const setOverlayY = useGhgQualityReview((state) => state.setOverlayY);
  const setRunning = useGhgQualityReview((state) => state.setRunning);
  const selectFinding = useGhgQualityReview((state) => state.selectFinding);
  const focusEntity = useGhgQualityReview((state) => state.focusEntity);
  const resolve = useGhgQualityReview((state) => state.resolve);
  const approveGroups = useGhgQualityReview((state) => state.approveGroups);
  const editCell = useGhgQualityReview((state) => state.editCell);
  const editColumn = useGhgQualityReview((state) => state.editColumn);
  const rememberIdentities = useGhgQualityReview((state) => state.rememberIdentities);
  const dropLaterResolutions = useGhgQualityReview((state) => state.dropLaterResolutions);
  const reconcileFindings = useGhgQualityReview((state) => state.reconcileFindings);
  const putPipeline = usePipeline((state) => state.put);
  const pipeline = usePipeline(
    (state) => state.byKey[pipelineKey(project.id, batch.id, qualitySlot)],
  );
  const replaceFile = useRequirementDrafts((state) => state.replaceFile);
  const setStage = useRequirementDrafts((state) => state.setStage);
  const setNotes = useRequirementDrafts((state) => state.setNotes);
  const setInputs = useAccountingDrafts((state) => state.setInputs);
  const [error, setError] = useState<string | null>(null);
  const [maxReached, setMaxReached] = useState<QualityStep>(1);
  const boot = useRef(false);

  const findings = useMemo(
    () => (table ? findingsForStep(step, table, pipeline) : []),
    [pipeline, step, table],
  );
  const editedCells = useMemo(() => {
    const cells = new Set<string>();
    for (const row of modifications) {
      cells.add(`${row.entityKey}:${row.rowIndex}`);
    }
    return cells;
  }, [modifications]);
  const sampleFindings = useMemo(
    () => findingsByScope(findings, "sample"),
    [findings],
  );
  const factorFindings = useMemo(
    () => findingsByScope(findings, "factor"),
    [findings],
  );
  const unmappedFindings = useMemo(
    () => findingsByScope(findings, "unmapped"),
    [findings],
  );
  const selected = findings.find((row) => row.id === selectedFindingId) ?? null;
  const pending = findings.filter(
    (row) => !isFindingResolved(row, resolutions, editedCells),
  );
  const canContinue = !running && Boolean(table);

  const runPipeline = useCallback(
    async (csvFile?: File) => {
      const uploaded = getDraftFiles(draftKey);
      const files = csvFile
        ? uploaded.map((file) =>
            file.name.toLowerCase().endsWith(".csv") ? csvFile : file,
          )
        : uploaded;
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
      for (const file of files) form.append("file", file);

      setError(null);
      setRunning(true);
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
        const nextTable = useGhgQualityReview.getState().table;
        if (nextTable) {
          const groups = {
            dqa: findingsForStep(1, nextTable, body),
            anomaly: findingsForStep(2, nextTable, body),
            registry: findingsForStep(3, nextTable, body),
          };
          const nextIds = {
            dqa: findingIdentity(groups.dqa),
            anomaly: findingIdentity(groups.anomaly),
            registry: findingIdentity(groups.registry),
          };
          const prev = useGhgQualityReview.getState().identities;
          if (prev.dqa && nextIds.dqa !== prev.dqa) dropLaterResolutions(1);
          else if (prev.anomaly && nextIds.anomaly !== prev.anomaly) {
            dropLaterResolutions(2);
          }
          rememberIdentities(nextIds);
          reconcileFindings([...groups.dqa, ...groups.anomaly, ...groups.registry]);
        }
        if (body.schemaBlocked) {
          setStep(1);
          setMaxReached(1);
        }
        const blocked =
          Boolean(body.error) ||
          body.schemaBlocked ||
          body.engines.dqa?.status === "failed";
        setStage(draftKey, blocked ? "failed" : "complete");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Quality check failed");
        setStage(draftKey, "failed");
      } finally {
        setRunning(false);
      }
    },
    [
      batch.id,
      batch.periodEnd,
      batch.periodStart,
      draftKey,
      dropLaterResolutions,
      project.id,
      putPipeline,
      qualitySlot,
      rememberIdentities,
      reconcileFindings,
      setRunning,
      setStage,
      setStep,
      tenantId,
    ],
  );

  const requestClose = useCallback(() => {
    if (focusedEntityKey) {
      focusEntity(null);
      return;
    }
    if (selected?.scope === "factor" || selected?.scope === "unmapped") {
      selectFinding(null);
      return;
    }
    const dirty = Boolean(
      Object.keys(resolutions).length || modifications.length || running,
    );
    if (dirty && !window.confirm("Close without finishing? The calculation tree will not be updated.")) {
      return;
    }
    close();
  }, [
    close,
    focusEntity,
    focusedEntityKey,
    modifications.length,
    resolutions,
    running,
    selectFinding,
    selected,
  ]);

  useEffect(() => {
    if (!overlayOpen) {
      boot.current = false;
      return;
    }
    if (boot.current) return;
    boot.current = true;
    return scheduleEffect(() => runPipeline());
  }, [overlayOpen, runPipeline]);

  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen, requestClose]);

  function continueOrFinish() {
    if (!canContinue || !table) return;
    const leftover = pending.map((row) => row.groupId);
    if (leftover.length > 0) approveGroups(leftover);
    focusEntity(null);
    if (step < 3) {
      const next = (step + 1) as QualityStep;
      setMaxReached((current) => (next > current ? next : current));
      setStep(next);
      return;
    }
    if (!table) return;
    const csvText = serializeGhgTable(table);
    const working = tableToFile(table);
    replaceFile(draftKey, table.fileName, working);
    if (modifications.length > 0) {
      const existing = useRequirementDrafts.getState().get(draftKey).notes;
      const log = modifications
        .map(
          (row) =>
            `${row.entityLabel}: ${row.previous ?? "—"} → ${row.value}. ${row.reason}`,
        )
        .join("\n");
      const block = `GHG sample edits:\n${log}`;
      setNotes(draftKey, existing.trim() ? `${existing.trim()}\n\n${block}` : block);
    }
    const result = feedTemplateFromCsv(
      template,
      csvText,
      table.fileName,
      batch.periodStart,
      batch.periodEnd,
    );
    const rows = result.matches.map((match) => ({
      batchId: batch.id,
      componentId: match.componentId,
      inputKey: match.inputKey,
      magnitude: match.magnitude,
      unit: match.unit,
    }));
    if (rows.length > 0) setInputs(rows);
    onFed(
      result.fed > 0
        ? `Filled ${result.fed} monitored input${result.fed === 1 ? "" : "s"} from reviewed CSV.`
        : result.skipped[0] ?? "Quality review finished.",
    );
    close();
  }

  async function submitEdit(
    colIndex: number,
    rowIndex: number,
    value: number,
    reason: string,
  ) {
    const current = useGhgQualityReview.getState().table;
    if (!current) return;
    if (rowIndex < 0) {
      editColumn(colIndex, value, reason);
    } else {
      editCell(colIndex, rowIndex, value, reason);
    }
    const selectedGroup = selected?.groupId;
    if (selectedGroup) resolve(selectedGroup, "edited");
    selectFinding(`edit:${colIndex}:${rowIndex}`);
    const next = useGhgQualityReview.getState().table;
    if (!next) return;
    dropLaterResolutions(1);
    setMaxReached(1);
    if (step !== 1) setStep(1);
    await runPipeline(tableToFile(next));
  }

  if (!overlayOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-[#1c1914]/45 backdrop-blur-sm">
      <div className="m-3 flex h-[calc(100vh-1.5rem)] min-h-0 w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_rgba(2,6,14,0.18)] ring-1 ring-line/70">
        <header className="flex items-center justify-between gap-3 border-b border-line/60 px-5 py-3">
          <QualityStepper
            step={step}
            maxReached={maxReached}
            onSelect={(next) => {
              if (next <= maxReached) setStep(next);
            }}
          />
          <button
            type="button"
            aria-label="Close quality review"
            onClick={requestClose}
            className="text-mist hover:text-frost"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {running || !table ? (
            <QualityLoading />
          ) : (
            <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line/50 px-4 py-2">
              <button
                type="button"
                onClick={() => setOverlayY(!overlayY)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  overlayY
                    ? "bg-carbon-400 text-off-white"
                    : "bg-off-white text-frost ring-1 ring-line/70"
                }`}
              >
                Scale all Y / overlay trends
              </button>
              {step === 2
                ? (["heuristic", "statistical", "ml"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setAnomalyView(view)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold capitalize ${
                        anomalyView === view
                          ? "bg-carbon-400 text-off-white"
                          : "bg-off-white text-frost ring-1 ring-line/70"
                      }`}
                    >
                      {view === "ml" ? "ML" : view}
                    </button>
                  ))
                : null}
              {pipeline?.engines.dqa?.detail ? (
                <span className="text-[10px] text-mist">
                  {pipeline.engines.dqa.detail}
                  {step === 1
                    ? ` · ${sampleFindings.length} sample marks · ${factorFindings.length} period factors${
                        unmappedFindings.length
                          ? ` · ${unmappedFindings.length} other`
                          : ""
                      }`
                    : ""}
                </span>
              ) : null}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -40, opacity: 0 }}
                transition={{ duration: 0.28, ease: EASE }}
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              >
                  <QualityChart
                    table={table}
                    step={step}
                    findings={sampleFindings}
                    resolutions={resolutions}
                    modifications={modifications}
                    selectedId={selectedFindingId}
                    focusedEntityKey={focusedEntityKey}
                    overlayY={overlayY}
                    anomalyView={anomalyView}
                    running={running}
                    onSelectDot={(id, entityKey) => {
                      selectFinding(id);
                      focusEntity(entityKey);
                    }}
                    onFocusEntity={(key) => {
                      focusEntity(key);
                      if (key) {
                        const first = sampleFindings.find((row) =>
                          row.entityKeys.includes(key),
                        );
                        if (first) selectFinding(first.id);
                      }
                    }}
                    onSubmitEdit={(col, row, value, reason) =>
                      void submitEdit(col, row, value, reason)
                    }
                    onApprove={() => {
                      if (selected) {
                        resolve(selected.groupId, "approved");
                        return;
                      }
                      const editId = selectedFindingId?.startsWith("edit:")
                        ? selectedFindingId.slice(5)
                        : null;
                      if (!editId || !table) return;
                      const [col, row] = editId.split(":");
                      const colIndex = Number(col);
                      const rowIndex = Number(row);
                      const hit = findings.find((finding) => {
                        if (finding.rowIndex !== rowIndex) return false;
                        return table.entities.some(
                          (entity) =>
                            finding.entityKeys.includes(entity.key) &&
                            entity.colIndex === colIndex,
                        );
                      });
                      if (hit) resolve(hit.groupId, "approved");
                    }}
                  />
                  {step === 1 && !focusedEntityKey ? (
                    <QualityFactors
                      table={table}
                      findings={factorFindings}
                      unmapped={unmappedFindings}
                      resolutions={resolutions}
                      modifications={modifications}
                      selectedId={selectedFindingId}
                      running={running}
                      onSelect={(id) => {
                        focusEntity(null);
                        selectFinding(id);
                      }}
                      onClose={() => selectFinding(null)}
                      onApprove={() => {
                        if (selected) resolve(selected.groupId, "approved");
                      }}
                      onSubmitEdit={(col, row, value, reason) =>
                        void submitEdit(col, row, value, reason)
                      }
                    />
                  ) : null}
              </motion.div>
            </AnimatePresence>
            </>
          )}
            {error ? (
              <p className="px-4 py-2 text-[11px] text-signal-rose">{error}</p>
            ) : null}
        </div>

        {running ? null : (
        <footer className="flex items-center justify-between border-t border-line/60 px-5 py-3">
          <p className="text-[11px] text-mist">
            {pipeline?.schemaBlocked
              ? pipeline.schemaMissing?.length
                ? `Missing columns: ${pipeline.schemaMissing.join(", ")}`
                : "Schema does not match this requirement"
              : pending.length === 0
                ? "All findings on this step are resolved"
                : `${pending.length} finding${pending.length === 1 ? "" : "s"} left — continue will approve them`}
          </p>
          <button
            type="button"
            disabled={!canContinue}
            onClick={continueOrFinish}
            className="rounded-xl bg-carbon-400 px-4 py-2 text-[12px] font-semibold text-off-white disabled:bg-ink-700 disabled:text-mist"
          >
            {step === 3 ? "Finish" : "Approve and continue"}
          </button>
        </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
