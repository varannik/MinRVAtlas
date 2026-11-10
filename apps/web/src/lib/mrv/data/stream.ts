import "server-only";

import { parseAttributesJson, parseObservationsCsv } from "@/lib/stream-coverage";
import { sourcePrefix } from "@/lib/stream-schema";
import { getObjectText, getPrefixObject, listObservationKeys, streamConfigured } from "@/lib/stream-s3";
import type { Project } from "@/lib/types";
import { isDayKey, todayUtc } from "../days";
import type { DailyMetrics, FixedValue, MetricDay, MrvDataset } from "../types";

/**
 * Real monitoring data from the stream bucket:
 * `<tenant>/<registry>/<project>/dt=YYYY-MM-DD/observations.csv` plus the
 * project's `attributes.json`. Rows are folded to one cell per metric per day.
 */

/** Newest days read per request; older history needs a summary table. */
const MAX_DAYS = 1100;
const CONCURRENCY = 16;

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

function foldDay(day: string, text: string, wanted: Set<string>): { row: DailyMetrics; latest: string | null } {
  const metrics: Record<string, MetricDay> = {};
  let latest: string | null = null;
  for (const observation of parseObservationsCsv(text)) {
    if (!wanted.has(observation.metric) || observation.quality === "missing") continue;
    const value = Number(observation.value);
    if (!Number.isFinite(value)) continue;
    if (!latest || observation.timestampUtc > latest) latest = observation.timestampUtc;
    const cell = metrics[observation.metric];
    if (!cell) {
      metrics[observation.metric] = { sum: value, mean: value, min: value, max: value, last: value, count: 1 };
      continue;
    }
    cell.sum += value;
    cell.count += 1;
    cell.mean = cell.sum / cell.count;
    cell.min = Math.min(cell.min, value);
    cell.max = Math.max(cell.max, value);
    cell.last = value;
  }
  return { row: { day, metrics }, latest };
}

function attributesToFixed(text: string | null): FixedValue[] {
  if (!text) return [];
  const attributes = parseAttributesJson(text);
  return Object.entries(attributes.values).flatMap(([key, raw]) => {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (raw == null || !Number.isFinite(value)) return [];
    return [{
      key,
      value,
      validFrom: isDayKey(attributes.periodStart) ? attributes.periodStart : undefined,
      validTo: isDayKey(attributes.periodEnd) ? attributes.periodEnd : undefined,
      source: "attributes.json",
    }];
  });
}

/** Null when the bucket is not configured or holds nothing for the project. */
export async function streamDataset(project: Project, metrics: string[]): Promise<MrvDataset | null> {
  if (!streamConfigured()) return null;
  const listed = await listObservationKeys({
    tenantId: project.tenantId,
    registry: project.registry,
    projectId: project.id,
    from: "2000-01-01",
    to: todayUtc(),
  });
  if (listed.length === 0) return null;

  const prefix = sourcePrefix(project.tenantId, project.registry, project.id);
  const wanted = new Set(metrics);
  const keys = listed.slice(-MAX_DAYS);
  const folded = await mapLimit(keys, CONCURRENCY, async ({ key, day }) => foldDay(day, await getObjectText(key, prefix), wanted));

  const byDay = new Map<string, DailyMetrics>();
  let latestAt: string | undefined;
  for (const { row, latest } of folded) {
    const existing = byDay.get(row.day);
    byDay.set(row.day, existing ? { day: row.day, metrics: { ...existing.metrics, ...row.metrics } } : row);
    if (latest && (!latestAt || latest > latestAt)) latestAt = latest;
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const fixed = attributesToFixed(await getPrefixObject(project.tenantId, project.registry, project.id, "attributes.json"));

  return {
    projectId: project.id,
    origin: "stream",
    asOf: todayUtc(),
    note: listed.length > keys.length ? `Showing the newest ${keys.length} of ${listed.length} days.` : undefined,
    range: days.length ? { start: days[0].day, end: days[days.length - 1].day } : null,
    days,
    fixed,
    latestAt: latestAt ? `${latestAt.replace(" ", "T")}${latestAt.endsWith("Z") ? "" : "Z"}` : undefined,
    blocks: [],
  };
}
