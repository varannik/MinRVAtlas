import type { NextRequest } from "next/server";

import { NO_STORE, failed, qualityContext } from "@/lib/quality/route.server";
import { listDecisions } from "@/lib/quality/store.server";

/**
 * GET: every confirm, dismiss and reopen on the project, newest first, with who,
 * when and why: the record a verifier reads. Decisions are never deleted.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  try {
    const context = await qualityContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return Response.json({ decisions: [], reason: context.unavailable.reason }, { headers: NO_STORE });
    const { dynamo, env, session, project } = context;
    const decisions = await listDecisions(dynamo, env.table, session.tenantId, project.id);
    return Response.json({ decisions, me: session.email ?? session.sub }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "quality decisions read");
  }
}
