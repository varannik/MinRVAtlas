import { blockAt } from "@/lib/mrv/blocks";
import type { DailyPoint } from "@/lib/mrv/calc/evaluate";
import type { DayKey, LedgerBlock } from "@/lib/mrv/types";

/**
 * Days grouped `size` at a time, counted from the first day of the history,
 * so the bars stay put while the view slides over them.
 */
export interface Bin {
  start: DayKey;
  end: DayKey;
  value: number;
  /** Proxy (gross) for days whose net cannot be calculated yet. */
  ghost: number;
  hasValue: boolean;
  hasData: boolean;
  owner: LedgerBlock | null;
}

export function buildBins(daily: DailyPoint[], size: number, blocks: LedgerBlock[]): Bin[] {
  const bins: Bin[] = [];
  for (let i = 0; i < daily.length; i += size) {
    const slice = daily.slice(i, i + size);
    let value = 0;
    let ghost = 0;
    let hasValue = false;
    let hasData = false;
    for (const point of slice) {
      hasData ||= point.hasData;
      if (point.value != null) {
        value += Math.max(0, point.value);
        hasValue = true;
      } else if (point.proxy != null) {
        ghost += Math.max(0, point.proxy);
      }
    }
    const start = slice[0].day;
    const end = slice[slice.length - 1].day;
    const mid = slice[Math.floor(slice.length / 2)].day;
    bins.push({ start, end, value, ghost, hasValue, hasData, owner: blockAt(blocks, mid) });
  }
  return bins;
}

/**
 * Top of the bar scale: net removal, ignoring the odd spike. Taken over the
 * whole history, so the scale holds still while the view slides.
 */
export function netScale(bins: Bin[]): number {
  const net = bins.filter((bin) => bin.hasValue).map((bin) => bin.value).sort((a, b) => a - b);
  const top = net.length ? net[Math.floor((net.length - 1) * 0.98)] : Math.max(0, ...bins.map((bin) => bin.ghost));
  return Math.max(1, top) * 1.25;
}
