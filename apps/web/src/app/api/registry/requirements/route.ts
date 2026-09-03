import type { NextRequest } from "next/server";

import { PROJECTS } from "@/lib/projects";
import { findConnection } from "@/lib/registries";
import { bundledResult, fetchRequirementSpec } from "@/lib/registries/server";
import { TENANTS } from "@/lib/tenants";

/**
 * The only door between the dashboard and a registry.
 *
 * The browser asks this route for a project's requirements; the route decides
 * which tenant is asking, whether that tenant owns the project, and which
 * registry connection may answer. Registry credentials are resolved server-side
 * from the platform's own secret store — the client cannot supply, override or
 * observe them, which is what keeps a multi-tenant deployment from leaking one
 * supplier's registry access to another.
 */

export const dynamic = "force-dynamic";

function unauthorized(message: string) {
  return Response.json({ error: message }, { status: 403 });
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }

  // Stands in for the session lookup a real deployment would do here. The
  // tenant is never trusted to also name the registry credentials.
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return unauthorized("Unknown tenant");
  }

  const project = PROJECTS.find((candidate) => candidate.id === projectId);
  if (!project) {
    return Response.json({ error: "Unknown project" }, { status: 404 });
  }
  if (project.tenantId !== tenantId) {
    return unauthorized("Project belongs to another tenant");
  }

  const connection = findConnection(tenantId, project.registry, project.id);

  const result = connection
    ? await fetchRequirementSpec(project, connection)
    : bundledResult(project, {
        fallbackReason: "no-connection",
        message: `No ${project.registry} connection is provisioned for this tenant.`,
      });

  return Response.json(result, {
    headers: { "cache-control": "private, no-store" },
  });
}
