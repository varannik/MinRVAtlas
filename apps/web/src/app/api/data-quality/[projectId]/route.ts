import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { NO_STORE, dataEnd, failed, qualityContext, refuse, runIfNeeded, view } from "@/lib/quality/route.server";
import { isStale, loadQuality } from "@/lib/quality/store.server";

/**
 * The data quality engine's findings for a project (apps/quality-engine, infra/lib/quality).
 * GET: the latest finished run, any run in progress, and its findings with people's
 *   decisions applied; `stale` when the data reaches past what the run checked.
 * POST { force? }: start a run. Without force only when the data has moved on (anyone
 *   on the project); with force, a re-run, for people who may decide.
 * Reads and writes go through the Cortex tenant session for this tenant and project.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  try {
    const context = await qualityContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return Response.json({ ...context.unavailable, stale: false }, { headers: NO_STORE });
    const stored = await loadQuality(context.dynamo, context.env.table, context.session.tenantId, context.project.id);
    const stale = isStale(stored, await dataEnd(context.project));
    return Response.json({ ...view(stored, context.session), stale }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "quality read");
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  let force = false;
  try {
    const body = (await request.json()) as { force?: unknown };
    force = body?.force === true;
  } catch {
    // An empty body asks for a run only if one is due.
  }
  try {
    const context = await qualityContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return refuse(context.unavailable.reason ?? "Not available.", 409);
    const { stored, started } = await runIfNeeded(context, force);
    return Response.json({ ...view(stored, context.session), stale: false, started }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "quality run");
  }
}
