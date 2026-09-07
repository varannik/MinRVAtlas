import type { NextRequest } from "next/server";

import { emptyAccounting, type AccountingSnapshot } from "@/lib/accounting";
import { scopedCertifyId } from "@/lib/iso-geo";
import { findConnection } from "@/lib/registries";
import { fetchAccountingSnapshot } from "@/lib/registries/isometric/server";
import {
  SubmitBlockedError,
  createGhgEntry,
  createGhgStatement,
  type GhgEntryComponentDraft,
} from "@/lib/registries/isometric/write";
import {
  resolveCredentials,
  resolveOwnedProject,
} from "@/lib/registries/server";
import type { PipelineResult } from "@/lib/sentinel/pipeline-types";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message, ok: false },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

function parsePipeline(raw: string): PipelineResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PipelineResult;
    if (!parsed || typeof parsed !== "object" || !parsed.engines) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseComponents(raw: string): GhgEntryComponentDraft[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as GhgEntryComponentDraft[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row) => row && typeof row.componentId === "string" && Array.isArray(row.inputs),
    );
  } catch {
    return [];
  }
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
  const periodStart = request.nextUrl.searchParams.get("periodStart");
  const periodEnd = request.nextUrl.searchParams.get("periodEnd");
  if (!projectId || !periodStart || !periodEnd) {
    return jsonError("projectId, periodStart and periodEnd are required", 400);
  }

  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }

  const project = resolveOwnedProject(tenantId, projectId);
  if (!project) return jsonError("Unknown project", 404);
  if (project.registry !== "Isometric") {
    return Response.json(emptyAccounting("Not an Isometric project."), {
      headers: { "cache-control": "private, no-store" },
    });
  }

  const connection = findConnection(tenantId, project.registry, project.id);
  if (!connection) {
    return Response.json(
      emptyAccounting("No Isometric connection for this tenant."),
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const credentials = resolveCredentials(connection, {
    externalProjectId: scopedCertifyId(project),
  });
  if (!credentials) {
    return Response.json(
      emptyAccounting(
        `Set ${connection.credentials.accessTokenEnv} and ${connection.credentials.clientSecretEnv} to read GHG templates from Certify.`,
      ),
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    const snapshot: AccountingSnapshot = await fetchAccountingSnapshot(
      connection.environment,
      credentials.externalProjectId,
      credentials,
      periodStart,
      periodEnd,
    );
    return Response.json(snapshot, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Accounting read failed";
    return Response.json(emptyAccounting(message), {
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
  const action = String(form.get("action") ?? "").trim();
  const catalogProjectId = String(form.get("project_id") ?? "").trim();
  const batchId = String(form.get("batch_id") ?? "").trim();
  if (!catalogProjectId || !batchId) {
    return jsonError("project_id and batch_id are required", 400);
  }

  const project = resolveOwnedProject(tenantId, catalogProjectId);
  if (!project) return jsonError("Unknown project", 404);
  if (project.registry !== "Isometric") {
    return jsonError("Certify write is only wired for Isometric", 409);
  }

  const connection = findConnection(tenantId, project.registry, project.id);
  if (!connection) return jsonError("No Isometric connection for this tenant", 409);

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
    if (action === "create-statement") {
      const endOn = String(form.get("end_on") ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endOn)) {
        return jsonError("end_on must be YYYY-MM-DD", 400);
      }
      const result = await createGhgStatement({
        environment: connection.environment,
        credentials,
        endOn,
      });
      return Response.json(result, {
        status: result.ok ? 200 : 409,
        headers: { "cache-control": "private, no-store" },
      });
    }

    if (action === "create-entry") {
      const templateId = String(form.get("template_id") ?? "").trim();
      const startedOn = String(form.get("started_on") ?? "").trim();
      const completedOn = String(form.get("completed_on") ?? "").trim();
      const pipeline = parsePipeline(String(form.get("pipeline") ?? ""));
      if (!templateId || !startedOn || !completedOn || !pipeline) {
        return jsonError(
          "template_id, started_on, completed_on and a quality pipeline are required",
          400,
        );
      }
      const result = await createGhgEntry({
        tenantId,
        catalogProjectId,
        batchId,
        templateId,
        startedOn,
        completedOn,
        notes: String(form.get("notes") ?? ""),
        periodEnd: completedOn,
        pipeline,
        files: await readFiles(form),
        components: parseComponents(String(form.get("components") ?? "")),
        environment: connection.environment,
        credentials,
      });
      return Response.json(result, {
        status: result.ok ? 200 : 409,
        headers: { "cache-control": "private, no-store" },
      });
    }

    return jsonError("Unknown action", 400);
  } catch (error) {
    if (error instanceof SubmitBlockedError) {
      return jsonError(error.message, 409);
    }
    const message =
      error instanceof Error ? error.message : "Certify accounting write failed";
    return jsonError(message, 502);
  }
}
