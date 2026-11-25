"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, CircleAlert, Info, LineChart, RotateCw, Sparkles, Table2, TriangleAlert } from "lucide-react";

import type { QualityState } from "@/hooks/use-quality";
import type { DatasetIndex } from "@/lib/mrv/calc/evaluate";
import { nodeSources, nodeTrend, trendKind, trendShape, trendUnit, type TrendPoint } from "@/lib/mrv/calc/trend";
import type { CalcNode } from "@/lib/mrv/calc/types";
import { addDays, diffDays, formatDay, formatRange } from "@/lib/mrv/days";
import type { DateRange } from "@/lib/mrv/types";
import {
  SEVERITY_LABEL,
  VERDICT_LABEL,
  bySeverity,
  findingsForSources,
  touches,
  verdictFor,
  type FindingStatus,
  type QualityFinding,
  type QualitySeverity,
  type QualityVerdict,
} from "@/lib/quality/types";
import { formatQuantity } from "../format";
import { CALC_TONE } from "../theme";

/**
 * The selected node's value day by day, full width under the calculation tree,
 * with what the data quality engine found marked on it. An equation is worked
 * out from its terms each day; a constant or dated value draws as a straight
 * line or steps. Each finding is a band over its days and a marker in the lane
 * above the line, shaped and named by severity so colour is never the only cue.
 * Beside the chart, the findings in the engine's words, to confirm or dismiss.
 */

/** Severity marks: each clears 3:1 on the floor's dark surfaces, and each has its own shape and label. */
export const QUALITY_TONE: Record<QualitySeverity, { color: string; label: string; Icon: typeof TriangleAlert }> = {
  blocks: { color: "#E8654E", label: SEVERITY_LABEL.blocks, Icon: TriangleAlert },
  look: { color: "#F2B33D", label: SEVERITY_LABEL.look, Icon: CircleAlert },
  info: { color: "#A9B5A2", label: SEVERITY_LABEL.info, Icon: Info },
};
const VERDICT_TONE: Record<QualityVerdict, string> = { blocked: QUALITY_TONE.blocks.color, needs_look: QUALITY_TONE.look.color, clear: "#9EAD69" };
const LINE = "#D8CDB3";
const SURFACE = "#0D1802";
const GRID = "rgba(255,255,255,0.08)";
const TICK = "rgba(255,255,255,0.45)";
const MARGIN = { left: 56, right: 14, top: 6, bottom: 24 };
const LANE_ROW = 15;

function niceScale(values: number[]): { lo: number; hi: number; ticks: number[] } {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min > 0 && min < max * 0.25) min = 0;
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = lo; tick <= hi + step / 2; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return { lo, hi, ticks };
}

function dayTicks(range: DateRange, width: number): string[] {
  const days = diffDays(range.start, range.end) + 1;
  const wanted = Math.max(2, Math.min(8, Math.floor(width / 110)));
  const step = Math.max(1, Math.round(days / wanted));
  const out: string[] = [];
  for (let offset = 0; offset < days; offset += step) out.push(addDays(range.start, offset));
  return out;
}

/** "17 Jul"; the first label and the first of each new year also say the year. */
function tickLabel(day: string, previous: string | undefined): string {
  return previous && previous.slice(0, 4) === day.slice(0, 4) ? formatDay(day).replace(/ \d{4}$/, "") : formatDay(day);
}

/** Triangle, circle or diamond, centred on (x, y), with a ring in the surface colour. */
function Marker({ severity, x, y, hollow }: { severity: QualitySeverity; x: number; y: number; hollow: boolean }) {
  const color = QUALITY_TONE[severity].color;
  const paint = hollow ? { fill: SURFACE, stroke: color, strokeWidth: 1.5 } : { fill: color, stroke: SURFACE, strokeWidth: 2 };
  if (severity === "blocks") return <path d={`M ${x} ${y - 6} L ${x + 6} ${y + 5} L ${x - 6} ${y + 5} Z`} {...paint} strokeLinejoin="round" />;
  if (severity === "look") return <circle cx={x} cy={y} r={5} {...paint} />;
  return <path d={`M ${x} ${y - 5.5} L ${x + 5.5} ${y} L ${x} ${y + 5.5} L ${x - 5.5} ${y} Z`} {...paint} strokeLinejoin="round" />;
}

function useSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

interface Placed {
  finding: QualityFinding;
  x: number;
  width: number;
  markerX: number;
  row: number;
}

function TrendChart({
  node,
  points,
  findings,
  range,
  selectedId,
  onSelect,
}: {
  node: CalcNode;
  points: TrendPoint[];
  findings: QualityFinding[];
  range: DateRange;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const shape = trendShape(node);
  const values = points.flatMap((point) => (point.value == null ? [] : [point.value]));
  const plotW = Math.max(0, size.width - MARGIN.left - MARGIN.right);
  const band = points.length ? plotW / points.length : 0;
  const xOf = (index: number) => MARGIN.left + index * band;

  // Markers in a lane above the line, in rows so none overlap.
  const rows: number[] = [];
  const placed = [...findings]
      .map((finding) => {
        const start = finding.start < range.start ? range.start : finding.start;
        const end = finding.end > range.end ? range.end : finding.end;
        const first = diffDays(range.start, start);
        const width = (diffDays(start, end) + 1) * band;
        return { finding, x: xOf(first), width, markerX: xOf(first) + width / 2, row: 0 };
      })
      .sort((a, b) => a.markerX - b.markerX)
      .map((item): Placed => {
        let row = rows.findIndex((lastX) => item.markerX - lastX >= 14);
        if (row === -1) row = rows.length;
        rows[row] = item.markerX;
        return { ...item, row: Math.min(row, 2) };
      });
  const laneH = (Math.max(1, ...placed.map((item) => item.row + 1)) * LANE_ROW) + 6;
  const plotTop = MARGIN.top + laneH;
  const plotBottom = size.height - MARGIN.bottom;
  const plotH = Math.max(0, plotBottom - plotTop);

  const scale = values.length ? niceScale(values) : null;
  const yOf = (value: number) => (scale ? plotBottom - ((value - scale.lo) / (scale.hi - scale.lo || 1)) * plotH : plotBottom);

  let path = "";
  if (scale) {
    let open = false;
    points.forEach((point, index) => {
      if (point.value == null) {
        open = false;
        return;
      }
      const y = yOf(point.value).toFixed(1);
      if (shape === "step") {
        path += `${open ? ` V ${y}` : ` M ${xOf(index).toFixed(1)} ${y}`} H ${xOf(index + 1).toFixed(1)}`;
      } else {
        path += `${open ? " L" : " M"} ${(xOf(index) + band / 2).toFixed(1)} ${y}`;
      }
      open = true;
    });
    path = path.trim();
  }

  const lonely = shape === "line" ? points.filter((point, index) => point.value != null && points[index - 1]?.value == null && points[index + 1]?.value == null) : [];
  const gaps = useMemo(() => {
    const out: { first: number; count: number }[] = [];
    points.forEach((point, index) => {
      if (point.value != null) return;
      const last = out[out.length - 1];
      if (last && last.first + last.count === index) last.count += 1;
      else out.push({ first: index, count: 1 });
    });
    return out;
  }, [points]);

  const hovered = hover == null ? null : points[hover];
  const hoveredFindings = hovered ? findings.filter((finding) => finding.start <= hovered.day && finding.end >= hovered.day).sort(bySeverity) : [];

  function pointAt(clientX: number, element: Element) {
    const px = clientX - element.getBoundingClientRect().left;
    if (px < MARGIN.left || px > MARGIN.left + plotW || !band) return setHover(null);
    setHover(Math.min(points.length - 1, Math.max(0, Math.floor((px - MARGIN.left) / band))));
  }

  function onMarkerKey(event: KeyboardEvent, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  }

  return (
    <div ref={box} className="relative h-full min-h-[160px] w-full">
      {size.width > 0 && size.height > 0 ? (
        <svg
          width={size.width}
          height={size.height}
          className="block"
          role="img"
          aria-label={`${node.label} per day, ${formatRange(range)}${findings.length ? `, ${findings.length} data quality finding${findings.length === 1 ? "" : "s"} marked` : ""}`}
          onPointerMove={(event) => pointAt(event.clientX, event.currentTarget)}
          onPointerLeave={() => setHover(null)}
        >
          {scale?.ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={yOf(tick)} y2={yOf(tick)} stroke={GRID} />
              <text x={MARGIN.left - 8} y={yOf(tick) + 3.5} textAnchor="end" fontSize="10.5" fill={TICK} style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatQuantity(tick)}
              </text>
            </g>
          ))}
          {scale ? (
            <text x={4} y={plotTop - 8} fontSize="10.5" fill={TICK}>
              {trendUnit(node)}
            </text>
          ) : null}
          {dayTicks(range, plotW).map((day, index, days) => (
            <text key={day} x={xOf(diffDays(range.start, day)) + band / 2} y={plotBottom + 16} textAnchor={index === 0 ? "start" : "middle"} fontSize="10.5" fill={TICK}>
              {tickLabel(day, days[index - 1])}
            </text>
          ))}

          {/* Days with no value: a faint wash, so a gap reads as missing, not as zero. */}
          {gaps.map((gap) => (
            <rect key={gap.first} x={xOf(gap.first)} y={plotTop} width={gap.count * band} height={plotH} fill="rgba(255,255,255,0.035)" />
          ))}

          {/* Findings: a band over their days, a marker in the lane above. */}
          {placed.map(({ finding, x, width }) => {
            const tone = QUALITY_TONE[finding.severity];
            const dismissed = finding.status === "dismissed";
            const selected = finding.id === selectedId;
            return (
              <rect
                key={`band-${finding.id}`}
                x={x}
                y={plotTop}
                width={Math.max(width, 2)}
                height={plotH}
                fill={tone.color}
                fillOpacity={dismissed ? 0.04 : selected ? 0.2 : 0.1}
                stroke={selected ? tone.color : "none"}
                strokeOpacity={0.7}
              />
            );
          })}

          {path ? <path d={path} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {lonely.map((point) => (
            <circle key={point.day} cx={xOf(points.indexOf(point)) + band / 2} cy={yOf(point.value as number)} r={3} fill={LINE} />
          ))}

          {placed.map(({ finding, markerX, row }) => (
            <g
              key={`mark-${finding.id}`}
              role="button"
              tabIndex={0}
              aria-label={`${SEVERITY_LABEL[finding.severity]}: ${finding.text.headline}`}
              className="cursor-pointer outline-none focus-visible:[&>circle:first-child]:stroke-white"
              onClick={() => onSelect(finding.id)}
              onKeyDown={(event) => onMarkerKey(event, finding.id)}
            >
              <circle cx={markerX} cy={MARGIN.top + LANE_ROW / 2 + row * LANE_ROW} r={12} fill="transparent" stroke="transparent" strokeWidth={1.5} />
              <Marker severity={finding.severity} x={markerX} y={MARGIN.top + LANE_ROW / 2 + row * LANE_ROW} hollow={finding.status === "dismissed"} />
            </g>
          ))}

          {hovered ? (
            <g pointerEvents="none">
              <line x1={xOf(hover!) + band / 2} x2={xOf(hover!) + band / 2} y1={plotTop} y2={plotBottom} stroke="rgba(255,255,255,0.35)" />
              {hovered.value != null ? <circle cx={xOf(hover!) + band / 2} cy={yOf(hovered.value)} r={4} fill={LINE} stroke={SURFACE} strokeWidth={2} /> : null}
            </g>
          ) : null}
        </svg>
      ) : null}

      {!values.length && size.width > 0 ? (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-[12px] text-white/45">No value for this term in {formatRange(range)}.</p>
      ) : null}

      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 w-[260px] rounded-xl border border-white/10 bg-black/80 px-3 py-2 text-[11.5px] backdrop-blur-md"
          style={{
            top: plotTop,
            left: Math.min(Math.max(0, xOf(hover!) + band / 2 + 12), Math.max(0, size.width - 272)),
          }}
        >
          <p className="text-white/50">{formatDay(hovered.day)}</p>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span className="font-mono text-[15px] font-semibold text-white tabular-nums">{formatQuantity(hovered.value)}</span>
            <span className="text-white/50">{node.unit}</span>
            {hovered.status !== "ok" ? <span style={{ color: CALC_TONE[hovered.status].ink }}>· {CALC_TONE[hovered.status].label.toLowerCase()}</span> : null}
          </p>
          {hoveredFindings.slice(0, 3).map((finding) => {
            const tone = QUALITY_TONE[finding.severity];
            return (
              <p key={finding.id} className="mt-1.5 flex gap-1.5 leading-snug text-white/80">
                <tone.Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: tone.color }} />
                <span>
                  <span className="sr-only">{tone.label}: </span>
                  {finding.text.headline}
                </span>
              </p>
            );
          })}
          {hoveredFindings.length > 3 ? <p className="mt-1 text-white/45">and {hoveredFindings.length - 3} more</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function TrendTable({ node, points, findings }: { node: CalcNode; points: TrendPoint[]; findings: QualityFinding[] }) {
  return (
    <div className="scroll-slim h-full overflow-auto">
      <table className="w-full text-left text-[11.5px]">
        <thead className="sticky top-0 bg-[#141E06] text-[10px] tracking-[0.12em] text-white/45 uppercase">
          <tr>
            <th className="px-3 py-1.5 font-semibold">Day</th>
            <th className="px-3 py-1.5 text-right font-semibold">{trendUnit(node)}</th>
            <th className="px-3 py-1.5 font-semibold">Findings</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => {
            const on = findings.filter((finding) => finding.start <= point.day && finding.end >= point.day);
            return (
              <tr key={point.day} className="border-t border-white/5">
                <td className="px-3 py-1 text-white/65">{formatDay(point.day)}</td>
                <td className="px-3 py-1 text-right font-mono text-white/85 tabular-nums">{formatQuantity(point.value)}</td>
                <td className="px-3 py-1 text-white/65">{on.map((finding) => SEVERITY_LABEL[finding.severity]).join(", ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Decide({ finding, quality }: { finding: QualityFinding; quality: QualityState }) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = quality.saving === finding.id;

  async function save(decision: FindingStatus, why = "") {
    setError(null);
    const problem = await quality.decide(finding.id, decision, why);
    if (problem) setError(problem);
    else setDismissing(false);
  }

  if (finding.status !== "open") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => save("open")} className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50">
          Reopen
        </button>
        {error ? <span className="text-[11px] text-[#E0A79D]">{error}</span> : null}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      {dismissing ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save("dismissed", reason);
          }}
        >
          <label className="block text-[11px] text-white/60" htmlFor={`reason-${finding.id}`}>
            Why is this not a problem? Everyone on the project sees the reason.
          </label>
          <textarea
            id={`reason-${finding.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Planned maintenance stop, 9–14 Aug (operations log attached to the journey)"
            className="w-full rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || reason.trim().length < 3} className="rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-white disabled:opacity-40">
              Dismiss with this reason
            </button>
            <button type="button" onClick={() => setDismissing(false)} className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white/60 hover:text-white">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {finding.advisory || finding.severity !== "blocks" ? (
            <button type="button" disabled={busy} onClick={() => save("confirmed")} className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/10 disabled:opacity-50">
              {finding.advisory ? "Confirm it's a problem" : "Confirm"}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => setDismissing(true)} className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white/85 hover:bg-white/10 disabled:opacity-50">
            Dismiss…
          </button>
        </div>
      )}
      {error ? <p className="text-[11px] text-[#E0A79D]">{error}</p> : null}
    </div>
  );
}

function FindingItem({ finding, open, onOpen, quality }: { finding: QualityFinding; open: boolean; onOpen: () => void; quality: QualityState }) {
  const tone = QUALITY_TONE[finding.severity];
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  return (
    <li ref={ref} className={`rounded-xl border px-3 py-2 ${open ? "border-white/20 bg-white/[0.06]" : "border-transparent hover:bg-white/[0.04]"}`}>
      <button type="button" onClick={onOpen} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
        <tone.Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: tone.color }} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-[10px] font-semibold tracking-[0.08em] uppercase">
            <span style={{ color: tone.color }}>{tone.label}</span>
            <span className="text-white/40">{formatRange({ start: finding.start, end: finding.end })}</span>
            {finding.status !== "open" ? <span className="rounded-full bg-white/10 px-1.5 py-px text-white/70">{finding.status}</span> : null}
          </span>
          <span className={`mt-0.5 block text-[12px] leading-snug ${finding.status === "dismissed" ? "text-white/45 line-through decoration-white/20" : "text-white/90"}`}>{finding.text.headline}</span>
        </span>
      </button>
      {open ? (
        <div className="mt-2 space-y-1.5 pl-[22px] text-[11.5px] leading-relaxed">
          <p className="text-white/75"><span className="font-semibold text-white/50">What we saw. </span>{finding.text.saw}</p>
          <p className="text-white/75"><span className="font-semibold text-white/50">Why it matters. </span>{finding.text.matters}</p>
          <p className="text-white/90"><span className="font-semibold text-white/50">What to do. </span>{finding.text.todo}</p>
          <p className="text-[11px] text-white/45">How we found it: {finding.text.how}</p>
          {finding.review ? (
            <p className="text-[11px] text-white/60">
              {finding.review.decision === "dismissed" ? "Dismissed" : "Confirmed"}
              {finding.review.at ? ` on ${formatDay(finding.review.at.slice(0, 10))}` : ""}
              {finding.review.reason ? `: “${finding.review.reason}”` : ""}
            </p>
          ) : null}
          {quality.view?.canDecide ? <Decide finding={finding} quality={quality} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function RunStatus({ quality }: { quality: QualityState | null }) {
  if (!quality || quality.status === "loading") return <span className="text-white/45">Reading the data quality checks…</span>;
  if (quality.status === "error") return <span className="text-[#E0A79D]">{quality.error}</span>;
  const view = quality.view;
  if (!view?.available) return <span className="text-white/45">{view?.reason}</span>;
  if (view.running && !view.run) return <span className="text-white/60">Checking the data for the first time…</span>;
  const run = view.run;
  const when = run?.finishedAt ? `${formatDay(run.finishedAt.slice(0, 10))} ${run.finishedAt.slice(11, 16)} UTC` : "";
  return (
    <span className="text-white/45">
      {view.running ? "Checking again… · " : ""}
      Checked {when}
      {run?.source === "seeded" ? " · sample data" : ""}
    </span>
  );
}

/**
 * Claude's summary of the latest run, for operators: findings that look like one
 * problem, and what to fix first. Collapsed to its overview; the cited findings
 * on this term open in the list below. Labelled as Claude's, beside the checks'
 * own verdict, which it never changes.
 */
function RunSummaryCard({ quality, here, onOpen }: { quality: QualityState | null; here: Set<string>; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const view = quality?.view;
  const summary = view?.run?.summary;
  if (!view?.showsSummary || summary?.status !== "written" || !summary.overview) return null;
  const byId = new Map(view.findings.map((finding) => [finding.id, finding]));

  const cited = (ids: string[]) => (
    <ul className="mt-1 space-y-0.5">
      {ids.map((id) => {
        const finding = byId.get(id);
        if (!finding) return null;
        const tone = QUALITY_TONE[finding.severity];
        return (
          <li key={id}>
            <button
              type="button"
              disabled={!here.has(id)}
              onClick={() => onOpen(id)}
              title={here.has(id) ? "Open it below" : "It is on another term of the tree"}
              className="flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-[11.5px] leading-snug text-white/70 enabled:hover:bg-white/[0.06] enabled:hover:text-white"
            >
              <tone.Icon className="mt-0.5 size-3 shrink-0" style={{ color: tone.color }} aria-label={tone.label} />
              {finding.text.headline}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <section className="mb-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase">
          <Sparkles className="size-3.5" />
          Summary of the run · by Claude
        </span>
        <ChevronDown className={`size-3.5 text-white/45 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p className="mt-1.5 text-[12px] leading-snug text-white/85">{summary.overview}</p>
      {open ? (
        <div className="mt-2 space-y-2.5">
          {summary.first?.finding_ids.length ? (
            <div>
              <p className="text-[10.5px] font-semibold text-white/60">Fix first</p>
              <p className="text-[11.5px] leading-snug text-white/75">{summary.first.why}</p>
              {cited(summary.first.finding_ids)}
            </div>
          ) : null}
          {summary.groups?.map((group) => (
            <div key={group.title}>
              <p className="text-[10.5px] font-semibold text-white/60">{group.title}</p>
              {group.cause ? <p className="text-[11.5px] leading-snug text-white/75">{group.cause}</p> : null}
              {cited(group.finding_ids)}
            </div>
          ))}
          <p className="text-[10.5px] leading-snug text-white/40">Written by Claude from the checks&apos; findings. The verdict is the checks&apos;, not Claude&apos;s.</p>
        </div>
      ) : null}
    </section>
  );
}

export function CalcTrendPanel({
  node,
  index,
  range,
  quality,
  tall,
  onToggleTall,
}: {
  node: CalcNode;
  index: DatasetIndex;
  /** The selected ledger block's days. */
  range: DateRange;
  quality: QualityState | null;
  tall: boolean;
  onToggleTall: () => void;
}) {
  const history = index.range;
  const [span, setSpan] = useState<"period" | "history">("period");
  const [table, setTable] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = span === "history" && history ? history : range;

  const points = useMemo(() => nodeTrend(node, index, shown), [index, node, shown]);
  const all = useMemo(() => quality?.view?.findings ?? [], [quality?.view?.findings]);
  const sources = useMemo(() => nodeSources(node), [node]);
  const findings = useMemo(() => findingsForSources(all, sources, shown).sort(bySeverity), [all, shown, sources]);
  const periodVerdict = quality?.view?.run ? verdictFor(all, range) : null;
  const periodCount = all.filter((finding) => touches(finding, range) && finding.status !== "dismissed").length;
  const present = (["blocks", "look", "info"] as const).filter((severity) => findings.some((finding) => finding.severity === severity));

  return (
    <section aria-label={`Trend of ${node.label}`} className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <LineChart className="size-4 shrink-0 text-[#B2BE8B]" />
          <span className="font-mono text-[12.5px] font-semibold text-white">{node.symbol}</span>
          <span className="truncate text-[12.5px] text-white/80">{node.label}</span>
          <span className="hidden truncate text-[11px] text-white/40 xl:inline">· {trendKind(node)}</span>
        </div>
        {periodVerdict ? (
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px]" title="The data quality engine's verdict for the selected period, over every term">
            <span className="size-2 rounded-full" style={{ background: VERDICT_TONE[periodVerdict] }} />
            <span className="text-white/55">This period:</span>
            <span className="font-semibold text-white/90">{VERDICT_LABEL[periodVerdict]}</span>
            {periodCount ? <span className="text-white/45">· {periodCount} finding{periodCount === 1 ? "" : "s"}</span> : null}
          </span>
        ) : null}
        <span className="text-[11px]">
          <RunStatus quality={quality} />
        </span>
        <div className="ml-auto flex items-center gap-1">
          {present.map((severity) => {
            const tone = QUALITY_TONE[severity];
            return (
              <span key={severity} className="mr-2 hidden items-center gap-1.5 text-[10.5px] text-white/60 md:flex">
                <svg width="12" height="12" aria-hidden>
                  <Marker severity={severity} x={6} y={6.5} hollow={false} />
                </svg>
                {tone.label}
              </span>
            );
          })}
          {history ? (
            <div className="flex rounded-lg border border-white/10 p-0.5 text-[11px] font-semibold" role="group" aria-label="Days shown">
              {(["period", "history"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={span === value}
                  onClick={() => setSpan(value)}
                  className={`rounded-md px-2 py-0.5 ${span === value ? "bg-white/15 text-white" : "text-white/55 hover:text-white"}`}
                >
                  {value === "period" ? "This period" : "All history"}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={() => setTable(!table)} aria-pressed={table} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" title={table ? "Show the chart" : "Show as a table"}>
            {table ? <LineChart className="size-4" /> : <Table2 className="size-4" />}
          </button>
          {quality?.view?.canDecide ? (
            <button type="button" disabled={Boolean(quality.view.running)} onClick={() => void quality.rerun()} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40" title="Run the data quality checks again">
              <RotateCw className={`size-4 ${quality.view.running ? "animate-spin" : ""}`} />
            </button>
          ) : null}
          <button type="button" onClick={onToggleTall} className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" title={tall ? "Make the trend smaller" : "Make the trend bigger"}>
            {tall ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <div className="min-h-0 min-w-0 flex-1 px-2 pt-2 pb-1">
          {table ? (
            <TrendTable node={node} points={points} findings={findings} />
          ) : (
            <TrendChart node={node} points={points} findings={findings} range={shown} selectedId={openId} onSelect={(id) => setOpenId(id === openId ? null : id)} />
          )}
        </div>
        <aside className="scroll-slim min-h-0 overflow-y-auto border-white/10 p-2 lg:w-[380px] lg:shrink-0 lg:border-l max-lg:max-h-48 max-lg:border-t">
          <RunSummaryCard quality={quality} here={new Set(findings.map((finding) => finding.id))} onOpen={setOpenId} />
          <p className="px-1 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase">
            Data quality · {node.symbol} · {findings.length}
          </p>
          {findings.length ? (
            <ul className="space-y-1">
              {findings.map((finding) => (
                <FindingItem key={finding.id} finding={finding} open={finding.id === openId} onOpen={() => setOpenId(finding.id === openId ? null : finding.id)} quality={quality!} />
              ))}
            </ul>
          ) : (
            <p className="px-1 text-[12px] leading-relaxed text-white/50">
              {quality?.view?.run
                ? `Nothing found in what ${node.symbol} reads for ${span === "history" ? "the whole history" : "this period"}.`
                : "Findings appear here once the data quality engine has checked this project."}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
