import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { cortexEnv, currentSession, describeFailure, listDocuments, removeDocument } from "@/lib/cortex/intake.server";
import { isDocumentScope, type DocumentScope } from "@/lib/cortex/uploads";

/**
 * GET: documents a project has given one Cortex pin, and how far each has got.
 * DELETE: take one of them out of Cortex (?project=&pin=&name=).
 * &scope=tenant works on the organisation's documents for that pin instead.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

function scopeOf(params: URLSearchParams): DocumentScope | null {
  const scope = params.get("scope") ?? "project";
  return isDocumentScope(scope) ? scope : null;
}

export async function GET(request: NextRequest) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const env = cortexEnv();
  if (!env) return Response.json({ error: "Cortex is not set up on this deployment." }, { status: 503, headers: NO_STORE });

  const params = request.nextUrl.searchParams;
  const projectId = params.get("project") ?? "";
  const pin = params.get("pin") ?? "";
  const scope = scopeOf(params);
  if (!scope) return Response.json({ error: "scope is project or tenant." }, { status: 400, headers: NO_STORE });
  try {
    const documents = await listDocuments(session, env, { projectId, pin, scope });
    return Response.json({ documents }, { headers: NO_STORE });
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.status >= 500) console.error("cortex documents", (error as Error)?.name);
    return Response.json({ error: failure.message }, { status: failure.status, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isBrowserSameOrigin(request)) {
    return Response.json({ error: "Cross-site request refused." }, { status: 403, headers: NO_STORE });
  }
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const env = cortexEnv();
  if (!env) return Response.json({ error: "Cortex is not set up on this deployment." }, { status: 503, headers: NO_STORE });

  const params = request.nextUrl.searchParams;
  const scope = scopeOf(params);
  if (!scope) return Response.json({ error: "scope is project or tenant." }, { status: 400, headers: NO_STORE });
  try {
    const removed = await removeDocument(session, env, {
      scope,
      projectId: params.get("project") ?? "",
      pin: params.get("pin") ?? "",
      name: params.get("name") ?? "",
    });
    return Response.json({ removing: removed.key }, { status: 202, headers: NO_STORE });
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.status >= 500) console.error("cortex remove", (error as Error)?.name);
    return Response.json({ error: failure.message }, { status: failure.status, headers: NO_STORE });
  }
}
