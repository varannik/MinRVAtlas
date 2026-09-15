"use client";

import { createPortal } from "react-dom";
import type { GhgSeriesTable } from "@/lib/ghg-csv-series";
import {
  severityColor,
  type QualityFinding,
  type ResolutionMode,
} from "@/lib/ghg-quality-findings";
import type { GhgCellModification } from "@/store/ghg-quality-review-store";
import { QualityDetail } from "./quality-detail";

export function QualityFactors({
  table,
  findings,
  unmapped,
  resolutions,
  modifications,
  selectedId,
  running,
  onSelect,
  onClose,
  onApprove,
  onSubmitEdit,
}: {
  table: GhgSeriesTable;
  findings: QualityFinding[];
  unmapped: QualityFinding[];
  resolutions: Record<string, ResolutionMode>;
  modifications: GhgCellModification[];
  selectedId: string | null;
  running: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onApprove: () => void;
  onSubmitEdit: (
    colIndex: number,
    rowIndex: number,
    value: number,
    reason: string,
  ) => void;
}) {
  const selected =
    findings.find((row) => row.id === selectedId) ??
    unmapped.find((row) => row.id === selectedId) ??
    null;
  const selectedConstant =
    selected?.scope === "factor"
      ? table.constants.find((row) => selected.entityKeys.includes(row.header))
      : null;

  const flagged = new Map(findings.map((row) => [row.entityKeys[0], row]));
  const rows = [...table.constants].sort((a, b) => {
    const aFlag = flagged.has(a.header) ? 0 : 1;
    const bFlag = flagged.has(b.header) ? 0 : 1;
    return aFlag - bFlag;
  });

  if (table.constants.length === 0 && unmapped.length === 0) return null;

  return (
    <section className="flex max-h-[42%] min-h-0 shrink-0 flex-col border-t border-line/60 bg-off-white/50">
      <header className="flex shrink-0 items-baseline justify-between gap-3 px-4 py-2">
        <p className="text-[11px] font-semibold text-frost">Period factors</p>
        <p className="text-[10px] text-mist">
          One value for the whole period — not a trend. Flagged rows need a
          review.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-off-white/90 text-[10px] text-mist">
            <tr>
              <th className="px-4 py-1 font-medium">Factor</th>
              <th className="px-2 py-1 font-medium">Value</th>
              <th className="px-2 py-1 font-medium">Unit</th>
              <th className="px-4 py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const finding = flagged.get(row.header);
              const resolution = finding
                ? resolutions[finding.groupId]
                : undefined;
              const edited = modifications.some(
                (mod) => mod.entityKey === row.header && mod.rowIndex === -1,
              );
              const selectedRow = finding?.id === selectedId;
              return (
                <tr
                  key={row.header}
                  className={`cursor-pointer border-t border-line/40 ${
                    selectedRow ? "bg-white" : "hover:bg-white/70"
                  }`}
                  onClick={() => {
                    if (finding) onSelect(finding.id);
                  }}
                >
                  <td className="px-4 py-1.5 text-frost">{row.label}</td>
                  <td className="px-2 py-1.5 font-mono text-frost">{row.value}</td>
                  <td className="px-2 py-1.5 text-mist">{row.unit || "—"}</td>
                  <td className="px-4 py-1.5">
                    {finding ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            background: edited || resolution === "edited"
                              ? "#3d6ea8"
                              : resolution
                                ? "#55632a"
                                : severityColor(finding.severity),
                          }}
                        />
                        {edited || resolution === "edited"
                          ? "Reviewed"
                          : resolution
                            ? "Approved"
                            : finding.severity}
                      </span>
                    ) : (
                      <span className="text-mist">Ok</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {unmapped.length > 0 ? (
          <div className="border-t border-line/50 px-4 py-2">
            <p className="text-[10px] font-semibold text-frost">
              Other DQA hits (not a sample or factor)
            </p>
            <ul className="mt-1 space-y-1">
              {unmapped.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    className={`text-left text-[10px] ${
                      selectedId === row.id ? "text-frost" : "text-mist"
                    }`}
                  >
                    <span
                      className="mr-1.5 inline-block size-1.5 rounded-full"
                      style={{ background: severityColor(row.severity) }}
                    />
                    {row.title} · {row.message}
                    {resolutions[row.groupId] ? " · approved" : ""}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {selected && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 flex flex-col justify-end">
              <button
                type="button"
                aria-label="Close period factor"
                className="absolute inset-0 bg-[#1c1914]/50 backdrop-blur-sm"
                onClick={onClose}
              />
              <div
                className="relative z-10 mx-3 mb-3 overflow-hidden rounded-2xl bg-white shadow-[0_16px_48px_rgba(2,6,14,0.22)] ring-1 ring-line/70"
                onClick={(event) => event.stopPropagation()}
              >
                <QualityDetail
                  finding={selected}
                  table={table}
                  entity={null}
                  selectedRowIndex={null}
                  resolution={resolutions[selected.groupId]}
                  modifications={modifications.filter(
                    (row) =>
                      selectedConstant &&
                      row.entityKey === selectedConstant.header &&
                      row.rowIndex === -1,
                  )}
                  running={running}
                  onApprove={onApprove}
                  onSubmitEdit={onSubmitEdit}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
