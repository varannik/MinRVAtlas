import type { NextRequest } from "next/server";

import { assemblePeriodCsv } from "@/lib/registries/isometric/ghg-s3";
import { resolveOwnedProject } from "@/lib/registries/server";
import {
  AssembleTooLargeError,
  buildCoverage,
  parseAttributesJson,
  parseObservationsCsv,
  type StreamCoverage,
} from "@/lib/stream-coverage";
import { requiredFor, sourcePrefix } from "@/lib/stream-schema";
import {
  getObjectText,
  getPrefixObject,
  listObservationKeys,
  streamConfigured,
} from "@/lib/stream-s3";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return Response.json(
    { error: message, ok: false, ...extra },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

function readWindow(request: NextRequest, body?: Record<string, unknown>) {
  const projectId =
    (typeof body?.projectId === "string" && body.projectId) ||
    request.nextUrl.searchParams.get("projectId") ||
    "";
  const periodStart =
    (typeof body?.periodStart === "string" && body.periodStart) ||
    request.nextUrl.searchParams.get("periodStart") ||
    "";
  const periodEnd =
    (typeof body?.periodEnd === "string" && body.periodEnd) ||
    request.nextUrl.searchParams.get("periodEnd") ||
    "";
  return { projectId, periodStart, periodEnd };
}

function validDates(start: string, end: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
}

async function loadWindow(
  input: {
    tenantId: string;
    projectId: string;
    periodStart: string;
    periodEnd: string;
  },
  assemble: boolean,
): Promise<
  | { error: string; status: number }
  | {
      coverage: StreamCoverage;
      csv: string;
      keys: { key: string; day: string; size: number }[];
      filename: string;
    }
> {
  const project = resolveOwnedProject(input.tenantId, input.projectId);
  if (!project) return { error: "Unknown project", status: 403 };
  if (project.registry !== "Isometric") {
    return { error: "Stream GHG fetch is Isometric-desk only", status: 403 };
  }

  const prefix = sourcePrefix(project.tenantId, project.registry, project.id);
  const contract = requiredFor(project);
  const schemaText = await getPrefixObject(
    project.tenantId,
    project.registry,
    project.id,
    "_schema.json",
  );
  const liveContract = schemaText
    ? {
        ...contract,
        ...(() => {
          try {
            const parsed = JSON.parse(schemaText) as Partial<typeof contract>;
            return {
              cadence: typeof parsed.cadence === "string" ? parsed.cadence : contract.cadence,
              requiredSeries: Array.isArray(parsed.requiredSeries)
                ? parsed.requiredSeries.filter((row): row is string => typeof row === "string")
                : contract.requiredSeries,
              requiredAttributes: Array.isArray(parsed.requiredAttributes)
                ? parsed.requiredAttributes.filter((row): row is string => typeof row === "string")
                : contract.requiredAttributes,
            };
          } catch {
            return {};
          }
        })(),
      }
    : contract;

  const keys = await listObservationKeys({
    tenantId: project.tenantId,
    registry: project.registry,
    projectId: project.id,
    from: input.periodStart,
    to: input.periodEnd,
  });
  const observations = (
    await Promise.all(keys.map((row) => getObjectText(row.key, prefix)))
  ).flatMap((text) => parseObservationsCsv(text));
  const attributesText = await getPrefixObject(
    project.tenantId,
    project.registry,
    project.id,
    "attributes.json",
  );
  const attributes = parseAttributesJson(attributesText ?? "{}");
  const coverage = buildCoverage({
    contract: liveContract,
    daysPresent: keys.map((row) => row.day),
    observations,
    attributes,
    from: input.periodStart,
    to: input.periodEnd,
  });
  const csv = assemble
    ? assemblePeriodCsv(observations, attributes, input.periodStart, input.periodEnd)
    : "";
  return {
    coverage,
    csv,
    keys,
    filename: `stream-${project.id}-${input.periodStart}-${input.periodEnd}.csv`,
  };
}

export async function GET(request: NextRequest) {
  if (!streamConfigured()) {
    return jsonError("Stream source is not configured", 503);
  }
  const { projectId, periodStart, periodEnd } = readWindow(request);
  if (!projectId || !periodStart || !periodEnd) {
    return jsonError("projectId, periodStart and periodEnd are required", 400);
  }
  if (!validDates(periodStart, periodEnd)) {
    return jsonError("periodStart and periodEnd must be YYYY-MM-DD with start ≤ end", 400);
  }
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }
  const clientRegistry = request.nextUrl.searchParams.get("registry");
  const owned = resolveOwnedProject(tenantId, projectId);
  if (!owned) return jsonError("Unknown project", 403);
  if (clientRegistry && clientRegistry !== owned.registry) {
    return jsonError("registry does not match the project", 403);
  }
  try {
    const result = await loadWindow({ tenantId, projectId, periodStart, periodEnd }, false);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json(
      {
        ok: true,
        coverage: result.coverage,
        objects: result.keys,
        rowHint: result.coverage.daysPresent.length,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AssembleTooLargeError) return jsonError(error.message, 413);
    const message = error instanceof Error ? error.message : "Stream fetch failed";
    return jsonError(message, 502);
  }
}

export async function POST(request: NextRequest) {
  if (!streamConfigured()) {
    return jsonError("Stream source is not configured", 503);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const { projectId, periodStart, periodEnd } = readWindow(request, body);
  if (!projectId || !periodStart || !periodEnd) {
    return jsonError("projectId, periodStart and periodEnd are required", 400);
  }
  if (!validDates(periodStart, periodEnd)) {
    return jsonError("periodStart and periodEnd must be YYYY-MM-DD with start ≤ end", 400);
  }
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }
  if (typeof body.registry === "string") {
    const owned = resolveOwnedProject(tenantId, projectId);
    if (!owned) return jsonError("Unknown project", 403);
    if (body.registry !== owned.registry) {
      return jsonError("registry does not match the project", 403);
    }
  }
  try {
    const result = await loadWindow({ tenantId, projectId, periodStart, periodEnd }, true);
    if ("error" in result) return jsonError(result.error, result.status);
    if (result.keys.length === 0) {
      return jsonError("No stream objects in this period", 404, { coverage: result.coverage });
    }
    return Response.json(
      {
        ok: true,
        filename: result.filename,
        csv: result.csv,
        coverage: result.coverage,
        rowCount: Math.max(0, result.csv.trim().split(/\n/).length - 1),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AssembleTooLargeError) return jsonError(error.message, 413);
    const message = error instanceof Error ? error.message : "Stream fetch failed";
    return jsonError(message, 502);
  }
}
