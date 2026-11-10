import { addDays, diffDays, overlaps, rangeDays } from "./days";
import type { DateRange, DayKey, LedgerBlock } from "./types";

/**
 * The stretch of history the ledger shows at once. The block chain and the
 * net-removal timeline share one view, so they always show the same blocks.
 * It opens on the latest blocks and pages back through older ones, however
 * long the history grows.
 */

/** How many blocks the ledger opens on. */
export const LATEST_BLOCKS = 6;
/** Shortest view, so zooming never shrinks it to a sliver. */
export const MIN_VIEW_DAYS = 14;

function byStart(blocks: LedgerBlock[]): LedgerBlock[] {
  return [...blocks].sort((a, b) => a.range.start.localeCompare(b.range.start));
}

export function sameRange(a: DateRange | null, b: DateRange | null): boolean {
  return a?.start === b?.start && a?.end === b?.end;
}

/** Slide a view back inside `bounds`, keeping its length rather than squashing it. */
export function clampView(view: DateRange, bounds: DateRange): DateRange {
  const length = Math.min(rangeDays(bounds), Math.max(MIN_VIEW_DAYS, rangeDays(view)));
  let start = view.start < bounds.start ? bounds.start : view.start;
  let end = addDays(start, length - 1);
  if (end > bounds.end) {
    end = bounds.end;
    start = addDays(end, 1 - length);
  }
  return { start, end };
}

/** The newest `count` blocks and the open days after them, up to the last day of data. */
export function latestView(blocks: LedgerBlock[], bounds: DateRange, count = LATEST_BLOCKS): DateRange {
  const sorted = byStart(blocks);
  if (sorted.length <= count) return bounds;
  return clampView({ start: sorted[sorted.length - count].range.start, end: bounds.end }, bounds);
}

/** The blocks a view shows, and how many lie wholly before and after it. */
export function viewBlocks(blocks: LedgerBlock[], view: DateRange): { visible: LedgerBlock[]; earlier: number; later: number } {
  const sorted = byStart(blocks);
  return {
    visible: sorted.filter((block) => overlaps(block.range, view)),
    earlier: sorted.filter((block) => block.range.end < view.start).length,
    later: sorted.filter((block) => block.range.start > view.end).length,
  };
}

/** Slide the least distance that shows all of `range`; zoom out only if it is longer than the view. */
export function revealRange(view: DateRange, range: DateRange, bounds: DateRange): DateRange {
  if (range.start >= view.start && range.end <= view.end) return view;
  const length = rangeDays(view);
  const margin = Math.round(length * 0.06);
  if (rangeDays(range) + margin * 2 > length) {
    const pad = Math.round(rangeDays(range) * 0.08);
    return clampView({ start: addDays(range.start, -pad), end: addDays(range.end, pad) }, bounds);
  }
  if (range.start < view.start) {
    const start = addDays(range.start, -margin);
    return clampView({ start, end: addDays(start, length - 1) }, bounds);
  }
  const end = addDays(range.end, margin);
  return clampView({ start: addDays(end, 1 - length), end }, bounds);
}

export function panView(view: DateRange, days: number, bounds: DateRange): DateRange {
  return clampView({ start: addDays(view.start, days), end: addDays(view.end, days) }, bounds);
}

/** Lengthen (factor > 1) or shorten the view, keeping `anchor` at the same place on screen. */
export function zoomView(view: DateRange, factor: number, anchor: DayKey, bounds: DateRange): DateRange {
  const length = rangeDays(view);
  let next = Math.round(length * factor);
  if (next === length && factor !== 1) next += factor > 1 ? 1 : -1;
  next = Math.min(rangeDays(bounds), Math.max(MIN_VIEW_DAYS, next));
  const share = diffDays(view.start, anchor) / length;
  const start = addDays(anchor, -Math.round(share * next));
  return clampView({ start, end: addDays(start, next - 1) }, bounds);
}

/**
 * The `count` blocks before the view, through to the day before it; all the
 * way back to the first day once few are left. With no block left, the days
 * before it.
 */
export function olderView(view: DateRange, blocks: LedgerBlock[], bounds: DateRange, count = LATEST_BLOCKS): DateRange | null {
  if (view.start <= bounds.start) return null;
  const before = byStart(blocks).filter((block) => block.range.end < view.start);
  if (before.length === 0) return panView(view, -rangeDays(view), bounds);
  const start = before.length > count ? before[before.length - count].range.start : bounds.start;
  return clampView({ start, end: addDays(view.start, -1) }, bounds);
}

/** The `count` blocks after the view; the latest view once few are left. */
export function newerView(view: DateRange, blocks: LedgerBlock[], bounds: DateRange, count = LATEST_BLOCKS): DateRange | null {
  if (view.end >= bounds.end) return null;
  const after = byStart(blocks).filter((block) => block.range.start > view.end);
  if (after.length <= count) return latestView(blocks, bounds, count);
  return clampView({ start: addDays(view.end, 1), end: after[count - 1].range.end }, bounds);
}
