import type { DailyPoint } from "@/lib/mrv/calc/evaluate";
import { addDays, contains, diffDays, rangeDays } from "@/lib/mrv/days";
import type { DateRange, DayKey } from "@/lib/mrv/types";

/**
 * Where the ledger floor draws things: the period boxes in a row, and under
 * them the CO₂ removal trend on one time axis, from the first day of
 * monitoring to today. Both scroll together. The axis is scaled so a typical
 * period is about one box wide, and each box sits as near as it can over the
 * days it covers without overlapping its neighbours.
 */

/** A box's front face, its extruded depth, and the room it takes in the row. */
export const BOX_FACE = 180;
export const BOX_FACE_H = 196;
export const BOX_DEPTH = 12;
export const BOX_SPAN = BOX_FACE + BOX_DEPTH;
export const BOX_GAP = 18;
/** Room either side of everything that scrolls. */
export const CHAIN_PAD = 28;

const SLOT = BOX_SPAN + BOX_GAP;
const MIN_PX_PER_DAY = 0.4;
const MAX_PX_PER_DAY = 10;

export interface Placeable {
  id: string;
  range: DateRange | null;
}

export interface ChainLayout {
  /** Days on the axis: the whole history, and any period that runs past it. */
  domain: DateRange | null;
  pxPerDay: number;
  /** Width of everything that scrolls. */
  width: number;
  /** Where the axis starts and where its last day ends. */
  axisLeft: number;
  axisRight: number;
  /** Left edge of each box, by id. */
  left: Map<string, number>;
  /** Box ids, left to right. */
  order: string[];
  /** Left edge of a day on the axis. */
  x: (day: DayKey) => number;
  /** The day under a point on the axis, kept inside the domain. */
  dayAt: (px: number) => DayKey | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Left edges for boxes that would each like to sit at `ideal`, in order,
 * at least one slot apart and never left of `min`. Boxes that collide share
 * the displacement: each run of touching boxes centres on its ideals.
 */
export function spread(ideals: number[], min: number, slot = SLOT): number[] {
  interface Run {
    first: number;
    count: number;
    /** Sum of each member's ideal less its offset in the run. */
    sum: number;
  }
  const runs: Run[] = [];
  const at = (run: Run, isFirst: boolean) => {
    const mean = run.sum / run.count;
    return isFirst ? Math.max(min, mean) : mean;
  };
  ideals.forEach((ideal, index) => {
    let run: Run = { first: index, count: 1, sum: ideal };
    while (runs.length) {
      const prev = runs[runs.length - 1];
      if (at(prev, runs.length === 1) + prev.count * slot <= at(run, false)) break;
      runs.pop();
      run = { first: prev.first, count: prev.count + run.count, sum: prev.sum + run.sum - run.count * prev.count * slot };
    }
    runs.push(run);
  });
  const out: number[] = [];
  runs.forEach((run, index) => {
    const left = at(run, index === 0);
    for (let k = 0; k < run.count; k += 1) out.push(left + k * slot);
  });
  return out;
}

export function chainLayout(boxes: Placeable[], history: DateRange | null, viewport: number): ChainLayout {
  let domain: DateRange | null = history ? { ...history } : null;
  for (const box of boxes) {
    if (!box.range) continue;
    if (!domain) domain = { ...box.range };
    else {
      if (box.range.start < domain.start) domain.start = box.range.start;
      if (box.range.end > domain.end) domain.end = box.range.end;
    }
  }
  const days = domain ? rangeDays(domain) : 0;
  const typical = median(boxes.filter((box) => box.range).map((box) => rangeDays(box.range!))) ?? 30;
  let pxPerDay = Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, SLOT / typical));
  if (days > 0) pxPerDay = Math.max(pxPerDay, (viewport - CHAIN_PAD * 2) / days);

  const start = domain?.start ?? null;
  const x = (day: DayKey) => (start ? CHAIN_PAD + diffDays(start, day) * pxPerDay : CHAIN_PAD);
  const axisRight = domain ? x(addDays(domain.end, 1)) : CHAIN_PAD;

  // Each box over the middle of its days; a box without dates queues after today.
  let tail = domain ? axisRight + BOX_GAP : CHAIN_PAD;
  const wanted = boxes.map((box, index) => {
    if (box.range) return { id: box.id, index, ideal: (x(box.range.start) + x(addDays(box.range.end, 1))) / 2 - BOX_SPAN / 2 };
    const ideal = tail;
    tail += SLOT;
    return { id: box.id, index, ideal };
  });
  wanted.sort((a, b) => a.ideal - b.ideal || a.index - b.index);
  const lefts = spread(
    wanted.map((entry) => entry.ideal),
    CHAIN_PAD,
  );
  const left = new Map(wanted.map((entry, index) => [entry.id, lefts[index]]));
  const lastRight = lefts.length ? lefts[lefts.length - 1] + BOX_SPAN : 0;

  return {
    domain,
    pxPerDay,
    width: Math.ceil(Math.max(axisRight + CHAIN_PAD, lastRight + CHAIN_PAD, viewport)),
    axisLeft: CHAIN_PAD,
    axisRight,
    left,
    order: wanted.map((entry) => entry.id),
    x,
    dayAt: (px) => {
      if (!domain || !start) return null;
      const index = Math.floor((px - CHAIN_PAD) / pxPerDay);
      return addDays(start, Math.min(days - 1, Math.max(0, index)));
    },
  };
}

/** The box whose dates hold `day`. */
export function boxAt<T extends Placeable>(boxes: T[], day: DayKey): T | null {
  return boxes.find((box) => box.range && contains(box.range, day)) ?? null;
}

export interface TrendBin {
  start: DayKey;
  end: DayKey;
  /** Mean net removal per day over the days that have a value; null when none do. */
  perDay: number | null;
  /** Mean gross (proxy) per day where the net cannot be calculated yet. */
  ghostPerDay: number;
  /** Some day in the bin has stream rows. */
  hasData: boolean;
}

/** Days to a bar: a day, a week, a fortnight or four weeks, whichever keeps bars readable. */
export function trendBinDays(pxPerDay: number): number {
  return [1, 7, 14, 28].find((size) => size * pxPerDay >= 7) ?? 28;
}

/**
 * Days grouped `size` at a time from the first day of the history. Each bar
 * is a daily mean, so a short bin at the end of the history or a few days
 * without a value do not read as a drop in removal.
 */
export function trendBins(daily: DailyPoint[], size: number): TrendBin[] {
  const bins: TrendBin[] = [];
  for (let i = 0; i < daily.length; i += size) {
    const slice = daily.slice(i, i + size);
    let sum = 0;
    let valued = 0;
    let ghost = 0;
    let ghosted = 0;
    let hasData = false;
    for (const point of slice) {
      hasData ||= point.hasData;
      if (point.value != null) {
        sum += Math.max(0, point.value);
        valued += 1;
      } else if (point.proxy != null) {
        ghost += Math.max(0, point.proxy);
        ghosted += 1;
      }
    }
    bins.push({
      start: slice[0].day,
      end: slice[slice.length - 1].day,
      perDay: valued ? sum / valued : null,
      ghostPerDay: ghosted ? ghost / ghosted : 0,
      hasData,
    });
  }
  return bins;
}

/** Top of the trend's scale: the bars, ignoring the odd spike, with headroom. */
export function trendScale(bins: TrendBin[]): number {
  const values = bins.map((bin) => bin.perDay).filter((value): value is number => value != null);
  const pool = values.length ? values : bins.map((bin) => bin.ghostPerDay);
  const sorted = [...pool].sort((a, b) => a - b);
  const top = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.98)] : 0;
  return Math.max(1e-6, top) * 1.2;
}

/** Bars in the running average: about four weeks, and never fewer than three. */
export function averageWindow(binDays: number): number {
  return Math.max(3, Math.round(28 / binDays));
}

/**
 * A centred running mean over `window` bins. It breaks wherever a bin has no
 * value, so the line never bridges a gap in the data.
 */
export function runningMean(values: (number | null)[], window: number): (number | null)[] {
  const before = Math.floor((window - 1) / 2);
  const after = window - 1 - before;
  return values.map((value, index) => {
    if (value == null) return null;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, index - before); j <= Math.min(values.length - 1, index + after); j += 1) {
      const other = values[j];
      if (other == null) continue;
      sum += other;
      count += 1;
    }
    return count ? sum / count : null;
  });
}
