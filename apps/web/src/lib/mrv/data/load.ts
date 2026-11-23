import "server-only";

import { mrvKey } from "@/lib/atlas/keys";
import { currentSiteModel, siteModelLayout } from "@/lib/atlas/site-models.server";
import { atlasConfigured, getJsonObject } from "@/lib/atlas/store.server";
import type { SiteLayout } from "@/lib/site-layouts";
import type { Project } from "@/lib/types";
import { calcSpecFor } from "../calc/specs";
import { seriesMetrics } from "../calc/tree";
import { pulseReadingsFor } from "../pulse";
import { todayUtc } from "../days";
import { emptyDataset, type MrvDataset } from "../types";
import { streamDataset } from "./stream";

/**
 * Picks the data behind a project's ledger and calculation: the stream bucket
 * when it holds rows for the project, otherwise the history seeded for it in
 * the Atlas bucket (badged as sample data), otherwise an empty dataset that
 * says why. Nothing is made up here.
 */

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; dataset: MrvDataset }>();

/** The project's stored 3D site model, or null when it has none or the Atlas is not set up. */
async function siteLayout(projectId: string): Promise<SiteLayout | null> {
  if (!atlasConfigured()) return null;
  try {
    const manifest = await currentSiteModel(projectId);
    return manifest ? await siteModelLayout(manifest) : null;
  } catch {
    return null;
  }
}

/** Stream metrics the stage reads: the crediting tree plus the site's sensors. */
export async function metricsFor(project: Project): Promise<string[]> {
  const spec = calcSpecFor(project);
  const metrics = new Set(seriesMetrics(spec.root));
  for (const reading of pulseReadingsFor(await siteLayout(project.id), spec)) metrics.add(reading.metric);
  return [...metrics];
}

/** The monitoring history seeded for a demo project (seed/mrv), or null. */
async function seededDataset(project: Project): Promise<MrvDataset | null> {
  if (!atlasConfigured()) return null;
  return getJsonObject<MrvDataset>(mrvKey(project.tenantId, project.registry, project.id));
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

  const metrics = await metricsFor(project);
  let reason = "No stream rows for this project yet.";
  let dataset: MrvDataset | null = null;
  try {
    dataset = await streamDataset(project, metrics);
  } catch (error) {
    reason = `Stream bucket unreadable: ${error instanceof Error ? error.message : "unknown error"}`;
  }
  if (!dataset) {
    try {
      dataset = await seededDataset(project);
      if (dataset && reason.startsWith("Stream bucket")) dataset = { ...dataset, note: `${reason} Showing the seeded history.` };
    } catch (error) {
      reason = `Seeded history unreadable: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }
  dataset = compact(dataset ?? emptyDataset(project.id, todayUtc(), reason));
  cache.set(key, { at: Date.now(), dataset });
  return dataset;
}
