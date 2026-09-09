import type { NextRequest } from "next/server";

import { ensureSentinelUuid } from "@/lib/sentinel/bind";
import {
  getSentinelConfig,
  SentinelProjectMapError,
} from "@/lib/sentinel/config";
import { listQualityProjects } from "@/lib/sentinel/quality-projects";
import { resolveOwnedProject } from "@/lib/registries/server";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

function tenantFrom(request: NextRequest): string | null {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return null;
  }
  return tenantId;
}

export async function GET(request: NextRequest) {
  const tenantId = tenantFrom(request);
  if (!tenantId) return jsonError("Unknown tenant", 403);

  const projects = await listQualityProjects(tenantId);
  return Response.json(
    { projects },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const tenantId = tenantFrom(request);
  if (!tenantId) return jsonError("Unknown tenant", 403);
  if (tenantId !== getSentinelConfig().tenantId) {
    return jsonError("Sentinel is not provisioned for this tenant", 403);
  }

  let catalogProjectId = "";
  let name = "";
  try {
    const body = (await request.json()) as {
      catalogProjectId?: unknown;
      name?: unknown;
    };
    catalogProjectId = String(body.catalogProjectId ?? "").trim();
    name = String(body.name ?? "").trim();
  } catch {
    return jsonError("catalogProjectId is required", 400);
  }

  if (!catalogProjectId) return jsonError("catalogProjectId is required", 400);

  const project = resolveOwnedProject(tenantId, catalogProjectId);
  if (!project) return jsonError("Unknown project", 404);

  try {
    const sentinelProjectId = await ensureSentinelUuid(
      catalogProjectId,
      name || project.name,
    );
    return Response.json(
      {
        catalogProjectId,
        sentinelProjectId,
        name: name || project.name,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof SentinelProjectMapError) {
      return jsonError(error.message, 400);
    }
    const message =
      error instanceof Error ? error.message : "Could not bind Sentinel project";
    return jsonError(message, 502);
  }
}
