import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { isAudit, loadVerification, saveFiling } from "@/lib/verification/store.server";
import { NO_STORE, canFile, failed, refuse, verificationContext } from "@/lib/verification/route.server";

/**
 * PUT { audit, filings: [{ pieceId, fileIds }] }: file submission files under evidence
 * pieces (the supplier's side). Each named piece gets exactly the files given.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function PUT(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  let body: { audit?: unknown; filings?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse("Send JSON.", 400);
  }
  if (!isAudit(body.audit) || !Array.isArray(body.filings) || !body.filings.length || body.filings.length > 200) {
    return refuse("Send the audit and up to 200 filings.", 400);
  }
  const audit = body.audit;
  try {
    const context = await verificationContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return refuse(context.unavailable.reason ?? "Not available.", 409);
    if (!canFile(context.session.role)) return refuse("Your role cannot file evidence.", 403);
    const { dynamo, env, session, project } = context;
    const stored = await loadVerification(dynamo, env.table, session.tenantId, project.id);
    const pieces = new Set(stored.pieces.filter((piece) => piece.audit === audit).map((piece) => piece.id));
    const files = new Set(stored.files.filter((file) => file.status === "stored").map((file) => file.id));
    const at = new Date().toISOString();
    const by = session.email ?? session.sub;
    const filings = [];
    for (const raw of body.filings as { pieceId?: unknown; fileIds?: unknown }[]) {
      if (typeof raw?.pieceId !== "string" || !pieces.has(raw.pieceId) || !Array.isArray(raw.fileIds)) return refuse("Unknown evidence piece.", 400);
      const fileIds = [...new Set(raw.fileIds.filter((id): id is string => typeof id === "string"))];
      if (fileIds.some((id) => !files.has(id))) return refuse("Unknown or unfinished file.", 400);
      filings.push({ audit, pieceId: raw.pieceId, fileIds, by, at });
    }
    await Promise.all(filings.map((filing) => saveFiling(dynamo, env.table, session.tenantId, project.id, filing)));
    return Response.json({ filings }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "verification filing");
  }
}
