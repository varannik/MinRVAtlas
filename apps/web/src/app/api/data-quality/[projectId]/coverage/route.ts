import type { NextRequest } from "next/server";

import { loadDataset } from "@/lib/mrv/data/load";
import { streamDataset } from "@/lib/mrv/data/stream";
import { addDays, rangeDays } from "@/lib/mrv/days";
import { NO_STORE, failed, qualityContext } from "@/lib/quality/route.server";

/**
 * GET: which meter reported on which day, over the data the engine reads: the
 * project's stream (every meter in it), else its seeded sample history. Each
 * meter's days come as a string over the range, "1" reported and "0" nothing.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  try {
    const context = await qualityContext(projectId);
    if ("failure" in context) return context.failure;
    const { project } = "unavailable" in context ? { project: null } : context;
    if (!project) return Response.json({ range: null, metrics: [], origin: "none" }, { headers: NO_STORE });
    const dataset = (await streamDataset(project, null)) ?? (await loadDataset(project));
    if (!dataset.range) return Response.json({ range: null, metrics: [], origin: dataset.origin }, { headers: NO_STORE });
    const range = dataset.range;
    const days = Array.from({ length: rangeDays(range) }, (_, offset) => addDays(range.start, offset));
    const byDay = new Map(dataset.days.map((row) => [row.day, row.metrics]));
    const metrics = [...new Set(dataset.days.flatMap((row) => Object.keys(row.metrics)))].sort();
    return Response.json(
      {
        range: dataset.range,
        origin: dataset.origin,
        metrics: metrics.map((id) => ({ id, days: days.map((day) => (byDay.get(day)?.[id] ? "1" : "0")).join("") })),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return failed(error, "quality coverage read");
  }
}
