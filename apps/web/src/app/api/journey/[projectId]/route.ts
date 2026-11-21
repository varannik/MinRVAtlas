import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { CortexRefusal, cortexEnv, currentSession, describeFailure, projectDynamo, requireProject } from "@/lib/cortex/intake.server";
import { canUploadAs } from "@/lib/cortex/uploads";
import { JourneyRefusal, applyAction, parseAction } from "@/lib/journey/engine";
import { JourneyConflict, loadJourney, saveJourney } from "@/lib/journey/storage.server";

/**
 * A project's journey, stored per project (lib/journey/storage.server.ts).
 * GET: where the project stands and every answer, and whether this user may change it.
 * POST { version, action, taskId?, value?, files? }: answer, draft, accept or advance.
 *   The server runs Cortex's check, so the stored status is always its verdict.
 *   409 when someone saved first, with the journey as it now is.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };
const MAX_BODY_BYTES = 64 * 1024;

type Context = { params: Promise<{ projectId: string }> };

function refuse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

async function setup(projectId: string) {
  const session = await currentSession();
  if (!session) return { failure: refuse("Unauthorized", 401) } as const;
  const env = cortexEnv();
  if (!env?.journeyTable) return { failure: refuse("Project journeys are not set up on this deployment.", 503) } as const;
  const project = await requireProject(session, env, projectId);
  const dynamo = await projectDynamo(session, env, project.id);
  return { session, env, table: env.journeyTable, project, dynamo } as const;
}

function failed(error: unknown, what: string) {
  if (error instanceof JourneyRefusal) return refuse(error.message, 422);
  const failure = describeFailure(error);
  if (failure.status >= 500) console.error(what, (error as Error)?.name);
  return refuse(failure.message, failure.status);
}

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  try {
    const ready = await setup(projectId);
    if ("failure" in ready) return ready.failure;
    const journey = await loadJourney(ready.dynamo, ready.table, ready.session.tenantId, ready.project.id);
    return Response.json({ journey, project: ready.project, canEdit: canUploadAs(ready.session.role) }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "journey read");
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return refuse("That change is too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse("The change could not be read.", 400);
  }
  const action = parseAction(body);
  const version = (body as { version?: unknown })?.version;
  if (!action || typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    return refuse("The change could not be read.", 400);
  }

  try {
    const ready = await setup(projectId);
    if ("failure" in ready) return ready.failure;
    if (!canUploadAs(ready.session.role)) throw new CortexRefusal("Your role can read this journey but not change it.", 403);

    const { session, dynamo, table, project } = ready;
    const from = await loadJourney(dynamo, table, session.tenantId, project.id);
    if (from.version !== version) throw new JourneyConflict(from);
    const now = new Date().toISOString();
    const outcome = applyAction(from, action, now);
    const journey = await saveJourney(dynamo, table, {
      tenantId: session.tenantId,
      projectId: project.id,
      by: session.sub,
      from,
      action,
      outcome,
      now,
    });
    return Response.json({ journey, taskId: outcome.taskId, ok: outcome.ok }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof JourneyConflict) {
      return Response.json({ error: error.message, journey: error.current }, { status: 409, headers: NO_STORE });
    }
    return failed(error, "journey change");
  }
}
