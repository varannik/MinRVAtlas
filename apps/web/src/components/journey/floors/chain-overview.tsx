"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { addDays, monthLabel } from "@/lib/mrv/days";
import type { DateRange, DayKey } from "@/lib/mrv/types";
import { useElementSize } from "@/components/stage/use-element-size";
import { BLOCK_TONE } from "@/components/stage/theme";
import { BOX_SPAN, type ChainLayout, type TrendBin } from "./chain-layout";
import type { PeriodBox } from "./periods";

/**
 * The whole ledger in one thin strip, from the first day of monitoring to
 * today, with the part on screen framed. Drag the frame or click anywhere to
 * move the boxes and the trend there together.
 */

const PAD = 6;
const HEIGHT = 46;
const PLOT_TOP = 4;
const PLOT_H = 22;
const BAND_Y = PLOT_TOP + PLOT_H + 3;
const BAND_H = 5;
const FRAME_H = BAND_Y + BAND_H + 3;

function monthYear(day: DayKey): string {
  return `${monthLabel(day)} ${day.slice(0, 4)}`;
}

function ViewButton({ onClick, active, children }: { onClick: () => void; active: boolean; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-2.5 py-1 text-[10.5px] font-semibold ring-1 transition-colors ${
        active ? "bg-earth text-calcite ring-earth" : "text-strata-700 ring-earth/20 hover:bg-white/70 hover:text-earth"
      }`}
    >
      {children}
    </button>
  );
}

export function ChainOverview({
  scroller,
  layout,
  history,
  bins,
  max,
  boxes,
}: {
  scroller: RefObject<HTMLDivElement | null>;
  layout: ChainLayout;
  history: DateRange | null;
  bins: TrendBin[];
  max: number;
  boxes: PeriodBox[];
}) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const [seen, setSeen] = useState({ left: 0, visible: 0 });
  const drag = useRef<{ x: number; left: number } | null>(null);

  // Follow the scroller: what part of the chain is on screen.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const read = () =>
      setSeen((prev) => (prev.left === node.scrollLeft && prev.visible === node.clientWidth ? prev : { left: node.scrollLeft, visible: node.clientWidth }));
    node.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [scroller]);

  const inner = Math.max(1, width - PAD * 2);
  const scale = inner / Math.max(1, layout.width);
  const sx = (px: number) => PAD + px * scale;

  const area = useMemo(() => {
    if (!width || !bins.length) return "";
    const k = Math.max(1, width - PAD * 2) / Math.max(1, layout.width);
    const at = (day: DayKey) => (PAD + layout.x(day) * k).toFixed(1);
    const base = PLOT_TOP + PLOT_H;
    const top = (value: number) => (base - Math.min(1, value / max) * PLOT_H).toFixed(1);
    let d = `M ${at(bins[0].start)} ${base}`;
    for (const bin of bins) {
      const value = top(bin.perDay ?? 0);
      d += ` L ${at(bin.start)} ${value} L ${at(addDays(bin.end, 1))} ${value}`;
    }
    return `${d} L ${at(addDays(bins[bins.length - 1].end, 1))} ${base} Z`;
  }, [bins, layout, max, width]);

  const frameLeft = sx(seen.left);
  const frameWidth = Math.max(8, seen.visible * scale);
  const maxScroll = Math.max(0, layout.width - seen.visible);
  const atStart = seen.left <= 2;
  const atEnd = seen.left >= maxScroll - 2;

  const from = layout.dayAt(seen.left);
  const to = layout.dayAt(seen.left + seen.visible);
  const showsToday = history ? seen.left + seen.visible >= layout.x(addDays(history.end, 1)) : false;
  const inView = boxes.filter((box) => {
    const left = layout.left.get(box.id);
    return left != null && left + BOX_SPAN > seen.left && left < seen.left + seen.visible;
  }).length;

  const scrollTo = (left: number, smooth: boolean) =>
    scroller.current?.scrollTo({ left: Math.max(0, Math.min(maxScroll, left)), behavior: smooth ? "smooth" : "instant" });

  function localX(event: ReactPointerEvent<SVGSVGElement>): number {
    return event.clientX - event.currentTarget.getBoundingClientRect().left;
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const px = localX(event);
    let left = seen.left;
    if (px < frameLeft || px > frameLeft + frameWidth) {
      left = (px - PAD) / scale - seen.visible / 2;
      scrollTo(left, false);
      left = Math.max(0, Math.min(maxScroll, left));
    }
    drag.current = { x: px, left };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state) return;
    scrollTo(state.left + (localX(event) - state.x) / scale, false);
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className="flex items-center gap-4 border-t border-earth/10 px-5 py-2.5">
      <div className="w-[150px] shrink-0">
        <p className="text-[9.5px] font-semibold tracking-[0.14em] text-strata-700 uppercase">Showing</p>
        <p className="truncate text-[11.5px] font-semibold text-earth">
          {from && to ? `${monthYear(from)} – ${showsToday ? "today" : monthYear(to)}` : "—"}
        </p>
        <p className="text-[10px] text-strata-700 tabular-nums">
          {inView} of {boxes.length} period{boxes.length === 1 ? "" : "s"}
        </p>
      </div>
      <div ref={ref} className="min-w-0 flex-1 select-none" style={{ height: HEIGHT }}>
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            className="block cursor-pointer touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            role="slider"
            aria-label="Move through the ledger, from the first period to today"
            aria-valuemin={0}
            aria-valuemax={Math.round(maxScroll)}
            aria-valuenow={Math.round(seen.left)}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") scrollTo(seen.left - seen.visible * 0.5, true);
              else if (event.key === "ArrowRight") scrollTo(seen.left + seen.visible * 0.5, true);
              else if (event.key === "Home") scrollTo(0, true);
              else if (event.key === "End") scrollTo(maxScroll, true);
              else return;
              event.preventDefault();
            }}
          >
            <rect x={PAD} y={PLOT_TOP} width={inner} height={FRAME_H - PLOT_TOP} rx={4} fill="rgba(13,24,2,0.04)" />
            {area ? <path d={area} fill="rgba(87,84,74,0.45)" /> : null}
            {boxes.map((box) =>
              box.range ? (
                <rect
                  key={box.id}
                  x={sx(layout.x(box.range.start)) + 0.5}
                  y={BAND_Y}
                  width={Math.max(1, sx(layout.x(addDays(box.range.end, 1))) - sx(layout.x(box.range.start)) - 1)}
                  height={BAND_H}
                  rx={1}
                  fill={BLOCK_TONE[box.tone].band}
                  stroke={BLOCK_TONE[box.tone].side}
                  strokeOpacity={0.5}
                  strokeWidth={0.5}
                />
              ) : null,
            )}
            {/* Everything off screen recedes. */}
            <rect x={PAD} y={0} width={Math.max(0, frameLeft - PAD)} height={FRAME_H + 2} fill="rgba(241,240,240,0.6)" />
            <rect x={frameLeft + frameWidth} y={0} width={Math.max(0, width - PAD - frameLeft - frameWidth)} height={FRAME_H + 2} fill="rgba(241,240,240,0.6)" />
            <rect
              x={frameLeft}
              y={1}
              width={frameWidth}
              height={FRAME_H}
              rx={5}
              fill="rgba(13,24,2,0.03)"
              stroke="#0D1802"
              strokeOpacity={0.7}
              strokeWidth={1.25}
              className="cursor-grab"
            />
            {history ? (
              <>
                <text x={PAD} y={HEIGHT - 2} className="pointer-events-none fill-strata-700 text-[9px] tabular-nums">
                  {monthYear(history.start)}
                </text>
                <text x={sx(layout.x(addDays(history.end, 1)))} y={HEIGHT - 2} textAnchor="end" className="pointer-events-none fill-earth text-[9px] font-semibold">
                  Today
                </text>
              </>
            ) : null}
          </svg>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <ViewButton active={atStart} onClick={() => scrollTo(0, true)}>
          First
        </ViewButton>
        <ViewButton active={atEnd} onClick={() => scrollTo(maxScroll, true)}>
          Now
        </ViewButton>
      </div>
    </div>
  );
}
