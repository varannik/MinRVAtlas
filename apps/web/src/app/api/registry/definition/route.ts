import type { NextRequest } from "next/server";

import { scopedCertifyId } from "@/lib/iso-geo";
import { findConnection } from "@/lib/registries";
import { bundledDefinition } from "@/lib/registries/isometric/definition";
import { fetchProjectDefinition } from "@/lib/registries/isometric/server";
import {
  preferredCertifyProjectId,
  resolveOrgCredentials,
  resolveOwnedProject,
} from "@/lib/registries/server";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId is required", 400);

  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }

  const project = resolveOwnedProject(tenantId, projectId);
  if (!project) return jsonError("Unknown project", 404);
  if (project.registry !== "Isometric") {
    return Response.json(
      bundledDefinition(project.id, project.id, "Not an Isometric project."),
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const connection = findConnection(tenantId, project.registry, project.id);
  if (!connection) {
    return Response.json(
      bundledDefinition(project.id, project.id, "No Isometric connection for this tenant."),
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const credentials = resolveOrgCredentials(connection);
  const certifyId =
    scopedCertifyId(project) ?? preferredCertifyProjectId(connection);
  if (!credentials || !certifyId) {
    return Response.json(
      bundledDefinition(
        project.id,
        certifyId ?? project.id,
        `Set ${connection.credentials.accessTokenEnv} and ${connection.credentials.clientSecretEnv} to read the project charter from Certify.`,
      ),
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    const definition = await fetchProjectDefinition(
      connection.environment,
      project.id,
      certifyId,
      credentials,
    );
    return Response.json(definition, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Definition read failed";
    return Response.json(
      bundledDefinition(project.id, certifyId, message),
      { headers: { "cache-control": "private, no-store" } },
    );
  }
}
