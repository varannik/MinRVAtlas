import "server-only";

import type { Project } from "@/lib/types";
import { calcSpecFor } from "../calc/specs";
import { seriesMetrics } from "../calc/tree";
import { pulseReadingsFor } from "../pulse";
import { todayUtc } from "../days";
import { emptyDataset, type MrvDataset } from "../types";
import { sampleDataset } from "./sample";
import { streamDataset } from "./stream";

/**
 * Picks the data behind a project's stage: the stream bucket when it holds
 * rows for the project, otherwise badged sample data (turn off with
 * MRV_SAMPLE_DATA=off), otherwise an empty dataset that says why.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; dataset: MrvDataset }>();

function sampleEnabled(): boolean {
  return (process.env.MRV_SAMPLE_DATA ?? "").trim().toLowerCase() !== "off";
}

/** Stream metrics the stage reads: the crediting tree plus the pulse panel. */
export function metricsFor(project: Project): string[] {
  const spec = calcSpecFor(project);
  const metrics = new Set(seriesMetrics(spec.root));
  for (const reading of pulseReadingsFor(project.id, spec)) metrics.add(reading.metric);
  return [...metrics];
}

/** Telemetry is never better than 5 significant figures; trim the payload to match. */
function round(value: number): number {
  return Number.isFinite(value) && value !== 0 ? Number(value.toPrecision(5)) : value;
}

function compact(dataset: MrvDataset): MrvDataset {
  return {
    ...dataset,
    days: dataset.days.map((row) => ({
      day: row.day,
      metrics: Object.fromEntries(
        Object.entries(row.metrics).map(([metric, cell]) => [
          metric,
          { sum: round(cell.sum), mean: round(cell.mean), min: round(cell.min), max: round(cell.max), last: round(cell.last), count: cell.count },
        ]),
      ),
    })),
  };
}

export async function loadDataset(project: Project): Promise<MrvDataset> {
  const key = `${project.tenantId}:${project.registry}:${project.id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.dataset;

  const metrics = metricsFor(project);
  let reason = "No stream rows for this project yet.";
  let dataset: MrvDataset | null = null;
  try {
    dataset = await streamDataset(project, metrics);
  } catch (error) {
    reason = `Stream bucket unreadable: ${error instanceof Error ? error.message : "unknown error"}`;
  }
  if (!dataset && sampleEnabled()) {
    dataset = sampleDataset(project, calcSpecFor(project), metrics);
    if (reason.startsWith("Stream bucket")) dataset.note = `${reason} Showing sample data.`;
  }
  dataset = compact(dataset ?? emptyDataset(project.id, todayUtc(), reason));
  cache.set(key, { at: Date.now(), dataset });
  return dataset;
}
