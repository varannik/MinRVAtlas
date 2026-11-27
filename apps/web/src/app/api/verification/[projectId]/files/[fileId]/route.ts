import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { fileKey, getFile, saveFile } from "@/lib/verification/store.server";
import { NO_STORE, canFile, failed, refuse, verificationContext } from "@/lib/verification/route.server";

/**
 * GET: open one file of the submission (PDFs, images and plain text in the browser;
 * everything else downloads). POST { sent: true } once the browser has sent it, or
 * { cortexKey } / { cortexNote } for its copy in Cortex.
 */

export const dynamic = "force-dynamic";

const FILE_ID = /^[0-9a-f]{16}$/;
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);

type Context = { params: Promise<{ projectId: string; fileId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { projectId, fileId } = await params;
  if (!FILE_ID.test(fileId)) return refuse("Unknown file.", 404);
  try {
    const context = await verificationContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return refuse(context.unavailable.reason ?? "Not available.", 409);
    const { s3, env, session, project, dynamo } = context;
    const file = await getFile(dynamo, env.table, session.tenantId, project.id, fileId);
    if (!file || file.status !== "stored") return refuse("Unknown file.", 404);
    const object = await s3.send(new GetObjectCommand({ Bucket: env.bucket, Key: fileKey(session.tenantId, project.id, file.id, file.name) }));
    const type = object.ContentType ?? "application/octet-stream";
    const disposition = INLINE.has(type) ? "inline" : "attachment";
    return new Response(object.Body?.transformToWebStream() ?? null, {
      headers: {
        ...NO_STORE,
        "content-type": type,
        "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    });
  } catch (error) {
    return failed(error, "verification file read");
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId, fileId } = await params;
  if (!FILE_ID.test(fileId)) return refuse("Unknown file.", 404);
  let body: { sent?: unknown; cortexKey?: unknown; cortexNote?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse("Send JSON.", 400);
  }
  try {
    const context = await verificationContext(projectId);
    if ("failure" in context) return context.failure;
    if ("unavailable" in context) return refuse(context.unavailable.reason ?? "Not available.", 409);
    if (!canFile(context.session.role)) return refuse("Your role cannot send the submission.", 403);
    const { s3, env, session, project, dynamo } = context;
    const file = await getFile(dynamo, env.table, session.tenantId, project.id, fileId);
    if (!file) return refuse("Unknown file.", 404);
    let next = file;
    if (body.sent === true) {
      // Only a file S3 holds, at the size given, counts as received.
      const head = await s3.send(new HeadObjectCommand({ Bucket: env.bucket, Key: fileKey(session.tenantId, project.id, file.id, file.name) }));
      if (head.ContentLength !== file.size) return refuse(`${file.name} did not arrive whole. Send it again.`, 409);
      next = { ...next, status: "stored" };
    }
    if (typeof body.cortexKey === "string" && body.cortexKey.startsWith(`tenants/${session.tenantId}/`) && body.cortexKey.length < 600) {
      next = { ...next, cortexKey: body.cortexKey, cortexNote: undefined };
    }
    if (typeof body.cortexNote === "string") next = { ...next, cortexNote: body.cortexNote.slice(0, 200) };
    await saveFile(dynamo, env.table, session.tenantId, project.id, next);
    return Response.json({ file: next }, { headers: NO_STORE });
  } catch (error) {
    if ((error as { name?: string }).name === "NotFound") return refuse("The file has not arrived yet.", 409);
    return failed(error, "verification file update");
  }
}
