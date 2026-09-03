import { PROJECTS } from "@/lib/projects";
import { TENANTS } from "@/lib/tenants";
import type { ItemKind } from "@/lib/types";
import { getSentinelConfig } from "@/lib/sentinel/config";
import { runOperatorPipeline } from "@/lib/sentinel/pipeline";

/**
 * Orchestrated quality job for one requirement + batch.
 * The popup must not call Sentinel engines itself.
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
    { error: message },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }
  if (tenantId !== getSentinelConfig().tenantId) {
    return jsonError("Sentinel is not provisioned for this tenant", 403);
  }

  const form = await request.formData();
  const catalogProjectId = String(form.get("project_id") ?? "").trim();
  const slotId = String(form.get("slot_id") ?? "").trim();
  const batchId = String(form.get("batch_id") ?? "").trim();
  const kind = String(form.get("kind") ?? "").trim() as ItemKind;
  const label = String(form.get("label") ?? "").trim();
  const notes = String(form.get("notes") ?? "");
  const periodStart = String(form.get("period_start") ?? "").trim();
  const periodEnd = String(form.get("period_end") ?? "").trim();

  if (!catalogProjectId || !slotId || !batchId || !KINDS.has(kind)) {
    return jsonError("project_id, slot_id, batch_id and kind are required", 400);
  }

  const project = PROJECTS.find((entry) => entry.id === catalogProjectId);
  if (!project) return jsonError("Unknown project", 404);
  if (project.tenantId !== tenantId) {
    return jsonError("Project belongs to another tenant", 403);
  }

  const files: { name: string; type: string; bytes: Uint8Array }[] = [];
  for (const value of form.getAll("file")) {
    if (!(value instanceof File) || value.size === 0) continue;
    files.push({
      name: value.name,
      type: value.type,
      bytes: new Uint8Array(await value.arrayBuffer()),
    });
  }

  try {
    const result = await runOperatorPipeline({
      tenantId,
      catalogProjectId,
      slotId,
      batchId,
      kind,
      label: label || kind,
      notes,
      origin: "operator-upload",
      files,
      periodStart: periodStart || undefined,
      periodEnd: periodEnd || undefined,
    });
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline failed";
    return jsonError(message, 502);
  }
}
