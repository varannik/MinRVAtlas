import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { canUploadAs } from "@/lib/cortex/uploads";
import { forgetDataset } from "@/lib/mrv/data/load";
import { monitoringContext } from "@/lib/monitoring/route.server";
import { getUpload, markRemoved } from "@/lib/monitoring/store.server";
import { removeUploadRows } from "@/lib/monitoring/stream-write.server";
import { NO_STORE, failed, refuse } from "@/lib/quality/route.server";
import { startRun } from "@/lib/quality/store.server";

/**
 * DELETE { reason }: take a load back out of the project's stream. Only that load's
 * rows go; a day left empty loses its file (the versioned bucket keeps it for 90
 * days). The load's record says who removed it, when and why, and its original file
 * stays. Then the data quality engine runs again on what is left.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UPLOAD_ID = /^\d{8}T\d{6}Z-[a-z0-9]{4,12}$/;

type Context = { params: Promise<{ projectId: string; uploadId: string }> };

export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId, uploadId } = await params;
  if (!UPLOAD_ID.test(uploadId)) return refuse("Unknown load.", 404);
  let reason = "";
  try {
    reason = String(((await request.json()) as { reason?: unknown }).reason ?? "").trim();
  } catch {
    // Checked below.
  }
  if (reason.length < 3 || reason.length > 500) return refuse("Say why the load is removed (3 to 500 characters).", 400);

  try {
    const context = await monitoringContext(projectId);
    if ("failure" in context) return context.failure;
    const { session, project, dynamo, env, s3, bucket, prefix } = context;
    if (!canUploadAs(session.role)) return refuse("Your role cannot remove monitoring data.", 403);

    const upload = await getUpload(dynamo, env.table, session.tenantId, project.id, uploadId);
    if (!upload) return refuse("Unknown load.", 404);
    if (upload.removed) return refuse("This load was already removed.", 409);

    const removed = await removeUploadRows(s3, bucket, prefix, uploadId, upload.period);
    forgetDataset(project);
    let runId: string | undefined;
    try {
      runId = (
        await startRun(dynamo, env, {
          tenantId: session.tenantId,
          projectId: project.id,
          registry: project.registry,
          requestedBy: session.sub,
          country: project.country,
        })
      ).id;
    } catch {
      // The data is out; the next page view starts the run that was missed.
    }
    const record = { ...upload, removed: { by: session.email ?? session.sub, at: new Date().toISOString(), reason, days: removed.days, runId } };
    await markRemoved(dynamo, env.table, session.tenantId, project.id, record);
    return Response.json({ upload: record, deletedDays: removed.deleted }, { headers: NO_STORE });
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") return refuse("This load was already removed.", 409);
    return failed(error, "monitoring removal");
  }
}
