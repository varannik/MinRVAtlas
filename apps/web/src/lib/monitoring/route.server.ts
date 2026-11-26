import "server-only";

import type { S3Client } from "@aws-sdk/client-s3";

import { cortexEnv, projectS3 } from "@/lib/cortex/intake.server";
import { qualityContext, refuse, type QualityContext } from "@/lib/quality/route.server";
import { sourcePrefix } from "@/lib/stream-schema";
import { streamBucketName } from "@/lib/stream-s3";
import { UploadError, MAX_UPLOAD_BYTES } from "./stream-write.server";

/**
 * Shared by the monitoring data routes: the signed-in user's project as the data
 * quality routes see it, plus a stream client and prefix limited to that project.
 */

export interface MonitoringContext extends QualityContext {
  s3: S3Client;
  bucket: string;
  prefix: string;
}

export async function monitoringContext(projectId: string): Promise<{ failure: Response } | MonitoringContext> {
  const context = await qualityContext(projectId);
  if ("failure" in context) return context;
  if ("unavailable" in context) return { failure: refuse(context.unavailable.reason ?? "Not available on this deployment.", 409) };
  const bucket = streamBucketName();
  const cortex = cortexEnv();
  if (!bucket || !cortex) return { failure: refuse("Monitoring data cannot be loaded on this deployment.", 409) };
  const s3 = await projectS3(context.session, cortex, context.project.id);
  return { ...context, s3, bucket, prefix: sourcePrefix(context.session.tenantId, context.project.registry, context.project.id) };
}

/** The one file in a multipart form, as bytes. */
export async function formFile(form: FormData): Promise<{ name: string; bytes: Buffer }> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UploadError("Choose a file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("The file is larger than 20 MB.");
  return { name: file.name || "upload", bytes: Buffer.from(await file.arrayBuffer()) };
}
