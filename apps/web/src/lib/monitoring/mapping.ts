import { monitoringMetric, type Reads } from "./metrics";
import type { SourceTable } from "./table";

/**
 * A project's tag map: which stream metric each column of its site's spreadsheets
 * is, how the column reads and the factor into the metric's unit. Operators
 * propose it; a platform admin approves it before data is loaded with it, since
 * a wrong line changes the credited number.
 *
 * Pure: applying a map to the dated tables gives each day's stream rows, with
 * notes on everything that was left out.
 */

export interface ColumnMap {
  metric: string;
  reads: Reads;
  /** Multiplies the column's numbers into the metric's unit (0.001 for kg to t). */
  scale: number;
}

/** Column key (lower-case header) to its mapping; null means the column is not loaded. */
export type MapEntries = Record<string, ColumnMap | null>;

export interface TagMap {
  entries: MapEntries;
  status: "proposed" | "approved";
  version: number;
  proposedBy?: string;
  proposedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface StreamRow {
  metric: string;
  value: number;
  unit: string;
}

export interface Applied {
  /** Day to its rows, one per metric. */
  days: Record<string, StreamRow[]>;
  metrics: string[];
  /** Per metric: days with a value, first and last day, and the total or mean. */
  summary: { metric: string; days: number; first: string; last: string; total: number; reads: Reads }[];
  notes: string[];
}

function round(value: number): number {
  return Number(value.toPrecision(12));
}

/** Entries that name a metric the page knows and a factor that is a positive number. */
export function cleanEntries(raw: unknown): MapEntries {
  const out: MapEntries = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || key.length > 300) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    const entry = value as Partial<ColumnMap>;
    const metric = typeof entry.metric === "string" ? monitoringMetric(entry.metric) : undefined;
    const reads = entry.reads === "daily_total" || entry.reads === "totaliser" || entry.reads === "reading" ? entry.reads : null;
    const scale = typeof entry.scale === "number" && Number.isFinite(entry.scale) && entry.scale > 0 ? entry.scale : null;
    if (metric && reads && scale) out[key] = { metric: metric.id, reads, scale };
  }
  return out;
}

/** True when every column the upload loads has the same mapping in the approved map. */
export function approvedFor(map: TagMap | null, wanted: MapEntries): boolean {
  if (!map || map.status !== "approved") return false;
  return Object.entries(wanted).every(([key, entry]) => {
    const approved = map.entries[key];
    if (!entry) return true;
    return Boolean(approved && approved.metric === entry.metric && approved.reads === entry.reads && approved.scale === entry.scale);
  });
}

/**
 * Each day's rows from the tables, the columns' mappings and the days to load.
 * Columns mapped to one metric are added together (FT-04 and FT-05 make the CO₂
 * injected); a totaliser gives the difference from the day before; a reading is
 * averaged over the day.
 */
export function applyMapping(tables: SourceTable[], entries: MapEntries, period: { start: string; end: string }): Applied {
  const notes: string[] = [];
  // metric -> day -> { sum, count } over every mapped column.
  const byMetric = new Map<string, { reads: Reads; days: Map<string, { sum: number; count: number }> }>();
  let outside = 0;

  for (const table of tables) {
    for (const column of table.columns) {
      const entry = entries[column.key];
      if (!entry) continue;
      const metric = monitoringMetric(entry.metric);
      if (!metric) continue;
      const slot = byMetric.get(metric.id) ?? { reads: entry.reads === "totaliser" ? "daily_total" : entry.reads, days: new Map() };
      byMetric.set(metric.id, slot);

      const values = table.rows
        .map((row) => ({ day: row.day, value: row.values[column.index] }))
        .filter((point): point is { day: string; value: number } => point.value != null)
        .sort((a, b) => a.day.localeCompare(b.day));

      let previous: { day: string; value: number } | null = null;
      for (const point of values) {
        let amount = point.value * entry.scale;
        if (entry.reads === "totaliser") {
          const before: { day: string; value: number } | null = previous;
          previous = point;
          if (!before) {
            notes.push(`${column.header}: ${point.day} is the first reading, so it gives no amount; the next day starts the series.`);
            continue;
          }
          const delta = (point.value - before.value) * entry.scale;
          if (delta < 0) {
            notes.push(`${column.header}: the totaliser fell on ${point.day} (a reset?), so that day is left out.`);
            continue;
          }
          amount = delta;
        }
        if (point.day < period.start || point.day > period.end) {
          outside += 1;
          continue;
        }
        const cell = slot.days.get(point.day) ?? { sum: 0, count: 0 };
        cell.sum += amount;
        cell.count += 1;
        slot.days.set(point.day, cell);
      }
    }
  }
  if (outside) notes.push(`${outside} value${outside === 1 ? "" : "s"} outside ${period.start} to ${period.end} left out.`);

  const days: Applied["days"] = {};
  const summary: Applied["summary"] = [];
  for (const [metricId, slot] of byMetric) {
    const metric = monitoringMetric(metricId)!;
    const dayKeys = [...slot.days.keys()].sort();
    if (!dayKeys.length) continue;
    let total = 0;
    for (const day of dayKeys) {
      const cell = slot.days.get(day)!;
      const value = round(slot.reads === "reading" ? cell.sum / cell.count : cell.sum);
      total += value;
      (days[day] ??= []).push({ metric: metricId, value, unit: metric.unit });
    }
    summary.push({
      metric: metricId,
      days: dayKeys.length,
      first: dayKeys[0],
      last: dayKeys[dayKeys.length - 1],
      total: round(slot.reads === "reading" ? total / dayKeys.length : total),
      reads: slot.reads,
    });
  }
  summary.sort((a, b) => a.metric.localeCompare(b.metric));
  return { days, metrics: summary.map((item) => item.metric), summary, notes };
}

/**
 * The period to offer: the days the fullest tables cover (the daily meter sheets),
 * not a short list such as deliveries that reaches months either side.
 */
export function tableRange(tables: SourceTable[]): { start: string; end: string } | null {
  const most = Math.max(0, ...tables.map((table) => table.rows.length));
  const days = tables
    .filter((table) => table.rows.length >= most / 2)
    .flatMap((table) => table.rows.map((row) => row.day))
    .sort();
  return days.length ? { start: days[0], end: days[days.length - 1] } : null;
}
