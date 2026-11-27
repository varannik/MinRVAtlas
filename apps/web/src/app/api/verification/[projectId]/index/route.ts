import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { readXlsx, WorkbookError } from "@/lib/monitoring/xlsx.server";
import { importIndex } from "@/lib/verification/index-import";
import { loadVerification, saveIndex } from "@/lib/verification/store.server";
import { NO_STORE, canFile, failed, refuse, verificationContext, view } from "@/lib/verification/route.server";
import type { AuditKey, IndexImport } from "@/lib/verification/types";

/**
 * POST multipart { file }: import Puro's Audit Document Index (.xlsx) for the project:
 * every evidence piece of its Facility, Output and Combined audit sheets, with the
 * clauses each answers and the supplier's remarks. Importing again keeps filings on
 * pieces whose names have not changed.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  try {
    const context = await verificationContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return refuse(context.unavailable.reason ?? "Not available.", 409);
    if (!canFile(context.session.role)) return refuse("Your role cannot import the Index.", 403);
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || !file.size) return refuse("Choose the Audit Document Index (.xlsx).", 400);
    if (file.size > MAX_BYTES) return refuse("The Index is larger than 10 MB.", 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    let parsed;
    try {
      parsed = importIndex(readXlsx(bytes));
    } catch (error) {
      return refuse(error instanceof WorkbookError ? error.message : "The workbook could not be read.", 400);
    }
    if (!parsed.pieces.length) return refuse("No evidence pieces found: is this Puro's Audit Document Index?", 400);
    const counts = { facility: 0, output: 0, combined: 0 } as Record<AuditKey, number>;
    for (const piece of parsed.pieces) counts[piece.audit] += 1;
    const index: IndexImport = {
      methodology: parsed.methodology,
      fileName: file.name.slice(-160),
      sha256: createHash("sha256").update(bytes).digest("base64"),
      importedBy: context.session.email ?? context.session.sub,
      importedAt: new Date().toISOString(),
      counts,
    };
    await saveIndex(context.dynamo, context.env.table, context.session.tenantId, context.project.id, index, parsed.pieces);
    const stored = await loadVerification(context.dynamo, context.env.table, context.session.tenantId, context.project.id);
    return Response.json(view(stored, context), { headers: NO_STORE });
  } catch (error) {
    return failed(error, "verification index import");
  }
}
