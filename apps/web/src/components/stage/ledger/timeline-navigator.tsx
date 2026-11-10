"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DailyPoint } from "@/lib/mrv/calc/evaluate";
import { addDays, diffDays, rangeDays } from "@/lib/mrv/days";
import { clampView, MIN_VIEW_DAYS, panView } from "@/lib/mrv/ledger-view";
import type { DateRange, DayKey, LedgerBlock } from "@/lib/mrv/types";
import { BLOCK_TONE, PROPOSAL } from "../theme";
import { useElementSize } from "../use-element-size";
import { buildBins, netScale } from "./timeline-bins";

/**
 * The whole history in one thin strip, with the ledger's view framed on it.
 * Drag the frame to slide through time, drag its edges to change how much
 * shows, or click anywhere to jump there.
 */

const PAD = 6;
const HEIGHT = 50;
const PLOT_TOP = 4;
const PLOT_H = 24;
const BAND_Y = PLOT_TOP + PLOT_H + 2;
const BAND_H = 4;
const FRAME_H = BAND_Y + BAND_H + 2;
const LABEL_Y = HEIGHT - 3;

type DragMode = "move" | "start" | "end";

export function TimelineNavigator({
  daily,
  blocks,
  bounds,
  view,
  selection,
  onView,
}: {
  daily: DailyPoint[];
  blocks: LedgerBlock[];
  bounds: DateRange;
  view: DateRange;
  selection: DateRange | null;
  onView: (view: DateRange) => void;
}) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const drag = useRef<{ mode: DragMode; px: number; view: DateRange } | null>(null);
  const [dragging, setDragging] = useState<DragMode | null>(null);

  const total = rangeDays(bounds);
  const inner = Math.max(1, width - PAD * 2);
  const binSize = Math.max(1, Math.ceil(total / Math.max(1, inner / 2)));
  const bins = useMemo(() => buildBins(daily, binSize, blocks), [binSize, blocks, daily]);
  const max = useMemo(() => netScale(bins), [bins]);

  const x = (day: DayKey) => PAD + (diffDays(bounds.start, day) / total) * inner;
  const xEnd = (day: DayKey) => x(addDays(day, 1));
  const dayAt = (px: number): DayKey => addDays(bounds.start, Math.min(total - 1, Math.max(0, Math.floor(((px - PAD) / inner) * total))));

  // Net removal as a stepped area, and gross awaiting inputs faintly above it.
  const areas = useMemo(() => {
    if (width === 0) return { net: "", gross: "" };
    const base = PLOT_TOP + PLOT_H;
    const sx = (day: DayKey) => PAD + (diffDays(bounds.start, day) / total) * inner;
    const sy = (value: number) => base - Math.min(1, value / max) * PLOT_H;
    let net = `M ${PAD} ${base}`;
    let gross = `M ${PAD} ${base}`;
    for (const bin of bins) {
      const left = sx(bin.start).toFixed(1);
      const right = sx(addDays(bin.end, 1)).toFixed(1);
      const top = sy(bin.value).toFixed(1);
      const ghost = sy(bin.value + bin.ghost).toFixed(1);
      net += ` L ${left} ${top} L ${right} ${top}`;
      gross += ` L ${left} ${ghost} L ${right} ${ghost}`;
    }
    return { net: `${net} L ${width - PAD} ${base} Z`, gross: `${gross} L ${width - PAD} ${base} Z` };
  }, [bins, bounds.start, inner, max, total, width]);

  const years = useMemo(() => {
    const out: DayKey[] = [];
    for (let year = Number(bounds.start.slice(0, 4)) + 1; year <= Number(bounds.end.slice(0, 4)); year += 1) out.push(`${year}-01-01`);
    return out;
  }, [bounds.end, bounds.start]);

  function localX(event: ReactPointerEvent<SVGSVGElement>): number {
    return event.clientX - event.currentTarget.getBoundingClientRect().left;
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const px = localX(event);
    const handle = (event.target as Element).getAttribute("data-handle") as DragMode | null;
    let start = view;
    let mode: DragMode = handle ?? "move";
    if (!handle && (px < x(view.start) || px > xEnd(view.end))) {
      // Jump: centre the view on the clicked day, then keep dragging it from there.
      const length = rangeDays(view);
      const first = addDays(dayAt(px), -Math.floor(length / 2));
      start = clampView({ start: first, end: addDays(first, length - 1) }, bounds);
      mode = "move";
      onView(start);
    }
    drag.current = { mode, px, view: start };
    setDragging(mode);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state) return;
    const days = Math.round(((localX(event) - state.px) / inner) * total);
    const from = state.view;
    if (state.mode === "move") {
      onView(panView(from, days, bounds));
    } else if (state.mode === "start") {
      const latest = addDays(from.end, 1 - MIN_VIEW_DAYS);
      const next = addDays(from.start, days);
      onView({ start: next < bounds.start ? bounds.start : next > latest ? latest : next, end: from.end });
    } else {
      const earliest = addDays(from.start, MIN_VIEW_DAYS - 1);
      const next = addDays(from.end, days);
      onView({ start: from.start, end: next > bounds.end ? bounds.end : next < earliest ? earliest : next });
    }
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    drag.current = null;
    setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const left = x(view.start);
  const right = xEnd(view.end);

  return (
    <div ref={ref} className="min-w-0 flex-1 select-none" style={{ height: HEIGHT }}>
      {width > 0 ? (
        <svg
          width={width}
          height={HEIGHT}
          className={`block touch-none ${dragging === "move" ? "cursor-grabbing" : "cursor-pointer"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="slider"
          aria-label="Ledger view across the whole history"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={diffDays(bounds.start, view.start)}
        >
          <rect x={PAD} y={PLOT_TOP} width={inner} height={FRAME_H - PLOT_TOP} rx={4} fill="rgba(87,84,74,0.05)" />
          <path d={areas.gross} fill="rgba(87,84,74,0.12)" />
          <path d={areas.net} fill="rgba(87,84,74,0.42)" />

          {/* Blocks, by stage, and the proposed window. */}
          {blocks.map((block) => (
            <rect
              key={block.id}
              x={x(block.range.start) + 0.5}
              y={BAND_Y}
              width={Math.max(1, xEnd(block.range.end) - x(block.range.start) - 1)}
              height={BAND_H}
              rx={1}
              fill={BLOCK_TONE[block.stage].band}
            />
          ))}
          {selection ? (
            <rect x={x(selection.start)} y={BAND_Y - 1} width={Math.max(2, xEnd(selection.end) - x(selection.start))} height={BAND_H + 2} rx={1.5} fill={PROPOSAL.stroke} />
          ) : null}

          {/* Everything outside the view recedes. */}
          <rect x={PAD} y={0} width={Math.max(0, left - PAD)} height={FRAME_H + 2} fill="rgba(255,255,255,0.62)" />
          <rect x={right} y={0} width={Math.max(0, width - PAD - right)} height={FRAME_H + 2} fill="rgba(255,255,255,0.62)" />

          <rect
            x={left}
            y={1}
            width={Math.max(4, right - left)}
            height={FRAME_H}
            rx={5}
            fill="rgba(7,8,8,0.03)"
            stroke="rgba(7,8,8,0.6)"
            strokeWidth={1.25}
            className={dragging === "move" ? "cursor-grabbing" : "cursor-grab"}
          />
          {(["start", "end"] as const).map((edge) => {
            const hx = edge === "start" ? left : right;
            return (
              <g key={edge}>
                {/* Wide invisible grip, narrow visible handle. */}
                <rect data-handle={edge} x={hx - 6} y={0} width={12} height={FRAME_H + 2} fill="transparent" className="cursor-ew-resize" />
                <rect data-handle={edge} x={hx - 3} y={FRAME_H / 2 - 8} width={6} height={16} rx={2.5} fill="#FFFFFF" stroke="rgba(7,8,8,0.6)" strokeWidth={1.25} className="cursor-ew-resize" />
              </g>
            );
          })}

          {years.map((year) => {
            const yx = x(year);
            return (
              <g key={year} pointerEvents="none">
                <line x1={yx} x2={yx} y1={FRAME_H + 1} y2={FRAME_H + 5} stroke="rgba(87,84,74,0.5)" />
                <text x={yx + 3} y={LABEL_Y} className="fill-mist text-[9px] tabular-nums">
                  {year.slice(0, 4)}
                </text>
              </g>
            );
          })}
          {years.length === 0 || x(years[0]) - PAD > 34 ? (
            <text x={PAD} y={LABEL_Y} className="pointer-events-none fill-mist text-[9px] tabular-nums">
              {bounds.start.slice(0, 4)}
            </text>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}
