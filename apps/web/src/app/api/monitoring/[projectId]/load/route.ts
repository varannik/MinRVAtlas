import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { canUploadAs } from "@/lib/cortex/uploads";
import { forgetDataset } from "@/lib/mrv/data/load";
import { diffDays } from "@/lib/mrv/days";
import { applyMapping, approvedFor, cleanEntries } from "@/lib/monitoring/mapping";
import { formFile, monitoringContext } from "@/lib/monitoring/route.server";
import { loadTagMap, saveUpload, type UploadRecord } from "@/lib/monitoring/store.server";
import { UploadError, keepOriginal, readUpload, sha256, writeDays } from "@/lib/monitoring/stream-write.server";
import { periodOf } from "@/lib/quality/gate";
import { NO_STORE, failed, refuse } from "@/lib/quality/route.server";
import { newRunId, startRun } from "@/lib/quality/store.server";

/**
 * POST multipart { file, entries (JSON), start, end }: load the file's mapped columns
 * for those days into the project's stream, then check them. Every column loaded must
 * have the same mapping in the approved tag map. The data quality engine then runs on
 * the stream, so it checks exactly what was loaded.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_DAYS = 400;

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  try {
    const context = await monitoringContext(projectId);
    if ("failure" in context) return context.failure;
    const { session, project, dynamo, env, s3, bucket, prefix } = context;
    if (!canUploadAs(session.role)) return refuse("Your role cannot load monitoring data.", 403);

    const form = await request.formData();
    const file = await formFile(form);
    let entries;
    try {
      entries = cleanEntries(JSON.parse(String(form.get("entries") ?? "{}")));
    } catch {
      return refuse("The column mapping could not be read.", 400);
    }
    const period = periodOf(String(form.get("start") ?? ""), String(form.get("end") ?? ""));
    if (!period) return refuse("Give the first and last day to load.", 400);
    if (diffDays(period.start, period.end) + 1 > MAX_DAYS) return refuse(`Load at most ${MAX_DAYS} days at a time.`, 400);
    if (!Object.values(entries).some(Boolean)) return refuse("Map at least one column to a metric.", 400);

    const tagMap = await loadTagMap(dynamo, env.table, session.tenantId, project.id);
    if (!approvedFor(tagMap, entries)) {
      return refuse("A platform admin has to approve the tag map for these columns before they are loaded.", 409);
    }

    const read = readUpload(file.name, file.bytes);
    const applied = applyMapping(read.tables, entries, period);
    if (!Object.keys(applied.days).length) return refuse("No mapped values fall in those days.", 400);

    const uploadId = newRunId();
    await keepOriginal(s3, bucket, prefix, uploadId, file.name, file.bytes);
    const written = await writeDays(s3, bucket, prefix, uploadId, applied);
    forgetDataset(project);

    // The engine reads the stream it was just written to.
    let runId: string | undefined;
    let runError: string | undefined;
    try {
      const run = await startRun(dynamo, env, {
        tenantId: session.tenantId,
        projectId: project.id,
        registry: project.registry,
        requestedBy: session.sub,
        country: project.country,
      });
      runId = run.id;
    } catch {
      runError = "The data is loaded, but its quality run could not be started. Start it again from the calculation tree.";
    }

    const upload: UploadRecord = {
      id: uploadId,
      fileName: file.name.slice(-160),
      bytes: file.bytes.length,
      sha256: sha256(file.bytes),
      period,
      days: written.days,
      metrics: applied.metrics,
      by: session.email ?? session.sub,
      at: new Date().toISOString(),
      tagMapVersion: tagMap!.version,
      runId,
      notes: applied.notes.slice(0, 20),
    };
    await saveUpload(dynamo, env.table, session.tenantId, project.id, upload);
    return Response.json({ upload, updatedDays: written.updated, summary: applied.summary, runError }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof UploadError) return refuse(error.message, 400);
    return failed(error, "monitoring load");
  }
}
