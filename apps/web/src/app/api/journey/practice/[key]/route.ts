import type { NextRequest } from "next/server";

import { NO_STORE, atlasFailure, refuse } from "@/lib/atlas/access.server";
import { PracticeConflict, applyPractice, isPracticeKey, loadPractice, parseSeed, startPractice } from "@/lib/atlas/practice.server";
import { isBrowserSameOrigin } from "@/lib/auth/session";
import { currentSession } from "@/lib/cortex/intake.server";
import { JourneyRefusal, parseAction } from "@/lib/journey/engine";

/**
 * One person's practice journey, kept in the Atlas table.
 * GET: { journey, version }, or { journey: null } before it is started.
 * POST { action: "start", scenario, seed?, restart? }: open it, starting it from
 *   its scenario if needed (restart: from the beginning again).
 * POST { version, action, taskId?, value?, files? }: answer, draft, accept or
 *   advance, checked by the journey engine. 409 with the current journey when
 *   another tab saved first.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

type Context = { params: Promise<{ key: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { key } = await params;
  if (!isPracticeKey(key)) return refuse("Unknown practice journey", 404);
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  try {
    const practice = await loadPractice(session, key);
    return Response.json(practice ?? { journey: null, version: 0 }, { headers: NO_STORE });
  } catch (error) {
    return atlasFailure(error, "practice read");
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { key } = await params;
  if (!isPracticeKey(key)) return refuse("Unknown practice journey", 404);
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return refuse("That change is too large.", 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return refuse("JSON body is required", 400);
  }

  try {
    if (body.action === "start") {
      if (typeof body.scenario !== "string" || !isPracticeKey(body.scenario)) return refuse("scenario is required", 400);
      let seed;
      try {
        seed = parseSeed(body.seed);
      } catch (error) {
        return refuse((error as Error).message, 400);
      }
      const practice = await startPractice(session, key, body.scenario, seed, body.restart === true);
      return Response.json(practice, { headers: NO_STORE });
    }

    const action = parseAction(body);
    const version = Number(body.version);
    if (!action || !Number.isInteger(version)) return refuse("Not a journey change.", 400);
    const { practice, outcome } = await applyPractice(session, key, version, action);
    return Response.json({ ...practice, taskId: outcome.taskId, ok: outcome.ok }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof PracticeConflict) return Response.json({ error: error.message, ...error.current }, { status: 409, headers: NO_STORE });
    if (error instanceof JourneyRefusal) return refuse(error.message, 422);
    return atlasFailure(error, "practice change");
  }
}
