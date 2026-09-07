import type { NextRequest } from "next/server";

import { PROJECTS } from "@/lib/projects";
import { findConnection } from "@/lib/registries";
import { mapCertifyProjects } from "@/lib/registries/isometric/project-map";
import { listCertifyProjects } from "@/lib/registries/isometric/server";
import {
  preferredCertifyProjectId,
  resolveOrgCredentials,
} from "@/lib/registries/server";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";

function unauthorized(message: string) {
  return Response.json({ error: message }, { status: 403 });
}

export async function GET(request: NextRequest) {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return unauthorized("Unknown tenant");
  }

  const connection = findConnection(tenantId, "Isometric");
  const catalog = PROJECTS.filter(
    (project) => project.tenantId === tenantId && project.registry === "Isometric",
  );

  if (!connection) {
    return Response.json(
      { projects: catalog, origin: "bundled" as const },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const credentials = resolveOrgCredentials(connection);
  if (!credentials) {
    return Response.json(
      {
        projects: catalog,
        origin: "bundled" as const,
        warning: `Set ${connection.credentials.accessTokenEnv} and ${connection.credentials.clientSecretEnv} to list Certify projects.`,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const listed = await listCertifyProjects(connection.environment, credentials);
  if (listed.nodes.length === 0) {
    return Response.json(
      {
        projects: catalog,
        origin: listed.warning ? ("bundled" as const) : ("registry-api" as const),
        warning: listed.warning,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const preferred = preferredCertifyProjectId(connection);
  const projects = mapCertifyProjects(tenantId, listed.nodes, preferred);

  return Response.json(
    {
      projects,
      origin: "registry-api" as const,
      warning: listed.warning,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
