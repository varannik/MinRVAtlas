import type { NextRequest } from "next/server";

import { NO_STORE, atlasFailure, sessionProject } from "@/lib/atlas/access.server";
import { currentSiteModel, siteModelLayout } from "@/lib/atlas/site-models.server";
import { readSensors, sensorHosts } from "@/lib/site-layouts";

/**
 * Every sensor reading of a project's site model, now.
 * GET: { at, readings } keyed by `${host}/${sensor}`. Until the site sends a
 * live feed these follow each sensor's demo profile in the stored model.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  try {
    const ready = await sessionProject(projectId);
    if (ready instanceof Response) return ready;
    const manifest = await currentSiteModel(ready.project.id);
    const layout = manifest ? await siteModelLayout(manifest) : null;
    if (!layout) return Response.json({ at: new Date().toISOString(), readings: {} }, { headers: NO_STORE });
    const now = new Date();
    const seconds = (now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 1000;
    return Response.json({ at: now.toISOString(), source: "demo", readings: readSensors(sensorHosts(layout), seconds) }, { headers: NO_STORE });
  } catch (error) {
    return atlasFailure(error, "site readings");
  }
}
