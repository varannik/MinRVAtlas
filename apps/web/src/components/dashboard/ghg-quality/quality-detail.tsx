"use client";

import { useMemo, useState } from "react";
import type { GhgSeriesEntity, GhgSeriesTable } from "@/lib/ghg-csv-series";
import type { QualityFinding, ResolutionMode } from "@/lib/ghg-quality-findings";
import type { GhgCellModification } from "@/store/ghg-quality-review-store";

export function QualityDetail({
  finding,
  table,
  entity,
  selectedRowIndex,
  resolution,
  modifications,
  running,
  onApprove,
  onSubmitEdit,
}: {
  finding: QualityFinding | null;
  table: GhgSeriesTable;
  entity: GhgSeriesEntity | null;
  selectedRowIndex: number | null;
  resolution: ResolutionMode | undefined;
  modifications: GhgCellModification[];
  running: boolean;
  onApprove: () => void;
  onSubmitEdit: (
    colIndex: number,
    rowIndex: number,
    value: number,
    reason: string,
  ) => void;
}) {
  const rowIndex = finding?.rowIndex ?? selectedRowIndex;
  const cellMods = useMemo(() => {
    if (finding?.scope === "factor") {
      const header = finding.entityKeys[0];
      return modifications.filter(
        (row) => row.entityKey === header && row.rowIndex === -1,
      );
    }
    if (!entity || rowIndex == null) {
      return entity
        ? modifications.filter((row) => row.entityKey === entity.key)
        : modifications;
    }
    return modifications.filter(
      (row) => row.colIndex === entity.colIndex && row.rowIndex === rowIndex,
    );
  }, [entity, finding, modifications, rowIndex]);
  const currentValue =
    finding?.scope === "factor"
      ? table.constants.find((row) => finding.entityKeys.includes(row.header))
          ?.value ?? finding.value
      : entity && rowIndex != null
        ? entity.values[rowIndex]
        : finding?.value ?? null;
  const factor = table.constants.find((row) =>
    finding?.scope === "factor" ? finding.entityKeys.includes(row.header) : false,
  );
  const formEntity =
    factor != null
      ? {
          key: factor.header,
          header: factor.header,
          label: factor.label,
          unit: factor.unit,
          colIndex: factor.colIndex,
          values: [factor.value],
          min: factor.value,
          max: factor.value,
        }
      : entity;
  const formRow = factor != null ? 0 : rowIndex;
  const canEdit = Boolean(
    formEntity &&
      (factor != null || rowIndex != null) &&
      (finding?.editable ?? true),
  );
  const stamp =
    finding?.timeMs ??
    (entity && rowIndex != null ? table.times[rowIndex] : null);

  if (!finding && rowIndex == null) {
    return (
      <aside className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <p className="text-[11px] text-mist">
          Click a colored or blue sample on the trend to inspect or edit it.
        </p>
        {modifications.length > 0 ? <ModificationLog rows={modifications} /> : null}
      </aside>
    );
  }

  return (
    <aside className="flex flex-wrap items-start gap-x-8 gap-y-3 px-4 py-3">
      <div className="min-w-[14rem] max-w-md space-y-1">
        {finding ? (
          <>
            <p className="text-[10px] tracking-[0.14em] text-mist uppercase">
              {finding.scope === "factor"
                ? "Period factor"
                : "Why this point"}
              {finding.ruleId ? ` · ${finding.ruleId}` : ""}
              {finding.dimension ? ` · ${finding.dimension}` : ""}
            </p>
            <p className="text-[13px] font-semibold text-frost">{finding.title}</p>
            <p className="text-[12px] leading-snug text-frost">{finding.reason}</p>
            <p className="text-[10px] text-mist">
              {finding.severity} severity
              {finding.message ? ` · ${finding.message}` : ""}
            </p>
            {finding.scope === "factor" ? (
              <p className="text-[10px] text-mist">
                Changing this value updates every row in the CSV.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-[10px] tracking-[0.14em] text-mist uppercase">
              Reviewed sample
            </p>
            <p className="text-[13px] font-semibold text-frost">
              {entity?.label ?? "Changed value"}
            </p>
          </>
        )}
        <p className="font-mono text-[10px] text-frost">
          {stamp != null
            ? new Date(stamp).toISOString().replace(".000Z", "Z")
            : ""}
          {currentValue != null ? ` · ${currentValue}` : ""}
          {formEntity?.unit ? ` ${formEntity.unit}` : ""}
        </p>
        {resolution ? (
          <p className="text-[10px] text-carbon-400">
            {resolution === "edited" ? "Edited — waiting on rerun marks" : "Approved"}
          </p>
        ) : null}
        {cellMods.length > 0 ? <ModificationLog rows={cellMods} /> : null}
      </div>
      <div className="min-w-[18rem] flex-1 space-y-2">
        {canEdit && formEntity && formRow != null ? (
          <EditForm
            key={`${finding?.id ?? "edit"}:${formRow}:${formEntity.colIndex}`}
            entity={formEntity}
            rowIndex={formRow}
            current={currentValue}
            disabled={running}
            showApprove={Boolean(finding)}
            onApprove={onApprove}
            onSubmit={(col, row, value, reason) =>
              onSubmitEdit(col, factor != null ? -1 : row, value, reason)
            }
          />
        ) : finding ? (
          <button
            type="button"
            disabled={running}
            onClick={onApprove}
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-frost ring-1 ring-line/70 disabled:text-mist"
          >
            Approve without editing
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function ModificationLog({ rows }: { rows: GhgCellModification[] }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-frost">Modification log</p>
      <ul className="mt-1 max-h-16 space-y-0.5 overflow-y-auto">
        {[...rows].reverse().map((row) => (
          <li key={row.id} className="text-[10px] leading-snug text-mist">
            <span className="font-mono text-[#3d6ea8]">
              {row.previous ?? "—"} → {row.value}
            </span>
            <span className="ml-1">{row.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditForm({
  entity,
  rowIndex,
  current,
  disabled,
  showApprove,
  onApprove,
  onSubmit,
}: {
  entity: GhgSeriesEntity;
  rowIndex: number;
  current: number | null;
  disabled: boolean;
  showApprove: boolean;
  onApprove: () => void;
  onSubmit: (
    colIndex: number,
    rowIndex: number,
    value: number,
    reason: string,
  ) => void;
}) {
  const [text, setText] = useState(current != null ? String(current) : "");
  const [reason, setReason] = useState("");
  const value = Number(text);
  const ready = Number.isFinite(value) && reason.trim().length > 0;
  return (
    <form
      className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[8rem_minmax(0,1fr)]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onSubmit(entity.colIndex, rowIndex, value, reason.trim());
      }}
    >
      <label className="flex min-w-0 flex-col gap-1.5 text-[10px] leading-none text-mist">
        New value
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={disabled}
          className="h-10 w-full rounded-lg bg-white px-2.5 font-mono text-[12px] leading-none text-frost ring-1 ring-line/70"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1.5 text-[10px] leading-none text-mist">
        Clarification
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={disabled}
          required
          rows={1}
          placeholder="Why are you changing this value?"
          className="h-10 w-full resize-none rounded-lg bg-white px-2.5 py-2 text-[12px] leading-none text-frost ring-1 ring-line/70"
        />
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={disabled || !ready}
          className="rounded-lg bg-carbon-400 px-3 py-1.5 text-[11px] font-semibold text-off-white disabled:bg-ink-700 disabled:text-mist"
        >
          Submit and rerun quality
        </button>
        {showApprove ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onApprove}
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-frost ring-1 ring-line/70 disabled:text-mist"
          >
            Approve without editing
          </button>
        ) : null}
      </div>
    </form>
  );
}
