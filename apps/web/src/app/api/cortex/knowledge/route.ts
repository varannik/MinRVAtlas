import type { NextRequest } from "next/server";

import { cortexEnv, currentSession, describeFailure, projectKnowledge } from "@/lib/cortex/intake.server";

/**
 * GET ?project=: every document the project's Cortex searches read, from all three
 * scopes (registry, organisation, project), with its status and passage count.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const env = cortexEnv();
  if (!env) return Response.json({ error: "Cortex is not set up on this deployment." }, { status: 503, headers: NO_STORE });

  try {
    const knowledge = await projectKnowledge(session, env, request.nextUrl.searchParams.get("project") ?? "");
    return Response.json(knowledge, { headers: NO_STORE });
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.status >= 500) console.error("cortex knowledge", (error as Error)?.name);
    return Response.json({ error: failure.message }, { status: failure.status, headers: NO_STORE });
  }
}
