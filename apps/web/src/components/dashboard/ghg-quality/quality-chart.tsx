"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Search, X, ZoomIn, ZoomOut } from "lucide-react";
import type { GhgSeriesEntity, GhgSeriesTable } from "@/lib/ghg-csv-series";
import {
  type AnomalyView,
  type QualityFinding,
  type QualityStep,
  type ResolutionMode,
} from "@/lib/ghg-quality-findings";
import {
  cellEditKey,
  latestModifications,
  type GhgCellModification,
} from "@/store/ghg-quality-review-store";
import { QualityDetail } from "./quality-detail";

const VB_W = 1000;
const VB_PAD_END = 56;
const ROW_H = 88;
const FOCUS_H = 280;
const AXIS_H = 36;
const LABEL_W = 196;
const PALETTE = ["#55632a", "#6f663f", "#9c3a2f", "#b85616", "#3d4a5c", "#2f6f66"];
const REVIEWED_FILL = "#3d6ea8";
const VIOLATION_FILL = "#9c3a2f";
const ORIGIN_FILL = "#9a9588";
const PX_PER_HOUR = 56;
const PX_PER_SAMPLE = 6;
const MAX_PLOT_PX = 24_000;
const END_PAD_PX = 96;

function plotWidthPx(table: GhgSeriesTable, viewport: number): number {
  const hours = Math.max(1, (table.timeMax - table.timeMin) / 3_600_000);
  const samples = table.times.filter((ms) => ms != null).length;
  const needed = Math.max(hours * PX_PER_HOUR, samples * PX_PER_SAMPLE) + END_PAD_PX;
  return Math.max(Math.ceil(viewport), Math.min(MAX_PLOT_PX, Math.round(needed)));
}

function xOf(time: number, tMin: number, tMax: number): number {
  if (tMax <= tMin) return 0;
  return ((time - tMin) / (tMax - tMin)) * (VB_W - VB_PAD_END);
}

function yOf(value: number, min: number, max: number, height: number): number {
  const span = max - min || 1;
  return 10 + (1 - (value - min) / span) * (height - 20);
}

function downsample(
  points: { x: number; y: number }[],
  maxPoints: number,
): { x: number; y: number }[] {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const start = Math.floor(i * step);
    const end = Math.min(points.length, Math.floor((i + 1) * step));
    let minY = points[start];
    let maxY = points[start];
    for (let j = start; j < end; j += 1) {
      if (points[j].y < minY.y) minY = points[j];
      if (points[j].y > maxY.y) maxY = points[j];
    }
    out.push(minY);
    if (maxY !== minY) out.push(maxY);
  }
  return out;
}

function linePoints(
  entity: GhgSeriesEntity,
  table: GhgSeriesTable,
  height: number,
  budget: number,
  range: { min: number; max: number },
): string {
  const points: { x: number; y: number }[] = [];
  entity.values.forEach((value, index) => {
    const time = table.times[index];
    if (value == null || time == null) return;
    points.push({
      x: xOf(time, table.timeMin, table.timeMax),
      y: yOf(value, range.min, range.max, height),
    });
  });
  return downsample(points, budget)
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

function zStats(values: (number | null)[]): { mean: number; std: number } | null {
  const finite = values.filter((n): n is number => n != null);
  if (finite.length === 0) return null;
  const mean = finite.reduce((sum, n) => sum + n, 0) / finite.length;
  const variance =
    finite.reduce((sum, n) => sum + (n - mean) ** 2, 0) / finite.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

function zScores(values: (number | null)[]): (number | null)[] {
  const stats = zStats(values);
  if (!stats) return values;
  return values.map((n) => (n == null ? null : (n - stats.mean) / stats.std));
}

function zOfValue(values: (number | null)[], value: number): number {
  const stats = zStats(values);
  if (!stats) return 0;
  return (value - stats.mean) / stats.std;
}

function originalValues(
  modifications: GhgCellModification[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of modifications) {
    if (row.previous == null || row.rowIndex < 0) continue;
    const key = cellEditKey(row.colIndex, row.rowIndex);
    if (!map.has(key)) map.set(key, row.previous);
  }
  return map;
}

function rangeWithOrigins(
  entity: GhgSeriesEntity,
  origins: Map<string, number>,
): { min: number; max: number } {
  let min = entity.min;
  let max = entity.max;
  for (const [key, previous] of origins) {
    const colIndex = Number(key.split(":")[0]);
    if (colIndex !== entity.colIndex) continue;
    min = Math.min(min, previous);
    max = Math.max(max, previous);
  }
  if (min === entity.min && max === entity.max) {
    return { min: entity.min, max: entity.max };
  }
  const pad = (max - min) * 0.08 || 1;
  return { min: min - pad, max: max + pad };
}

function overlayZAxis(
  entities: GhgSeriesEntity[],
  origins: Map<string, number>,
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const entity of entities) {
    for (const z of zScores(entity.values)) {
      if (z == null) continue;
      if (z < min) min = z;
      if (z > max) max = z;
    }
    for (const [key, previous] of origins) {
      const colIndex = Number(key.split(":")[0]);
      if (colIndex !== entity.colIndex) continue;
      const z = zOfValue(entity.values, previous);
      if (z < min) min = z;
      if (z > max) max = z;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: -3, max: 3 };
  if (max - min < 1e-6) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

function axisTicks(
  tMin: number,
  tMax: number,
  plotWidth: number,
): { x: number; label: string }[] {
  const span = tMax - tMin;
  const count = Math.max(6, Math.round(plotWidth / 140));
  const ticks: { x: number; label: string }[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = tMin + (span * i) / count;
    const date = new Date(t);
    const label =
      span > 2 * 24 * 3600 * 1000
        ? `${date.getUTCMonth() + 1}/${date.getUTCDate()} ${String(date.getUTCHours()).padStart(2, "0")}:00`
        : `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
    ticks.push({ x: xOf(t, tMin, tMax), label });
  }
  return ticks;
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function editMarkId(colIndex: number, rowIndex: number): string {
  return `edit:${cellEditKey(colIndex, rowIndex)}`;
}

function parseEditId(id: string): { colIndex: number; rowIndex: number } | null {
  if (!id.startsWith("edit:")) return null;
  const [col, row] = id.slice(5).split(":");
  const colIndex = Number(col);
  const rowIndex = Number(row);
  if (!Number.isInteger(colIndex) || !Number.isInteger(rowIndex)) return null;
  return { colIndex, rowIndex };
}

type ChartMark = {
  id: string;
  finding: QualityFinding | null;
  x: number;
  y: number;
  previousY: number | null;
  resolved: boolean;
  selected: boolean;
  ghost: boolean;
  edited: boolean;
  note?: string;
};

function pointY(
  entity: GhgSeriesEntity,
  rowIndex: number,
  height: number,
  range: { min: number; max: number },
  zAxis?: { min: number; max: number },
): number {
  const value = entity.values[rowIndex];
  if (zAxis) {
    const z = zScores(entity.values)[rowIndex] ?? 0;
    return yOf(z, zAxis.min, zAxis.max, height);
  }
  return yOf(value ?? range.min, range.min, range.max, height);
}

function previousYOf(
  entity: GhgSeriesEntity,
  previous: number,
  height: number,
  range: { min: number; max: number },
  zAxis?: { min: number; max: number },
): number {
  if (zAxis) return yOf(zOfValue(entity.values, previous), zAxis.min, zAxis.max, height);
  return yOf(previous, range.min, range.max, height);
}

function marksFor(
  entity: GhgSeriesEntity,
  table: GhgSeriesTable,
  findings: QualityFinding[],
  resolutions: Record<string, ResolutionMode>,
  selectedId: string | null,
  step: QualityStep,
  anomalyView: AnomalyView,
  height: number,
  edits: Map<string, GhgCellModification>,
  origins: Map<string, number>,
  range: { min: number; max: number },
  zAxis?: { min: number; max: number },
): ChartMark[] {
  const usedRows = new Set<number>();
  const marks: ChartMark[] = findings
    .filter(
      (finding) =>
        finding.entityKeys.includes(entity.key) &&
        finding.rowIndex != null &&
        finding.timeMs != null,
    )
    .map((finding) => {
      const rowIndex = finding.rowIndex as number;
      usedRows.add(rowIndex);
      const edit = edits.get(cellEditKey(entity.colIndex, rowIndex));
      const previous = origins.get(cellEditKey(entity.colIndex, rowIndex));
      return {
        id: finding.id,
        finding,
        x: xOf(finding.timeMs as number, table.timeMin, table.timeMax),
        y: pointY(entity, rowIndex, height, range, zAxis),
        previousY:
          edit && previous != null
            ? previousYOf(entity, previous, height, range, zAxis)
            : null,
        resolved: Boolean(resolutions[finding.groupId]),
        selected: finding.id === selectedId || editMarkId(entity.colIndex, rowIndex) === selectedId,
        ghost: step === 2 && finding.family != null && finding.family !== anomalyView,
        edited: Boolean(edit),
        note: edit?.reason,
      };
    });

  for (const edit of edits.values()) {
    if (edit.entityKey !== entity.key && edit.colIndex !== entity.colIndex) continue;
    if (usedRows.has(edit.rowIndex)) continue;
    const time = table.times[edit.rowIndex];
    if (time == null) continue;
    const id = editMarkId(entity.colIndex, edit.rowIndex);
    const previous = origins.get(cellEditKey(entity.colIndex, edit.rowIndex));
    marks.push({
      id,
      finding: null,
      x: xOf(time, table.timeMin, table.timeMax),
      y: pointY(entity, edit.rowIndex, height, range, zAxis),
      previousY:
        previous != null
          ? previousYOf(entity, previous, height, range, zAxis)
          : null,
      resolved: true,
      selected: selectedId === id,
      ghost: false,
      edited: true,
      note: edit.reason,
    });
  }
  return marks;
}

function ProblemDot({
  mark,
  plotWidth,
  live,
  onSelect,
}: {
  mark: ChartMark;
  plotWidth: number;
  live?: boolean;
  onSelect: (id: string) => void;
}) {
  const fill = mark.edited
    ? REVIEWED_FILL
    : mark.resolved
      ? "#f4f1ea"
      : VIOLATION_FILL;
  const scale = VB_W / plotWidth;
  const r = (mark.selected && live ? 7 : mark.edited ? 6 : 5) * scale;
  const moved =
    mark.edited &&
    mark.previousY != null &&
    Math.abs(mark.previousY - mark.y) > 0.4;
  const pulse = Boolean(live) && mark.selected && !mark.ghost;
  const ring = r * 2.15;
  return (
    <g
      opacity={mark.ghost ? 0.25 : 1}
      className="cursor-pointer"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(mark.id);
      }}
    >
      {moved ? (
        <g opacity={0.55} pointerEvents="none">
          <line
            x1={mark.x}
            y1={mark.previousY ?? mark.y}
            x2={mark.x}
            y2={mark.y}
            stroke={ORIGIN_FILL}
            strokeWidth={1.6 * scale}
            strokeDasharray={`${3.5 * scale} ${3 * scale}`}
            strokeLinecap="round"
          />
          <circle
            cx={mark.x}
            cy={mark.previousY ?? mark.y}
            r={4.2 * scale}
            fill={ORIGIN_FILL}
          />
        </g>
      ) : null}
      {pulse ? (
        <g pointerEvents="none">
          <circle
            cx={mark.x}
            cy={mark.y}
            r={ring}
            fill={fill}
            className="ghg-finding-pulse"
          />
          <circle
            cx={mark.x}
            cy={mark.y}
            r={ring}
            fill={fill}
            className="ghg-finding-pulse ghg-finding-pulse--late"
          />
        </g>
      ) : null}
      <circle
        cx={mark.x}
        cy={mark.y}
        r={r}
        fill={fill}
        stroke={mark.edited ? "#dce8f4" : mark.resolved ? "#55632a" : "white"}
        strokeWidth={(mark.edited || mark.resolved ? 2 : 1.2) * scale}
      />
      {mark.resolved && !mark.edited ? (
        <circle cx={mark.x} cy={mark.y} r={2.2 * scale} fill="#55632a" />
      ) : null}
      <title>
        {mark.edited
          ? `Reviewed change${mark.note ? `: ${mark.note}` : ""}`
          : mark.finding?.reason ||
            `${mark.finding?.title ?? "Finding"}: ${mark.finding?.message ?? ""}`}
      </title>
    </g>
  );
}

function TimeAxis({
  ticks,
  plotWidth,
}: {
  ticks: { x: number; label: string }[];
  plotWidth: number;
}) {
  return (
    <svg width={plotWidth} height={AXIS_H} className="block shrink-0">
      <line x1="0" y1={AXIS_H - 8} x2={plotWidth} y2={AXIS_H - 8} stroke="#c5c1b7" />
      {ticks.map((tick) => {
        const x = (tick.x / VB_W) * plotWidth;
        return (
          <g key={tick.x}>
            <line
              x1={x}
              y1={AXIS_H - 12}
              x2={x}
              y2={AXIS_H - 8}
              stroke="#c5c1b7"
            />
            <text
              x={x}
              y={AXIS_H - 16}
              textAnchor="middle"
              fontSize="10"
              fill="#7a756c"
            >
              {tick.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function YScale({
  min,
  max,
  heightClass,
  height,
}: {
  min: number;
  max: number;
  heightClass?: string;
  height?: number;
}) {
  return (
    <div
      className={`flex w-12 shrink-0 flex-col justify-between py-1 text-right font-mono text-[9px] text-mist ${heightClass ?? ""}`}
      style={height != null ? { height } : undefined}
    >
      <span>{formatTick(max)}</span>
      <span>{formatTick((min + max) / 2)}</span>
      <span>{formatTick(min)}</span>
    </div>
  );
}

function SeriesPlot({
  entity,
  table,
  findings,
  resolutions,
  selectedId,
  step,
  anomalyView,
  height,
  overlayY,
  color,
  plotWidth,
  edits,
  origins,
  onSelectDot,
  zAxis,
  live,
}: {
  entity: GhgSeriesEntity;
  table: GhgSeriesTable;
  findings: QualityFinding[];
  resolutions: Record<string, ResolutionMode>;
  selectedId: string | null;
  step: QualityStep;
  anomalyView: AnomalyView;
  height: number;
  overlayY?: boolean;
  color: string;
  plotWidth: number;
  edits: Map<string, GhgCellModification>;
  origins: Map<string, number>;
  onSelectDot: (id: string) => void;
  zAxis?: { min: number; max: number };
  live?: boolean;
}) {
  const budget = Math.min(2000, Math.max(400, Math.round(plotWidth / 2)));
  const scale = VB_W / plotWidth;
  const zs = overlayY || zAxis ? zScores(entity.values) : null;
  const axis = zAxis;
  const range = rangeWithOrigins(entity, origins);
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${height}`}
      width={plotWidth}
      height={height}
      className="block shrink-0 overflow-hidden"
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.6 * scale}
        points={
          axis && zs
            ? downsample(
                entity.values.flatMap((value, index) => {
                  const time = table.times[index];
                  const z = zs[index];
                  if (value == null || time == null || z == null) return [];
                  return [
                    {
                      x: xOf(time, table.timeMin, table.timeMax),
                      y: yOf(z, axis.min, axis.max, height),
                    },
                  ];
                }),
                budget,
              )
                .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
                .join(" ")
            : linePoints(entity, table, height, budget, range)
        }
      />
      {marksFor(
        entity,
        table,
        findings,
        resolutions,
        selectedId,
        step,
        anomalyView,
        height,
        edits,
        origins,
        range,
        axis,
      ).map((mark) => (
        <ProblemDot
          key={mark.id}
          mark={mark}
          plotWidth={plotWidth}
          live={live}
          onSelect={onSelectDot}
        />
      ))}
    </svg>
  );
}

export function QualityChart({
  table,
  step,
  findings,
  resolutions,
  modifications,
  selectedId,
  focusedEntityKey,
  overlayY,
  anomalyView,
  running,
  onSelectDot,
  onFocusEntity,
  onSubmitEdit,
  onApprove,
}: {
  table: GhgSeriesTable;
  step: QualityStep;
  findings: QualityFinding[];
  resolutions: Record<string, ResolutionMode>;
  modifications: GhgCellModification[];
  selectedId: string | null;
  focusedEntityKey: string | null;
  overlayY: boolean;
  anomalyView: AnomalyView;
  running: boolean;
  onSelectDot: (id: string, entityKey: string) => void;
  onFocusEntity: (key: string | null) => void;
  onSubmitEdit: (
    colIndex: number,
    rowIndex: number,
    value: number,
    reason: string,
  ) => void;
  onApprove: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(900);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const sync = () => setViewport(Math.max(320, node.clientWidth - LABEL_W));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const plotWidth = useMemo(
    () => plotWidthPx(table, viewport),
    [table, viewport],
  );
  const ticks = useMemo(
    () => axisTicks(table.timeMin, table.timeMax, plotWidth),
    [table.timeMin, table.timeMax, plotWidth],
  );
  const edits = useMemo(() => latestModifications(modifications), [modifications]);
  const origins = useMemo(() => originalValues(modifications), [modifications]);
  const zAxis = useMemo(
    () => overlayZAxis(table.entities, origins),
    [table.entities, origins],
  );
  const focused = table.entities.find((row) => row.key === focusedEntityKey) ?? null;
  const selectedFinding = findings.find((row) => row.id === selectedId) ?? null;
  const selectedEdit = selectedId ? parseEditId(selectedId) : null;
  const selectedRowIndex =
    selectedFinding?.rowIndex ??
    selectedEdit?.rowIndex ??
    (focused && selectedFinding?.entityKeys.includes(focused.key)
      ? selectedFinding.rowIndex
      : null);
  const innerWidth = LABEL_W + plotWidth;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <p className="shrink-0 px-3 py-1 text-[10px] text-mist">
        Scroll right on the date axis to follow the full period. After a change,
        the trend uses the new value (blue). The original sample stays green,
        joined by a faded dotted line.
      </p>
      <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div style={{ width: innerWidth, minWidth: "100%" }}>
          <div className="sticky top-0 z-10 flex bg-white">
            <div
              className="sticky left-0 z-20 shrink-0 bg-white"
              style={{ width: LABEL_W }}
            />
            <TimeAxis ticks={ticks} plotWidth={plotWidth} />
          </div>
          {overlayY ? (
            <div className="flex items-stretch">
              <div
                className="sticky left-0 z-10 flex shrink-0 flex-col gap-1 overflow-y-auto bg-white px-2 py-2"
                style={{ width: LABEL_W - 48 }}
              >
                <p className="text-[10px] text-mist">z-score</p>
                {table.entities.map((entity, index) => (
                  <button
                    key={`${entity.key}:${entity.colIndex}`}
                    type="button"
                    title={entity.header}
                    onClick={() => onFocusEntity(entity.key)}
                    className="flex items-start gap-1.5 text-left"
                  >
                    <span
                      className="mt-1 size-2 shrink-0 rounded-full"
                      style={{ background: PALETTE[index % PALETTE.length] }}
                    />
                    <span className="line-clamp-2 text-[10px] leading-tight text-frost">
                      {entity.label}
                    </span>
                  </button>
                ))}
              </div>
              <div
                className="sticky z-10 bg-white"
                style={{ left: LABEL_W - 48 }}
              >
                <YScale min={zAxis.min} max={zAxis.max} height={FOCUS_H} />
              </div>
              <div className="overflow-hidden" style={{ width: plotWidth, height: FOCUS_H }}>
                <svg
                  viewBox={`0 0 ${VB_W} ${FOCUS_H}`}
                  width={plotWidth}
                  height={FOCUS_H}
                  className="block overflow-hidden"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <clipPath id="overlay-plot-clip">
                      <rect x="0" y="0" width={VB_W} height={FOCUS_H} />
                    </clipPath>
                  </defs>
                  <g clipPath="url(#overlay-plot-clip)">
                  {table.entities.map((entity, index) => {
                    const zs = zScores(entity.values);
                    return (
                    <g key={`${entity.key}:${entity.colIndex}`}>
                      <polyline
                        fill="none"
                        stroke={PALETTE[index % PALETTE.length]}
                        strokeWidth={1.3 * (VB_W / plotWidth)}
                        points={downsample(
                          entity.values.flatMap((value, rowIndex) => {
                            const time = table.times[rowIndex];
                            const z = zs[rowIndex];
                            if (value == null || time == null || z == null) {
                              return [];
                            }
                            return [
                              {
                                x: xOf(time, table.timeMin, table.timeMax),
                                y: yOf(z, zAxis.min, zAxis.max, FOCUS_H),
                              },
                            ];
                          }),
                          Math.min(2000, Math.max(400, Math.round(plotWidth / 2))),
                        )
                          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
                          .join(" ")}
                      />
                      {marksFor(
                        entity,
                        table,
                        findings,
                        resolutions,
                        selectedId,
                        step,
                        anomalyView,
                        FOCUS_H,
                        edits,
                        origins,
                        rangeWithOrigins(entity, origins),
                        zAxis,
                      ).map((mark) => (
                        <ProblemDot
                          key={`${entity.key}:${mark.id}`}
                          mark={mark}
                          plotWidth={plotWidth}
                          onSelect={(id) => onSelectDot(id, entity.key)}
                        />
                      ))}
                    </g>
                    );
                  })}
                  </g>
                </svg>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 pb-6 pt-1">
              {table.entities.map((entity, index) => {
                const range = rangeWithOrigins(entity, origins);
                return (
                <div
                  key={`${entity.key}:${entity.colIndex}`}
                  className="flex items-stretch rounded-lg bg-off-white/50"
                >
                  <button
                    type="button"
                    onClick={() => onFocusEntity(entity.key)}
                    title={`${entity.label}${entity.unit ? ` (${entity.unit})` : ""} · ${entity.header}`}
                    className="sticky left-0 z-10 flex shrink-0 items-stretch bg-white text-left hover:bg-off-white"
                    style={{ width: LABEL_W }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1">
                      <p className="line-clamp-2 text-[11px] leading-tight font-medium text-frost">
                        {entity.label}
                      </p>
                      {entity.unit ? (
                        <p className="mt-0.5 text-[9px] text-mist">{entity.unit}</p>
                      ) : null}
                    </div>
                    <YScale min={range.min} max={range.max} heightClass="h-[88px]" />
                  </button>
                  <div
                    className="cursor-pointer"
                    style={{ width: plotWidth, height: ROW_H }}
                    onClick={() => onFocusEntity(entity.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onFocusEntity(entity.key);
                    }}
                    role="presentation"
                  >
                    <SeriesPlot
                      entity={entity}
                      table={table}
                      findings={findings}
                      resolutions={resolutions}
                      selectedId={selectedId}
                      step={step}
                      anomalyView={anomalyView}
                      height={ROW_H}
                      color={PALETTE[index % PALETTE.length]}
                      plotWidth={plotWidth}
                      edits={edits}
                      origins={origins}
                      onSelectDot={(id) => onSelectDot(id, entity.key)}
                    />
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {focused ? (
        <ExpandedSeries
          entity={focused}
          table={table}
          findings={findings}
          resolutions={resolutions}
          modifications={modifications}
          selectedId={selectedId}
          selectedFinding={selectedFinding}
          selectedEdit={selectedEdit}
          selectedRowIndex={selectedRowIndex}
          step={step}
          anomalyView={anomalyView}
          running={running}
          plotWidth={plotWidth}
          ticks={ticks}
          edits={edits}
          origins={origins}
          onSelectDot={(id) => onSelectDot(id, focused.key)}
          onClose={() => onFocusEntity(null)}
          onApprove={onApprove}
          onSubmitEdit={onSubmitEdit}
        />
      ) : null}
    </div>
  );
}

function ExpandedSeries({
  entity,
  table,
  findings,
  resolutions,
  modifications,
  selectedId,
  selectedFinding,
  selectedEdit,
  selectedRowIndex,
  step,
  anomalyView,
  running,
  plotWidth,
  ticks,
  edits,
  origins,
  onSelectDot,
  onClose,
  onApprove,
  onSubmitEdit,
}: {
  entity: GhgSeriesEntity;
  table: GhgSeriesTable;
  findings: QualityFinding[];
  resolutions: Record<string, ResolutionMode>;
  modifications: GhgCellModification[];
  selectedId: string | null;
  selectedFinding: QualityFinding | null;
  selectedEdit: { colIndex: number; rowIndex: number } | null;
  selectedRowIndex: number | null;
  step: QualityStep;
  anomalyView: AnomalyView;
  running: boolean;
  plotWidth: number;
  ticks: { x: number; label: string }[];
  edits: Map<string, GhgCellModification>;
  origins: Map<string, number>;
  onSelectDot: (id: string) => void;
  onClose: () => void;
  onApprove: () => void;
  onSubmitEdit: (
    colIndex: number,
    rowIndex: number,
    value: number,
    reason: string,
  ) => void;
}) {
  const chartBox = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const didPan = useRef(false);
  const [fitH, setFitH] = useState(180);
  const [zoom, setZoom] = useState(1);
  const [zoomFor, setZoomFor] = useState(entity.key);
  const [panning, setPanning] = useState(false);
  if (entity.key !== zoomFor) {
    setZoomFor(entity.key);
    setZoom(1);
  }

  useEffect(() => {
    const node = chartBox.current;
    if (!node) return;
    const sync = () => setFitH(Math.max(120, node.clientHeight - AXIS_H));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const plotH = Math.round(fitH * zoom);
  const range = rangeWithOrigins(entity, origins);

  function onChartPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const node = chartBox.current;
    if (!node) return;
    didPan.current = false;
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: node.scrollLeft,
      top: node.scrollTop,
    };
    node.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function onChartPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    const node = chartBox.current;
    if (!start || start.pointerId !== event.pointerId || !node) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPan.current = true;
    node.scrollLeft = start.left - dx;
    node.scrollTop = start.top - dy;
  }

  function onChartPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setPanning(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex items-stretch justify-center bg-[#1c1914]/50 p-3">
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-line/70">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line/60 px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-frost">
              {entity.label}
              {entity.unit ? (
                <span className="ml-1 font-normal text-mist">({entity.unit})</span>
              ) : null}
            </p>
            <p className="text-[10px] text-mist">
              Drag the chart to pan. Zoom if you need more vertical detail.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-mist" aria-hidden>
              <Search className="size-3.5" />
            </span>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => setZoom((value) => Math.max(1, Number((value - 0.5).toFixed(1))))}
              className="rounded-lg p-1.5 text-frost ring-1 ring-line/70 disabled:text-mist"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="w-10 text-center font-mono text-[10px] text-mist">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom >= 3}
              onClick={() => setZoom((value) => Math.min(3, Number((value + 0.5).toFixed(1))))}
              className="rounded-lg p-1.5 text-frost ring-1 ring-line/70 disabled:text-mist"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Close expanded series"
              onClick={onClose}
              className="ml-1 p-1 text-mist hover:text-frost"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>
        <div
          ref={chartBox}
          className={`min-h-0 min-w-0 flex-1 select-none overflow-auto ${panning ? "cursor-grabbing" : "cursor-grab"}`}
          style={{ touchAction: "none" }}
          onPointerDown={onChartPointerDown}
          onPointerMove={onChartPointerMove}
          onPointerUp={onChartPointerUp}
          onPointerCancel={onChartPointerUp}
          onClickCapture={(event) => {
            if (!didPan.current) return;
            event.preventDefault();
            event.stopPropagation();
            didPan.current = false;
          }}
        >
          <div style={{ width: 48 + plotWidth, minWidth: "100%" }}>
            <div className="sticky top-0 z-10 flex bg-white">
              <div className="sticky left-0 z-20 w-12 shrink-0 bg-white" />
              <TimeAxis ticks={ticks} plotWidth={plotWidth} />
            </div>
            <div className="flex items-stretch">
              <div className="sticky left-0 z-10 bg-white">
                <YScale min={range.min} max={range.max} height={plotH} />
              </div>
              <div style={{ width: plotWidth, height: plotH }}>
                <SeriesPlot
                  entity={entity}
                  table={table}
                  findings={findings}
                  resolutions={resolutions}
                  selectedId={selectedId}
                  step={step}
                  anomalyView={anomalyView}
                  height={plotH}
                  color="#55632a"
                  plotWidth={plotWidth}
                  edits={edits}
                  origins={origins}
                  live
                  onSelectDot={onSelectDot}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="shrink-0 overflow-y-auto border-t border-line/60">
          <QualityDetail
            finding={
              selectedFinding?.entityKeys.includes(entity.key)
                ? selectedFinding
                : null
            }
            table={table}
            entity={entity}
            selectedRowIndex={
              selectedEdit && selectedEdit.colIndex === entity.colIndex
                ? selectedEdit.rowIndex
                : selectedFinding?.entityKeys.includes(entity.key)
                  ? selectedRowIndex
                  : null
            }
            resolution={
              selectedFinding ? resolutions[selectedFinding.groupId] : undefined
            }
            modifications={modifications.filter(
              (row) => row.entityKey === entity.key,
            )}
            running={running}
            onApprove={onApprove}
            onSubmitEdit={onSubmitEdit}
          />
        </div>
      </div>
    </div>
  );
}
