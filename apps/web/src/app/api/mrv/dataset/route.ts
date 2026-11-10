import type { NextRequest } from "next/server";

import { loadDataset } from "@/lib/mrv/data/load";
import { resolveOwnedProject } from "@/lib/registries/server";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "private, no-store" } });
}

/** Daily monitoring data and period attributes behind a project's stage. */
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId is required", 400);

  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }

  const project = resolveOwnedProject(tenantId, projectId);
  if (!project) return jsonError("Unknown project", 404);

  const dataset = await loadDataset(project);
  return Response.json(dataset, { headers: { "cache-control": "private, no-store" } });
}
