"use client";

import { memo, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { addDays, formatDay, formatRange, monthLabel } from "@/lib/mrv/days";
import { STAGE_META } from "@/lib/mrv/registry-pipeline";
import type { DateRange, DayKey } from "@/lib/mrv/types";
import { formatTonnes } from "@/components/stage/format";
import { BLOCK_TONE } from "@/components/stage/theme";
import { boxAt, type ChainLayout, type TrendBin } from "./chain-layout";
import type { PeriodBox } from "./periods";

/**
 * Net CO₂ removal per day, from the first day of monitoring to today, on the
 * same axis as the boxes above it. Each period tints the days it covers and
 * names itself on the strip under the bars; the line is a running average.
 * Hover for a reading, click a period's days to open it, drag to move in time.
 */

const PLOT_TOP = 30;
const PLOT_H = 132;
const BASE = PLOT_TOP + PLOT_H;
const STRIP_Y = BASE + 6;
const STRIP_H = 14;
const AXIS_Y = STRIP_Y + STRIP_H + 7;
export const TREND_H = AXIS_Y + 26;

const BAR = "#A8A087";
const BAR_LIT = "#57544A";
const LINE = "#0D1802";
const HAIRLINE = "rgba(87,84,74,0.18)";

function nextMonth(day: DayKey): DayKey {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1)).toISOString().slice(0, 10);
}

/** A bar with rounded top corners, square on the baseline. */
function barPath(x: number, top: number, width: number, base: number): string {
  const r = Math.min(2, width / 2, (base - top) / 2);
  return `M ${x} ${base} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + width - r} ${top} Q ${x + width} ${top} ${x + width} ${top + r} L ${x + width} ${base} Z`;
}

function boxStage(box: PeriodBox): string {
  if (box.live) return "this period";
  return box.block ? STAGE_META[box.block.stage].label : "";
}

export const LedgerTrend = memo(function LedgerTrend({
  layout,
  history,
  bins,
  average,
  averageDays,
  max,
  binDays,
  boxes,
  selectedId,
  hoveredId,
  scroller,
  onHover,
  onPick,
}: {
  layout: ChainLayout;
  /** Days with monitoring data; today is the day after it ends. */
  history: DateRange;
  bins: TrendBin[];
  /** Running mean per bin, aligned with `bins`. */
  average: (number | null)[];
  averageDays: number;
  max: number;
  binDays: number;
  boxes: PeriodBox[];
  selectedId: string | null;
  hoveredId: string | null;
  scroller: RefObject<HTMLDivElement | null>;
  onHover: (id: string | null) => void;
  onPick: (id: string) => void;
}) {
  const { x, width } = layout;
  const [hoverX, setHoverX] = useState<number | null>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const lastHover = useRef<string | null>(null);

  const y = (value: number) => BASE - Math.min(1, value / max) * PLOT_H;
  const today = x(addDays(history.end, 1));
  const domainEnd = layout.domain ? layout.domain.end : history.end;

  const ranged = useMemo(() => boxes.filter((box) => box.range), [boxes]);
  const ownerOf = useMemo(() => bins.map((bin) => boxAt(ranged, bin.start)?.id ?? null), [bins, ranged]);

  const line = useMemo(() => {
    const top = (value: number) => BASE - Math.min(1, value / max) * PLOT_H;
    let d = "";
    let open = false;
    bins.forEach((bin, index) => {
      const value = average[index];
      if (value == null) {
        open = false;
        return;
      }
      const cx = (x(bin.start) + x(addDays(bin.end, 1))) / 2;
      d += `${open ? " L" : " M"} ${cx.toFixed(1)} ${top(value).toFixed(1)}`;
      open = true;
    });
    return d.trim();
  }, [average, bins, max, x]);

  const months = useMemo(() => {
    const out: DayKey[] = [];
    const start = layout.domain?.start ?? history.start;
    let cursor = `${start.slice(0, 7)}-01`;
    if (cursor < start) cursor = nextMonth(cursor);
    while (cursor <= domainEnd) {
      out.push(cursor);
      cursor = nextMonth(cursor);
    }
    return out;
  }, [domainEnd, history.start, layout.domain]);
  const monthPx = layout.pxPerDay * 30.4;

  const hoverIndex = hoverX == null ? -1 : bins.findIndex((bin) => x(bin.start) <= hoverX && x(addDays(bin.end, 1)) > hoverX);
  const hoverBin = hoverIndex >= 0 ? bins[hoverIndex] : null;
  const hoverOwner = hoverBin ? (ranged.find((box) => box.id === ownerOf[hoverIndex]) ?? null) : null;

  function localX(event: ReactPointerEvent<SVGSVGElement>): number {
    return event.clientX - event.currentTarget.getBoundingClientRect().left;
  }

  function hoverAt(px: number | null) {
    setHoverX(px);
    const inside = px != null && px >= layout.axisLeft && px <= layout.axisRight;
    const day = inside ? layout.dayAt(px) : null;
    const owner = day ? boxAt(ranged, day) : null;
    const id = owner?.id ?? null;
    if (id !== lastHover.current) {
      lastHover.current = id;
      onHover(id);
    }
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0 || !scroller.current) return;
    drag.current = { x: event.clientX, left: scroller.current.scrollLeft, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (state && scroller.current) {
      const dx = event.clientX - state.x;
      if (!state.moved && Math.abs(dx) > 4) {
        state.moved = true;
        setDragging(true);
        hoverAt(null);
      }
      if (state.moved) {
        scroller.current.scrollLeft = state.left - dx;
        return;
      }
    }
    hoverAt(localX(event));
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    dragged.current = Boolean(drag.current?.moved);
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const px = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const day = layout.dayAt(px);
    const owner = day ? boxAt(ranged, day) : null;
    if (owner && !owner.locked) onPick(owner.id);
  }

  const cursor = dragging ? "cursor-grabbing" : hoverOwner ? "cursor-pointer" : "cursor-grab";

  return (
    <div className="relative select-none" style={{ width, height: TREND_H }}>
      <svg
        width={width}
        height={TREND_H}
        className={`absolute top-0 left-0 block ${cursor}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          if (!drag.current) hoverAt(null);
        }}
        onClick={onClick}
        role="img"
        aria-label={`Net CO₂ removal per day, ${formatDay(history.start)} to ${formatDay(history.end)}. Each monitoring period's days are marked under the bars.`}
      >
        <defs>
          <pattern id="trend-ghost" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(87,84,74,0.5)" strokeWidth="1.2" />
          </pattern>
          <pattern id="trend-future" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(87,84,74,0.14)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Each period's days, tinted from the top so its link from the box above flows in. */}
        {ranged.map((box) => {
          const tone = BLOCK_TONE[box.tone];
          const left = x(box.range!.start);
          const w = Math.max(1, x(addDays(box.range!.end, 1)) - left);
          const lit = box.id === hoveredId || box.id === selectedId;
          return <rect key={box.id} x={left} y={0} width={w} height={STRIP_Y + STRIP_H} fill={tone.band} opacity={lit ? 0.24 : 0.12} />;
        })}

        {/* Days after today, where a period's dates run on. */}
        {domainEnd > history.end ? (
          <rect x={today} y={PLOT_TOP} width={Math.max(0, layout.axisRight - today)} height={PLOT_H} fill="url(#trend-future)" />
        ) : null}

        {/* Scale: solid hairlines at the top, the middle and the baseline. */}
        {[1, 0.5].map((share) => (
          <line key={share} x1={layout.axisLeft} x2={layout.axisRight} y1={BASE - PLOT_H * share} y2={BASE - PLOT_H * share} stroke={HAIRLINE} />
        ))}

        {/* Bars: net removal per day, each bar a mean over its days. */}
        {bins.map((bin, index) => {
          const left = x(bin.start);
          const full = x(addDays(bin.end, 1)) - left;
          const gap = full > 6 ? 2 : full > 3 ? 1 : 0;
          const w = Math.max(0.8, full - gap);
          const owner = ownerOf[index];
          const lit = owner != null && (owner === hoveredId || owner === selectedId);
          return (
            <g key={bin.start}>
              {bin.perDay != null ? (
                <path d={barPath(left + gap / 2, y(bin.perDay), w, BASE)} fill={lit ? BAR_LIT : BAR} />
              ) : bin.ghostPerDay > 0 ? (
                <rect x={left + gap / 2} y={y(bin.ghostPerDay)} width={w} height={BASE - y(bin.ghostPerDay)} fill="url(#trend-ghost)" />
              ) : null}
              {!bin.hasData ? <rect x={left} y={BASE - 3} width={Math.max(1, full)} height={3} fill="#A77618" opacity={0.55} /> : null}
            </g>
          );
        })}

        <line x1={layout.axisLeft} x2={layout.axisRight} y1={BASE} y2={BASE} stroke="rgba(87,84,74,0.45)" />

        {/* The running average, on a surface ring so it reads over the bars. */}
        {line ? (
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
            <path d={line} stroke="#F1F0F0" strokeOpacity={0.85} strokeWidth={4} />
            <path d={line} stroke={LINE} strokeWidth={2} />
          </g>
        ) : null}

        {/* The strip naming each period. */}
        {ranged.map((box) => {
          const tone = BLOCK_TONE[box.tone];
          const left = x(box.range!.start);
          const w = Math.max(1, x(addDays(box.range!.end, 1)) - left);
          const selected = box.id === selectedId;
          return (
            <g key={box.id} pointerEvents="none">
              <rect x={left + 0.5} y={STRIP_Y} width={Math.max(1, w - 1)} height={STRIP_H} rx={3} fill={tone.band} stroke={tone.side} strokeOpacity={0.6} />
              {w > 30 ? (
                <text x={left + w / 2} y={STRIP_Y + STRIP_H - 3.5} textAnchor="middle" fill={tone.ink} className="text-[9px] font-semibold">
                  {w > 92 ? `#${box.sequence} · ${box.label}` : `#${box.sequence}`}
                </text>
              ) : null}
              {selected ? <rect x={left - 1} y={1} width={w + 2} height={STRIP_Y + STRIP_H} rx={4} fill="none" stroke="#0D1802" strokeWidth={1.4} /> : null}
            </g>
          );
        })}

        {/* Today. */}
        <line x1={today} x2={today} y1={PLOT_TOP - 10} y2={AXIS_Y} stroke="#0D1802" strokeOpacity={0.55} pointerEvents="none" />

        {/* Axis: months, and every new year in bold. */}
        {months.map((month) => {
          const mx = x(month);
          const january = month.endsWith("-01-01");
          if (!january && monthPx < 5) return null;
          const nearToday = Math.abs(mx - today) < 36;
          return (
            <g key={month} pointerEvents="none">
              <line x1={mx} x2={mx} y1={AXIS_Y - 3} y2={AXIS_Y + (january ? 7 : 3)} stroke={january ? "#0D1802" : "rgba(87,84,74,0.45)"} />
              {january ? (
                <text x={mx + 3} y={AXIS_Y + 17} className="fill-earth text-[10px] font-semibold tabular-nums">
                  {month.slice(0, 4)}
                </text>
              ) : monthPx > 30 && !nearToday ? (
                <text x={mx + 3} y={AXIS_Y + 13} className="fill-strata-700 text-[9px]">
                  {monthLabel(month)}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={layout.axisLeft} x2={layout.axisRight} y1={AXIS_Y - 3} y2={AXIS_Y - 3} stroke="rgba(87,84,74,0.35)" />
        <text x={today + 4} y={AXIS_Y + 13} className="fill-earth text-[9.5px] font-semibold" pointerEvents="none">
          Today
        </text>

        {hoverBin && !dragging ? (
          <line
            x1={(x(hoverBin.start) + x(addDays(hoverBin.end, 1))) / 2}
            x2={(x(hoverBin.start) + x(addDays(hoverBin.end, 1))) / 2}
            y1={PLOT_TOP - 6}
            y2={BASE}
            stroke="rgba(13,24,2,0.45)"
            pointerEvents="none"
          />
        ) : null}
      </svg>

      {/* The scale stays at the left edge while the trend scrolls under it. */}
      <div aria-hidden className="pointer-events-none sticky left-0 z-[1] h-full w-0">
        <span className="absolute top-1.5 left-3 rounded-md bg-white/75 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-[0.12em] whitespace-nowrap text-strata-700 uppercase backdrop-blur-sm">
          Net removal · t CO₂ per day
        </span>
        {[1, 0.5].map((share) => (
          <span
            key={share}
            className="absolute left-3 -translate-y-1/2 rounded bg-white/75 px-1 font-mono text-[9.5px] text-strata-700 tabular-nums backdrop-blur-sm"
            style={{ top: BASE - PLOT_H * share }}
          >
            {formatTonnes(max * share)}
          </span>
        ))}
      </div>

      {hoverBin && hoverX != null && !dragging ? (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[240px] rounded-xl bg-[#1D250A] px-3 py-2 text-[10.5px] text-calcite shadow-lg"
          style={{ left: Math.min(width - 250, Math.max(4, hoverX + 14)), top: PLOT_TOP }}
        >
          <p className="font-semibold">{binDays === 1 ? formatDay(hoverBin.start) : formatRange({ start: hoverBin.start, end: hoverBin.end })}</p>
          <p className="mt-0.5 tabular-nums">
            {hoverBin.perDay != null
              ? `${formatTonnes(hoverBin.perDay)} t net a day`
              : hoverBin.ghostPerDay > 0
                ? `Net not calculable yet · ${formatTonnes(hoverBin.ghostPerDay)} t gross a day`
                : "No stream rows"}
          </p>
          {average[hoverIndex] != null ? (
            <p className="tabular-nums text-calcite/70">
              {averageDays}-day average {formatTonnes(average[hoverIndex])} t a day
            </p>
          ) : null}
          <p className="mt-1 border-t border-calcite/15 pt-1 text-sand">
            {hoverOwner ? `#${hoverOwner.sequence} · ${hoverOwner.label} · ${boxStage(hoverOwner)}` : "Not in a period yet"}
          </p>
          {hoverOwner ? <p className="text-calcite/60">Click to open its details</p> : null}
        </div>
      ) : null}
    </div>
  );
});
