import type { NextRequest } from "next/server";

import { scopedCertifyId } from "@/lib/iso-geo";
import { findConnection } from "@/lib/registries";
import { bundledSetup, fetchProjectSetup } from "@/lib/registries/isometric/setup";
import type { SetupAction } from "@/lib/registries/isometric/setup-types";
import {
  parseSetupAction,
  submitSetupWrite,
} from "@/lib/registries/isometric/setup-write";
import { SubmitBlockedError } from "@/lib/registries/isometric/write";
import {
  preferredCertifyProjectId,
  resolveCredentials,
  resolveOrgCredentials,
  resolveOwnedProject,
} from "@/lib/registries/server";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message, ok: false },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

async function readFiles(form: FormData): Promise<
  { name: string; type: string; bytes: Uint8Array }[]
> {
  const files: { name: string; type: string; bytes: Uint8Array }[] = [];
  for (const value of form.getAll("file")) {
    if (!(value instanceof File) || value.size === 0) continue;
    files.push({
      name: value.name,
      type: value.type,
      bytes: new Uint8Array(await value.arrayBuffer()),
    });
  }
  return files;
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
      bundledSetup(project.id, project.id, "Not an Isometric project."),
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const connection = findConnection(tenantId, project.registry, project.id);
  if (!connection) {
    return Response.json(
      bundledSetup(project.id, project.id, "No Isometric connection for this tenant."),
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const credentials = resolveOrgCredentials(connection);
  const certifyId = scopedCertifyId(project) ?? preferredCertifyProjectId(connection);
  if (!credentials || !certifyId) {
    return Response.json(
      bundledSetup(
        project.id,
        certifyId ?? project.id,
        `Set ${connection.credentials.accessTokenEnv} and ${connection.credentials.clientSecretEnv} to read project setup from Certify.`,
      ),
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    const snapshot = await fetchProjectSetup({
      environment: connection.environment,
      catalogProjectId: project.id,
      certifyProjectId: certifyId,
      methodologyKey: project.methodologyKey,
      credentials,
    });
    return Response.json(snapshot, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup read failed";
    return Response.json(bundledSetup(project.id, certifyId, message), {
      headers: { "cache-control": "private, no-store" },
    });
  }
}

export async function POST(request: Request) {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }

  const form = await request.formData();
  const catalogProjectId = String(form.get("project_id") ?? "").trim();
  if (!catalogProjectId) return jsonError("project_id is required", 400);

  const project = resolveOwnedProject(tenantId, catalogProjectId);
  if (!project) return jsonError("Unknown project", 404);
  if (project.registry !== "Isometric") {
    return jsonError("Certify write is only wired for Isometric", 409);
  }

  const connection = findConnection(tenantId, project.registry, project.id);
  if (!connection) return jsonError("No Isometric connection for this tenant", 409);

  let payload: SetupAction | null = null;
  try {
    payload = parseSetupAction(JSON.parse(String(form.get("payload") ?? "null")));
  } catch {
    payload = null;
  }
  if (!payload) return jsonError("payload is required", 400);

  const credentials = resolveCredentials(connection, {
    externalProjectId: scopedCertifyId(project),
  });
  if (!credentials) {
    return jsonError(
      "Set ISOMETRIC_ACCESS_TOKEN, ISOMETRIC_CLIENT_SECRET and ISOMETRIC_PROJECT_ID to write to Certify",
      409,
    );
  }

  try {
    const result = await submitSetupWrite({
      environment: connection.environment,
      credentials,
      catalogProjectId,
      methodologyKey: project.methodologyKey,
      files: await readFiles(form),
      payload,
    });
    return Response.json(result, {
      status: result.ok ? 200 : 409,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof SubmitBlockedError) {
      return jsonError(error.message, 409);
    }
    const message = error instanceof Error ? error.message : "Certify write failed";
    return jsonError(message, 502);
  }
}
