import { PROJECTS } from "@/lib/projects";
import { findConnection } from "@/lib/registries";
import { resolveCredentials } from "@/lib/registries/server";
import { slotSubmitBlockReason } from "@/lib/registries/submit-gate";
import {
  SubmitBlockedError,
  submitGhgStatement,
  submitSlot,
  type DatapointDraft,
  type GhgWriteResult,
  type SlotWriteResult,
} from "@/lib/registries/isometric/write";
import type { PipelineResult } from "@/lib/sentinel/pipeline-types";
import { TENANTS } from "@/lib/tenants";
import type { ItemKind } from "@/lib/types";

/**
 * Explicit Certify write. The quality pipeline never calls this.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KINDS = new Set<ItemKind>([
  "document",
  "dataset",
  "sensor-stream",
  "attestation",
]);

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
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.engines || typeof parsed.engines !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseDatapoints(raw: string): DatapointDraft[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as DatapointDraft[];
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (row) =>
        row &&
        typeof row.display_name === "string" &&
        typeof row.magnitude === "number" &&
        typeof row.unit === "string",
    );
  } catch {
    return undefined;
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

export async function POST(request: Request) {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }

  const form = await request.formData();
  const target = String(form.get("target") ?? "slot").trim();
  const catalogProjectId = String(form.get("project_id") ?? "").trim();
  const batchId = String(form.get("batch_id") ?? "").trim();

  if (!catalogProjectId || !batchId) {
    return jsonError("project_id and batch_id are required", 400);
  }

  const project = PROJECTS.find((entry) => entry.id === catalogProjectId);
  if (!project) return jsonError("Unknown project", 404);
  if (project.tenantId !== tenantId) {
    return jsonError("Project belongs to another tenant", 403);
  }
  if (project.registry !== "Isometric") {
    return jsonError("Certify write is only wired for Isometric", 409);
  }

  const connection = findConnection(tenantId, project.registry, project.id);
  if (!connection) {
    return jsonError("No Isometric connection for this tenant", 409);
  }

  try {
    if (target === "ghg") {
      const credentials = resolveCredentials(connection);
      if (!credentials) {
        return jsonError(
          "Set ISOMETRIC_ACCESS_TOKEN, ISOMETRIC_CLIENT_SECRET and ISOMETRIC_PROJECT_ID to write to Certify",
          409,
        );
      }
      const result: GhgWriteResult = await submitGhgStatement({
        tenantId,
        catalogProjectId,
        batchId,
        reportUrl: String(form.get("ghg_statement_report_url") ?? "").trim(),
        submittedSlotIds: String(form.get("submitted_slot_ids") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
        mandatorySlotIds: String(form.get("mandatory_slot_ids") ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
        environment: connection.environment,
        credentials,
      });
      return Response.json(result, {
        status: result.ok ? 200 : 409,
        headers: { "cache-control": "private, no-store" },
      });
    }

    const slotId = String(form.get("slot_id") ?? "").trim();
    const kind = String(form.get("kind") ?? "").trim() as ItemKind;
    const label = String(form.get("label") ?? "").trim();
    const notes = String(form.get("notes") ?? "");
    const requirementId = String(form.get("requirement_id") ?? "").trim();
    const specOriginRaw = String(form.get("spec_origin") ?? "bundled").trim();
    const specOrigin =
      specOriginRaw === "registry-api" ? "registry-api" : "bundled";
    const pipeline = parsePipeline(String(form.get("pipeline") ?? ""));
    if (!slotId || !KINDS.has(kind) || !pipeline) {
      return jsonError("slot_id, kind and pipeline are required", 400);
    }

    const files = await readFiles(form);
    const blocked = slotSubmitBlockReason(pipeline, kind, label || kind, files.length);
    if (blocked) {
      return Response.json(
        {
          ok: false,
          blocked,
          sourceIds: [],
          datapointIds: [],
          submissionIds: [],
          warnings: [],
        },
        { status: 409, headers: { "cache-control": "private, no-store" } },
      );
    }

    const credentials = resolveCredentials(connection);
    if (!credentials) {
      return jsonError(
        "Set ISOMETRIC_ACCESS_TOKEN, ISOMETRIC_CLIENT_SECRET and ISOMETRIC_PROJECT_ID to write to Certify",
        409,
      );
    }

    const result: SlotWriteResult = await submitSlot({
      tenantId,
      catalogProjectId,
      slotId,
      batchId,
      kind,
      label: label || kind,
      notes,
      requirementId,
      specOrigin,
      periodStart: String(form.get("period_start") ?? "").trim() || undefined,
      periodEnd: String(form.get("period_end") ?? "").trim() || undefined,
      pipeline,
      files,
      datapoints: parseDatapoints(String(form.get("datapoints") ?? "")),
      environment: connection.environment,
      credentials,
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
