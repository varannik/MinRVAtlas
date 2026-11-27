import type { NextRequest } from "next/server";

import { loadVerification } from "@/lib/verification/store.server";
import { NO_STORE, failed, verificationContext, view } from "@/lib/verification/route.server";

/**
 * GET: a project's verification record: the imported Audit Document Index and its
 * evidence pieces, the submission files as received, and the filings. Read through
 * the Cortex tenant session for this tenant and project.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId } = await params;
  try {
    const context = await verificationContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return Response.json(context.unavailable, { headers: NO_STORE });
    const stored = await loadVerification(context.dynamo, context.env.table, context.session.tenantId, context.project.id);
    return Response.json(view(stored, context), { headers: NO_STORE });
  } catch (error) {
    return failed(error, "verification read");
  }
}
