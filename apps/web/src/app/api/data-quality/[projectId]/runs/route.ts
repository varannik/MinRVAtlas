import type { NextRequest } from "next/server";

import { NO_STORE, failed, qualityContext, refuse } from "@/lib/quality/route.server";
import { listRuns, runFindings } from "@/lib/quality/store.server";

/**
 * GET: the project's runs, newest first (each replayable: data fingerprint, versions, rules).
 * GET ?findings=<runId>: that run's findings as it wrote them, to compare two runs by finding id.
 * Read through the Cortex tenant session for this tenant and project.
 */

export const dynamic = "force-dynamic";

const RUN_ID = /^\d{8}T\d{6}Z-[a-z0-9]{4,12}$/;

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  const runId = request.nextUrl.searchParams.get("findings");
  if (runId !== null && !RUN_ID.test(runId)) return refuse("Unknown run.", 400);
  try {
    const context = await qualityContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return Response.json({ runs: [], findings: [], reason: context.unavailable.reason }, { headers: NO_STORE });
    const { dynamo, env, session, project } = context;
    if (runId) {
      const findings = await runFindings(dynamo, env.table, session.tenantId, project.id, runId);
      return Response.json({ findings }, { headers: NO_STORE });
    }
    const runs = (await listRuns(dynamo, env.table, session.tenantId, project.id)).map((run) => ({ ...run, summary: undefined }));
    return Response.json({ runs }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "quality runs read");
  }
}
