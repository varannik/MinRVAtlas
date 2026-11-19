import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { cortexEnv, currentSession, describeFailure, signUpload } from "@/lib/cortex/intake.server";

/**
 * A signed form for sending one document straight to the Cortex intake bucket.
 * The browser posts the file to S3; from there it is scanned, admitted, parsed
 * and indexed for the project.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

function refuse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  const env = cortexEnv();
  if (!env) return refuse("Cortex uploads are not set up on this deployment.", 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse("Send JSON.", 400);
  }
  const { projectId, pin, fileName, size } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof projectId !== "string" ||
    typeof pin !== "string" ||
    typeof fileName !== "string" ||
    typeof size !== "number" ||
    !Number.isFinite(size)
  ) {
    return refuse("projectId, pin, fileName and size are required.", 400);
  }

  try {
    const form = await signUpload(session, env, { projectId, pin, fileName, size });
    return Response.json(form, { headers: NO_STORE });
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.status >= 500) console.error("cortex upload form", (error as Error)?.name);
    return refuse(failure.message, failure.status);
  }
}
