"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { blockAt, clampToGap, freeGapAt } from "@/lib/mrv/blocks";
import type { DailyPoint } from "@/lib/mrv/calc/evaluate";
import type { Finding } from "@/lib/mrv/checks";
import { addDays, diffDays, formatDay, formatRange, monthLabel, overlaps, rangeDays } from "@/lib/mrv/days";
import { panView, zoomView } from "@/lib/mrv/ledger-view";
import type { DateRange, DayKey, LedgerBlock } from "@/lib/mrv/types";
import { useStage } from "@/store/stage-store";
import { formatTonnes } from "../format";
import { BLOCK_TONE, PROPOSAL } from "../theme";
import { useElementSize } from "../use-element-size";
import { buildBins, netScale } from "./timeline-bins";

/**
 * Net removal across the ledger's view, one bar per day (or per few days when
 * the view is long). Blocks tint the days they claim; dragging over unclaimed
 * days proposes the next block and stops at the neighbouring blocks. Swipe
 * sideways to slide through time; pinch or ⌘-scroll to zoom.
 */

const PAD_X = 10;
const PLOT_TOP = 26;
const BAND_H = 10;
/** Room above and below the bars: label, claimed band and axis. */
const CHROME_H = 76;
const CLIP_ID = "removal-timeline-plot";

function nextMonth(day: DayKey): DayKey {
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1)).toISOString().slice(0, 10);
}

export function RemovalTimeline({
  daily,
  blocks,
  bounds,
  view,
  onView,
  findings,
  height = 168,
}: {
  daily: DailyPoint[];
  blocks: LedgerBlock[];
  /** The whole history; blocks and proposals live inside it. */
  bounds: DateRange;
  /** The days drawn across the width. */
  view: DateRange;
  onView: (view: DateRange) => void;
  findings: Finding[];
  height?: number;
}) {
  const PLOT_H = height - CHROME_H;
  const BAND_Y = PLOT_TOP + PLOT_H + 6;
  const AXIS_Y = BAND_Y + BAND_H + 5;
  const [wrapRef, { width }] = useElementSize<HTMLDivElement>();
  const selection = useStage((state) => state.selection);
  const setSelection = useStage((state) => state.setSelection);
  const focusBlock = useStage((state) => state.focusBlock);
  const focusedBlockId = useStage((state) => state.focusedBlockId);
  const hoveredBlockId = useStage((state) => state.hoveredBlockId);
  const hoverBlock = useStage((state) => state.hoverBlock);
  const drag = useRef<{ anchor: DayKey; moved: boolean; startX: number } | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const total = rangeDays(view);
  const inner = Math.max(1, width - PAD_X * 2);
  const binSize = Math.max(1, Math.ceil(total / (inner / 3)));
  const allBins = useMemo(() => buildBins(daily, binSize, blocks), [binSize, blocks, daily]);
  const max = useMemo(() => netScale(allBins), [allBins]);
  const bins = allBins.filter((bin) => bin.end >= view.start && bin.start <= view.end);
  const shown = blocks.filter((block) => overlaps(block.range, view));

  const x = (day: DayKey) => PAD_X + (diffDays(view.start, day) / total) * inner;
  const xEnd = (day: DayKey) => x(addDays(day, 1));
  const y = (value: number) => PLOT_TOP + PLOT_H - Math.min(1, value / max) * PLOT_H;
  const dayAt = (px: number): DayKey => {
    const index = Math.floor(((px - PAD_X) / inner) * total);
    return addDays(view.start, Math.min(total - 1, Math.max(0, index)));
  };

  const months = useMemo(() => {
    const out: DayKey[] = [];
    let cursor = `${view.start.slice(0, 7)}-01`;
    if (cursor < view.start) cursor = nextMonth(cursor);
    while (cursor <= view.end) {
      out.push(cursor);
      cursor = nextMonth(cursor);
    }
    return out;
  }, [view.end, view.start]);
  const monthPx = (inner / total) * 30.4;
  const reachesToday = view.end >= bounds.end;

  // Sideways swipes slide the view and pinch zooms it; plain vertical scroll
  // is left to the page. The listener is non-passive so it can hold the page still.
  const live = useRef({ view, onView, inner, bounds, blocks, hoverBlock });
  useEffect(() => {
    live.current = { view, onView, inner, bounds, blocks, hoverBlock };
  });
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    let carry = 0;
    const onWheel = (event: WheelEvent) => {
      const state = live.current;
      const length = rangeDays(state.view);
      let next: DateRange | null = null;
      const share = Math.min(1, Math.max(0, (event.clientX - node.getBoundingClientRect().left - PAD_X) / state.inner));
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const anchor = addDays(state.view.start, Math.round(share * (length - 1)));
        next = zoomView(state.view, Math.exp(Math.max(-40, Math.min(40, event.deltaY)) * 0.01), anchor, state.bounds);
      } else {
        const dx = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
        if (dx === 0 || Math.abs(dx) < Math.abs(event.deltaY)) return;
        event.preventDefault();
        carry += (dx / state.inner) * length;
        const days = Math.trunc(carry);
        if (days === 0) return;
        carry -= days;
        next = panView(state.view, days, state.bounds);
      }
      // Chain fast wheel events off this result rather than the last render.
      live.current = { ...state, view: next };
      state.onView(next);
      // The days under the pointer changed, and so may the block it lights.
      const under = addDays(next.start, Math.min(rangeDays(next) - 1, Math.floor(share * rangeDays(next))));
      state.hoverBlock(blockAt(state.blocks, under)?.id ?? null);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [wrapRef]);

  function localX(event: ReactPointerEvent<SVGSVGElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left;
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const px = localX(event);
    const handle = (event.target as Element).getAttribute("data-handle");
    if (handle && selection) {
      drag.current = { anchor: handle === "start" ? selection.end : selection.start, moved: true, startX: px };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const day = dayAt(px);
    const owner = blockAt(blocks, day);
    if (owner) {
      focusBlock(focusedBlockId === owner.id ? null : owner.id);
      return;
    }
    drag.current = { anchor: day, moved: false, startX: px };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const px = localX(event);
    setHoverX(px);
    const state = drag.current;
    if (!state) {
      const owner = blockAt(blocks, dayAt(px));
      if ((owner?.id ?? null) !== hoveredBlockId) hoverBlock(owner?.id ?? null);
      return;
    }
    if (!state.moved && Math.abs(px - state.startX) < 4) return;
    state.moved = true;
    const range = clampToGap(state.anchor, dayAt(px), blocks, bounds);
    if (range) setSelection(range);
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!state || state.moved) return;
    // A click on open days picks that calendar month, cut to the free gap.
    const gap = freeGapAt(state.anchor, blocks, bounds);
    if (!gap) return;
    const monthStart = `${state.anchor.slice(0, 7)}-01`;
    const monthEnd = new Date(Date.UTC(Number(state.anchor.slice(0, 4)), Number(state.anchor.slice(5, 7)), 0)).toISOString().slice(0, 10);
    setSelection({ start: monthStart < gap.start ? gap.start : monthStart, end: monthEnd > gap.end ? gap.end : monthEnd });
  }

  const hoverBin = hoverX == null ? null : (bins.find((bin) => x(bin.start) <= hoverX && xEnd(bin.end) > hoverX) ?? null);
  const markers = findings.filter((finding) => finding.check === "Unusual days" && finding.range && overlaps(finding.range, view));

  return (
    <div ref={wrapRef} className="relative select-none overscroll-x-contain" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          className="block cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            setHoverX(null);
            if (!dragging) hoverBlock(null);
          }}
          role="img"
          aria-label={`Net removal from ${formatDay(view.start)} to ${formatDay(view.end)}`}
        >
          <defs>
            <pattern id="ghost-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" fill="rgba(87,84,74,0.06)" />
              <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(87,84,74,0.45)" strokeWidth="1.2" />
            </pattern>
            <pattern id="gap-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="#DF7626" strokeWidth="1.4" />
            </pattern>
            {/* Blocks and bars that run past either edge of the view are cut there. */}
            <clipPath id={CLIP_ID}>
              <rect x={PAD_X} y={0} width={inner} height={height} />
            </clipPath>
          </defs>

          {/* Gridlines */}
          {[0.5, 1].map((share) => (
            <line
              key={share}
              x1={PAD_X}
              x2={width - PAD_X}
              y1={PLOT_TOP + PLOT_H * (1 - share)}
              y2={PLOT_TOP + PLOT_H * (1 - share)}
              stroke="rgba(87,84,74,0.12)"
              strokeDasharray="2 4"
            />
          ))}
          <text x={PAD_X} y={PLOT_TOP - 4} className="fill-mist text-[9px] tabular-nums">
            {formatTonnes(max / binSize)} t/day
          </text>

          <g clipPath={`url(#${CLIP_ID})`}>
            {/* Days claimed by blocks */}
            {shown.map((block) => {
              const tone = BLOCK_TONE[block.stage];
              const left = x(block.range.start);
              const w = Math.max(1, xEnd(block.range.end) - left);
              const lit = block.id === focusedBlockId || block.id === hoveredBlockId;
              // Centre the number on the part of the block that is on screen.
              const seenLeft = Math.max(left, PAD_X);
              const seenW = Math.min(left + w, width - PAD_X) - seenLeft;
              return (
                <g key={block.id}>
                  <rect x={left} y={PLOT_TOP} width={w} height={PLOT_H} fill={tone.band} opacity={lit ? 0.16 : 0.06} />
                  <rect x={left + 0.5} y={BAND_Y} width={Math.max(1, w - 1)} height={BAND_H} rx={2} fill={tone.band} opacity={lit ? 1 : 0.85} />
                  {seenW > 44 ? (
                    <text x={seenLeft + seenW / 2} y={BAND_Y + BAND_H - 2} textAnchor="middle" fill={tone.ink} className="pointer-events-none text-[8px] font-semibold">
                      #{block.sequence}
                    </text>
                  ) : null}
                  {block.id === focusedBlockId ? (
                    <rect x={left} y={PLOT_TOP - 2} width={w} height={PLOT_H + BAND_H + 10} fill="none" stroke="#070808" strokeWidth={1.25} rx={3} />
                  ) : null}
                </g>
              );
            })}

            {/* Bars */}
            {bins.map((bin) => {
              const left = x(bin.start);
              const full = xEnd(bin.end) - left;
              const w = full > 3 ? full - 1 : Math.max(0.6, full);
              const solidTop = y(bin.value);
              const ghostTop = y(bin.value + bin.ghost);
              const selected = selection && bin.start >= selection.start && bin.end <= selection.end;
              const color = selected ? PROPOSAL.stroke : bin.owner ? BLOCK_TONE[bin.owner.stage].band : "#57544A";
              return (
                <g key={bin.start}>
                  {bin.ghost > 0 ? <rect x={left} y={ghostTop} width={w} height={Math.max(0, solidTop - ghostTop)} fill="url(#ghost-hatch)" /> : null}
                  {bin.hasValue ? (
                    <rect x={left} y={solidTop} width={w} height={Math.max(0.5, PLOT_TOP + PLOT_H - solidTop)} fill={color} opacity={bin.owner || selected ? 0.9 : 0.55} />
                  ) : null}
                  {!bin.hasData ? <rect x={left} y={PLOT_TOP + PLOT_H - 4} width={Math.max(1, full)} height={4} fill="url(#gap-hatch)" /> : null}
                </g>
              );
            })}

            {/* Flagged days */}
            {markers.map((finding) => {
              const range = finding.range!;
              const cx = (x(range.start) + xEnd(range.end)) / 2;
              return <path key={finding.id} d={`M ${cx - 4} ${PLOT_TOP - 9} L ${cx + 4} ${PLOT_TOP - 9} L ${cx} ${PLOT_TOP - 3} Z`} fill="#B85616" />;
            })}

            {/* Selection */}
            {selection && overlaps(selection, view) ? (
              <g>
                <rect
                  x={x(selection.start)}
                  y={PLOT_TOP - 4}
                  width={Math.max(2, xEnd(selection.end) - x(selection.start))}
                  height={PLOT_H + BAND_H + 12}
                  fill={PROPOSAL.fill}
                  stroke={PROPOSAL.stroke}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  rx={3}
                />
                {(["start", "end"] as const).map((edge) => {
                  const hx = edge === "start" ? x(selection.start) : xEnd(selection.end);
                  return (
                    <rect
                      key={edge}
                      data-handle={edge}
                      x={hx - 3.5}
                      y={PLOT_TOP + PLOT_H / 2 - 11}
                      width={7}
                      height={22}
                      rx={3}
                      fill="#FFFFFF"
                      stroke={PROPOSAL.stroke}
                      strokeWidth={1.5}
                      className="cursor-ew-resize"
                    />
                  );
                })}
              </g>
            ) : null}
          </g>

          {/* Axis */}
          {months.map((month) => {
            const mx = x(month);
            const january = month.endsWith("-01-01");
            // Months too tight to tick on a long view; years always show.
            if (!january && monthPx < 4) return null;
            // Keep labels off the right edge, and clear of "Today" when it shows.
            const crowded = mx > width - PAD_X - (reachesToday ? 44 : 20);
            return (
              <g key={month}>
                <line x1={mx} x2={mx} y1={AXIS_Y - 3} y2={AXIS_Y + (january ? 7 : 3)} stroke={january ? "#070808" : "rgba(87,84,74,0.45)"} />
                {january ? (
                  <text x={mx + 3} y={AXIS_Y + 16} className="fill-frost text-[10px] font-semibold tabular-nums">
                    {month.slice(0, 4)}
                  </text>
                ) : monthPx > 30 && !crowded ? (
                  <text x={mx + 3} y={AXIS_Y + 12} className="fill-mist text-[9px]">
                    {monthPx > 40 ? monthLabel(month) : monthLabel(month)[0]}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line x1={PAD_X} x2={width - PAD_X} y1={AXIS_Y - 3} y2={AXIS_Y - 3} stroke="rgba(87,84,74,0.35)" />
          {reachesToday ? (
            <text x={width - PAD_X} y={AXIS_Y + 16} textAnchor="end" className="fill-mist text-[9px]">
              Today
            </text>
          ) : null}

          {hoverBin && !dragging ? (
            <line x1={hoverX ?? 0} x2={hoverX ?? 0} y1={PLOT_TOP - 4} y2={AXIS_Y - 3} stroke="rgba(7,8,8,0.35)" strokeDasharray="2 3" pointerEvents="none" />
          ) : null}
        </svg>
      ) : null}

      {selection && overlaps(selection, view) ? (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold whitespace-nowrap text-white shadow"
          style={{ left: Math.min(width - 60, Math.max(60, (x(selection.start) + xEnd(selection.end)) / 2)), background: PROPOSAL.stroke }}
        >
          {formatRange(selection)} · {rangeDays(selection)} d
        </div>
      ) : null}

      {hoverBin && hoverX != null && !dragging ? (
        <div
          className="pointer-events-none absolute z-10 rounded-lg bg-rock px-2.5 py-1.5 text-[10.5px] whitespace-nowrap text-white shadow-lg"
          style={{ left: Math.min(width - 150, Math.max(4, hoverX + 10)), top: PLOT_TOP }}
        >
          <p className="font-semibold">{binSize === 1 ? formatDay(hoverBin.start) : formatRange({ start: hoverBin.start, end: hoverBin.end })}</p>
          <p className="mt-0.5 tabular-nums opacity-90">
            {hoverBin.hasValue ? `${formatTonnes(hoverBin.value)} t net` : hoverBin.hasData ? "Net not calculable" : "No stream rows"}
            {hoverBin.ghost > 0 ? ` · ${formatTonnes(hoverBin.ghost)} t gross awaiting inputs` : ""}
          </p>
          <p className="mt-0.5 opacity-70">{hoverBin.owner ? `Block #${hoverBin.owner.sequence} · ${hoverBin.owner.label}` : "Unclaimed — drag to batch"}</p>
        </div>
      ) : null}
    </div>
  );
}
