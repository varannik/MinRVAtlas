import { randomBytes } from "node:crypto";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { fileKey, saveFile } from "@/lib/verification/store.server";
import { NO_STORE, canFile, failed, refuse, verificationContext } from "@/lib/verification/route.server";
import type { SubmissionFile } from "@/lib/verification/types";

/**
 * POST { files: [{ path, size, sha256 }] }: signed forms for sending up to 25 files of
 * the submission straight to the verification bucket, under the project's own prefix.
 * S3 refuses a file whose SHA-256 is not the one given. Each file is recorded as
 * pending until the browser reports it sent (files/[fileId]).
 */

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_PER_REQUEST = 25;
const FORM_SECONDS = 10 * 60;
const SHA256 = /^[A-Za-z0-9+/]{43}=$/;

/** Content types by extension; anything else is kept as bytes. */
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function typeOf(name: string): string {
  return TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  let body: { files?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse("Send JSON.", 400);
  }
  const wanted = Array.isArray(body.files) ? (body.files as { path?: unknown; size?: unknown; sha256?: unknown }[]) : [];
  if (!wanted.length || wanted.length > MAX_PER_REQUEST) return refuse(`Send 1 to ${MAX_PER_REQUEST} files at a time.`, 400);
  for (const file of wanted) {
    if (typeof file?.path !== "string" || !file.path.trim() || file.path.length > 400 || file.path.includes("..")) return refuse("Every file needs its path in the folder.", 400);
    if (typeof file.size !== "number" || file.size < 1 || file.size > MAX_FILE_BYTES) return refuse(`${file.path}: files are 1 byte to 100 MB.`, 400);
    if (typeof file.sha256 !== "string" || !SHA256.test(file.sha256)) return refuse(`${file.path}: its fingerprint is missing.`, 400);
  }
  try {
    const context = await verificationContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return refuse(context.unavailable.reason ?? "Not available.", 409);
    if (!canFile(context.session.role)) return refuse("Your role cannot send the submission.", 403);
    const { s3, env, session, project, dynamo } = context;
    const forms = await Promise.all(
      wanted.map(async (raw) => {
        const path = (raw.path as string).replace(/\\/g, "/").replace(/^\/+/, "");
        const name = path.split("/").pop() ?? path;
        const id = randomBytes(8).toString("hex");
        const key = fileKey(session.tenantId, project.id, id, name);
        const contentType = typeOf(name);
        const { url, fields } = await createPresignedPost(s3, {
          Bucket: env.bucket,
          Key: key,
          Fields: { "Content-Type": contentType, "x-amz-checksum-algorithm": "SHA256", "x-amz-checksum-sha256": raw.sha256 as string },
          Conditions: [
            ["content-length-range", 1, MAX_FILE_BYTES],
            ["eq", "$Content-Type", contentType],
          ],
          Expires: FORM_SECONDS,
        });
        const file: SubmissionFile = {
          id,
          path,
          name,
          size: raw.size as number,
          sha256: raw.sha256 as string,
          status: "pending",
          uploadedBy: session.email ?? session.sub,
          uploadedAt: new Date().toISOString(),
        };
        await saveFile(dynamo, env.table, session.tenantId, project.id, file);
        return { file, form: { url, fields, key } };
      }),
    );
    return Response.json({ forms }, { headers: NO_STORE });
  } catch (error) {
    return failed(error, "verification upload forms");
  }
}
