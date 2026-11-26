import type { NextRequest } from "next/server";

import { isBrowserSameOrigin } from "@/lib/auth/session";
import { canUploadAs } from "@/lib/cortex/uploads";
import { cleanEntries } from "@/lib/monitoring/mapping";
import { monitoringContext } from "@/lib/monitoring/route.server";
import { TagMapConflict, approveTagMap, proposeTagMap } from "@/lib/monitoring/store.server";
import { NO_STORE, failed, refuse } from "@/lib/quality/route.server";

/**
 * A project's tag map, as agreed: operators propose it, platform admins approve it.
 * PUT { entries, version }: propose mappings for some columns (people who may upload).
 * POST { version }: approve the map as it stands at that version (platform admins).
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

function version(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

export async function PUT(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  let body: { entries?: unknown; version?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse("Send the entries as JSON.", 400);
  }
  const entries = cleanEntries(body.entries);
  if (!Object.keys(entries).length) return refuse("Map at least one column.", 400);
  try {
    const context = await monitoringContext(projectId);
    if ("failure" in context) return context.failure;
    if (!canUploadAs(context.session.role)) return refuse("Your role cannot propose a tag map.", 403);
    const map = await proposeTagMap(context.dynamo, context.env.table, {
      tenantId: context.session.tenantId,
      projectId: context.project.id,
      entries,
      by: context.session.email ?? context.session.sub,
      version: body.version === null ? null : version(body.version),
    });
    return Response.json({ tagMap: map }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TagMapConflict) return refuse(error.message, 409);
    return failed(error, "tag map proposal");
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const { projectId } = await params;
  let body: { version?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse("Send the version as JSON.", 400);
  }
  const at = version(body.version);
  if (at == null) return refuse("Say which version of the map you approve.", 400);
  try {
    const context = await monitoringContext(projectId);
    if ("failure" in context) return context.failure;
    if (context.session.role !== "platform_admin") return refuse("Only a platform admin approves a tag map.", 403);
    const map = await approveTagMap(context.dynamo, context.env.table, {
      tenantId: context.session.tenantId,
      projectId: context.project.id,
      version: at,
      by: context.session.email ?? context.session.sub,
    });
    return Response.json({ tagMap: map }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof TagMapConflict) return refuse(error.message, 409);
    return failed(error, "tag map approval");
  }
}
