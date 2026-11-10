import { addDays, diffDays, overlapDays, rangeDays } from "../days";
import type { DailyMetrics, DateRange, DayKey, FixedValue, MrvDataset } from "../types";
import type {
  CalcNode,
  CalcSpec,
  EquationNode,
  Evaluation,
  InputNode,
  NodeResult,
  SeriesAggregate,
} from "./types";

/** Lookup tables over a dataset, built once and reused for every window. */
export interface DatasetIndex {
  range: DateRange | null;
  days: DailyMetrics[];
  byDay: Map<DayKey, DailyMetrics>;
  fixed: Map<string, FixedValue[]>;
}

export function indexDataset(dataset: Pick<MrvDataset, "range" | "days" | "fixed">): DatasetIndex {
  const days = [...dataset.days].sort((a, b) => a.day.localeCompare(b.day));
  const fixed = new Map<string, FixedValue[]>();
  for (const row of dataset.fixed) {
    const list = fixed.get(row.key) ?? [];
    list.push(row);
    fixed.set(row.key, list);
  }
  return {
    range: dataset.range,
    days,
    byDay: new Map(days.map((row) => [row.day, row])),
    fixed,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** First index in `days` at or after `day`. */
function lowerBound(days: DailyMetrics[], day: DayKey): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].day < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Day rows inside a window, in order. */
export function daysIn(index: DatasetIndex, range: DateRange): DailyMetrics[] {
  if (rangeDays(range) === 1) {
    const row = index.byDay.get(range.start);
    return row ? [row] : [];
  }
  const out: DailyMetrics[] = [];
  for (let i = lowerBound(index.days, range.start); i < index.days.length; i += 1) {
    const row = index.days[i];
    if (row.day > range.end) break;
    out.push(row);
  }
  return out;
}

function fold(rows: DailyMetrics[], metric: string, aggregate: SeriesAggregate): { value: number; present: number } | null {
  let present = 0;
  let sum = 0;
  let weighted = 0;
  let weight = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let last = Number.NaN;
  for (const row of rows) {
    const cell = row.metrics[metric];
    if (!cell || cell.count === 0) continue;
    present += 1;
    sum += cell.sum;
    weighted += cell.mean * cell.count;
    weight += cell.count;
    min = Math.min(min, cell.min);
    max = Math.max(max, cell.max);
    last = cell.last;
  }
  if (present === 0) return null;
  const value =
    aggregate === "sum"
      ? sum
      : aggregate === "mean"
        ? weighted / Math.max(weight, 1)
        : aggregate === "max"
          ? max
          : aggregate === "min"
            ? min
            : last;
  return { value, present };
}

function validity(row: FixedValue, fallback: DateRange | null): DateRange | null {
  const start = row.validFrom ?? fallback?.start;
  const end = row.validTo ?? fallback?.end;
  if (!start || !end) return null;
  return { start, end };
}

function evaluateInput(node: InputNode, index: DatasetIndex, range: DateRange): NodeResult {
  const source = node.source;
  const span = rangeDays(range);

  if (source.type === "constant") {
    return { value: source.value, status: "ok", coverage: 1, missing: [], partial: [], detail: source.origin };
  }

  if (source.type === "duration") {
    const value = source.unit === "h" ? span * 24 : span;
    return { value, status: "ok", coverage: 1, missing: [], partial: [], detail: plural(span, "day") };
  }

  if (source.type === "series") {
    // Measured against the days the stream reported at all. Whole-day outages
    // are one window-level finding (checks.ts), not a gap in every input.
    const rows = daysIn(index, range);
    const folded = fold(rows, source.metric, source.aggregate);
    if (!folded) {
      return { value: null, status: "missing", coverage: 0, missing: [node.id], partial: [], detail: `No ${source.metric} rows` };
    }
    const coverage = folded.present / rows.length;
    const partial = folded.present < rows.length;
    return {
      value: folded.value * (source.scale ?? 1),
      status: partial ? "partial" : "ok",
      coverage,
      missing: [],
      partial: partial ? [node.id] : [],
      detail: `${folded.present} of ${plural(rows.length, "stream day")}`,
    };
  }

  const rows = index.fixed.get(source.key) ?? [];
  let covered = 0;
  let total = 0;
  let weighted = 0;
  let best: FixedValue | null = null;
  for (const row of rows) {
    const window = validity(row, index.range);
    if (!window) continue;
    const days = overlapDays(range, window);
    if (days === 0) continue;
    covered += days;
    if (source.scaling === "prorata") {
      total += row.value * (days / rangeDays(window));
    } else {
      weighted += row.value * days;
    }
    if (!best || (row.validFrom ?? "") > (best.validFrom ?? "")) best = row;
  }
  if (covered === 0 || !best) {
    return { value: null, status: "missing", coverage: 0, missing: [node.id], partial: [], detail: `No ${source.key} for this window` };
  }
  const coverage = Math.min(1, covered / span);
  const raw = source.scaling === "prorata" ? total : weighted / covered;
  const partial = coverage < 1;
  return {
    value: raw * (source.scale ?? 1),
    status: partial ? "partial" : "ok",
    coverage,
    missing: [],
    partial: partial ? [node.id] : [],
    detail: best.source,
  };
}

function combine(node: EquationNode, results: NodeResult[]): NodeResult {
  const missing = results.flatMap((row) => row.missing);
  const partial = results.flatMap((row) => row.partial);
  const coverage = results.reduce((low, row) => Math.min(low, row.coverage), 1);
  if (results.some((row) => row.value == null)) {
    return { value: null, status: "missing", coverage, missing, partial };
  }
  const values = results.map((row) => row.value as number);
  let value: number | null;
  switch (node.op) {
    case "sum":
      value = values.reduce((total, next) => total + next, 0);
      break;
    case "difference":
      value = values.slice(1).reduce((total, next) => total - next, values[0] ?? 0);
      break;
    case "product":
      value = values.reduce((total, next) => total * next, 1);
      break;
    case "quotient":
      value = values[1] ? values[0] / values[1] : null;
      break;
  }
  if (value == null || !Number.isFinite(value)) {
    return { value: null, status: "missing", coverage, missing, partial, detail: "Division by zero" };
  }
  return { value, status: partial.length ? "partial" : "ok", coverage, missing, partial };
}

function evaluateNode(node: CalcNode, index: DatasetIndex, range: DateRange, out: Map<string, NodeResult>): NodeResult {
  const result =
    node.kind === "input"
      ? evaluateInput(node, index, range)
      : combine(node, node.children.map((child) => evaluateNode(child, index, range, out)));
  out.set(node.id, result);
  return result;
}

/** Share of a window's days that have any stream rows, 0–1. */
export function streamCoverage(index: DatasetIndex, range: DateRange): number {
  return daysIn(index, range).length / rangeDays(range);
}

/** Evaluate the whole tree over one window. */
export function evaluate(spec: CalcSpec, index: DatasetIndex, range: DateRange): Evaluation {
  const byId = new Map<string, NodeResult>();
  const root = evaluateNode(spec.root, index, range, byId);
  return { root, byId };
}

export interface DailyPoint {
  day: DayKey;
  /** Credited quantity for the day, or null when inputs are missing. */
  value: number | null;
  /** Proxy value (e.g. gross stored) when the root cannot be calculated. */
  proxy: number | null;
  status: NodeResult["status"];
  /** The day has at least one stream row. */
  hasData: boolean;
}

/** Root value for every day in a range, for the timeline. */
export function dailySeries(spec: CalcSpec, index: DatasetIndex, range: DateRange): DailyPoint[] {
  const points: DailyPoint[] = [];
  const total = diffDays(range.start, range.end);
  for (let i = 0; i <= total; i += 1) {
    const day = addDays(range.start, i);
    const window = { start: day, end: day };
    const { root, byId } = evaluate(spec, index, window);
    const proxy = spec.proxyId ? (byId.get(spec.proxyId)?.value ?? null) : null;
    points.push({
      day,
      value: root.value,
      proxy,
      status: root.status,
      hasData: index.byDay.has(day),
    });
  }
  return points;
}

/** Daily values of one series input inside a window, for sparklines. */
export function seriesValues(
  index: DatasetIndex,
  metric: string,
  aggregate: SeriesAggregate,
  range: DateRange,
  scale = 1,
): { day: DayKey; value: number | null }[] {
  const out: { day: DayKey; value: number | null }[] = [];
  const total = diffDays(range.start, range.end);
  for (let i = 0; i <= total; i += 1) {
    const day = addDays(range.start, i);
    const row = index.byDay.get(day);
    const cell = row?.metrics[metric];
    if (!cell || cell.count === 0) {
      out.push({ day, value: null });
      continue;
    }
    const value =
      aggregate === "sum" ? cell.sum : aggregate === "mean" ? cell.mean : aggregate === "max" ? cell.max : aggregate === "min" ? cell.min : cell.last;
    out.push({ day, value: value * scale });
  }
  return out;
}

/** Fixed values of one key that touch a window, newest first. */
export function fixedRowsFor(index: DatasetIndex, key: string, range: DateRange): FixedValue[] {
  return (index.fixed.get(key) ?? [])
    .filter((row) => {
      const window = validity(row, index.range);
      return window ? overlapDays(range, window) > 0 : false;
    })
    .sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""));
}
