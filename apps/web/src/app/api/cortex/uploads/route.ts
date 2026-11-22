import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { cortexEnv, currentSession, describeFailure, signUpload } from "@/lib/cortex/intake.server";
import { isDocumentScope } from "@/lib/cortex/uploads";

/**
 * A signed form for sending one document straight to the Cortex intake bucket.
 * The browser sends the file's SHA-256: a file Cortex already searches for the
 * project is refused, and S3 refuses a file that does not match it.
 * replace: false refuses a different document of the same name instead of replacing it.
 * A refusal says why (reason "duplicate" with the key Cortex has it under, or "name_taken").
 * The browser posts the file to S3; from there it is scanned, admitted, parsed
 * and indexed for the project, or (scope "tenant", admins only) for every project
 * in the organisation.
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
  const { projectId, pin, fileName, size, sha256, scope = "project", replace = true } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof projectId !== "string" ||
    typeof pin !== "string" ||
    typeof fileName !== "string" ||
    typeof size !== "number" ||
    typeof sha256 !== "string" ||
    !Number.isFinite(size) ||
    !isDocumentScope(scope) ||
    typeof replace !== "boolean"
  ) {
    return refuse("projectId, pin, fileName, size and sha256 are required; scope is project or tenant.", 400);
  }

  try {
    const form = await signUpload(session, env, { projectId, pin, fileName, size, sha256, scope, replace });
    return Response.json(form, { headers: NO_STORE });
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.status >= 500) console.error("cortex upload form", (error as Error)?.name);
    // A duplicate names the document Cortex already has, so a journey can file that one instead.
    return Response.json({ error: failure.message, ...failure.detail }, { status: failure.status, headers: NO_STORE });
  }
}
