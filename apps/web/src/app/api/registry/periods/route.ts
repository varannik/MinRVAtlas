import type { NextRequest } from "next/server";

import { scopedCertifyId } from "@/lib/iso-geo";
import {
  formatPeriodLabel,
  type ReportingPeriod,
} from "@/lib/period-desk";
import { findConnection } from "@/lib/registries";
import { resolveCredentials, resolveOwnedProject } from "@/lib/registries/server";
import {
  listFiledPeriodWindows,
  withdrawPeriodEvidence,
} from "@/lib/registries/isometric/server";
import type { SubmissionStatus } from "@/lib/types";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

function statementStatus(raw: string | null | undefined): SubmissionStatus {
  const value = (raw ?? "").toLowerCase().replaceAll("_", "-");
  if (value.includes("fail") || value.includes("reject")) return "rejected";
  if (value.includes("issu") || value === "credits-issued") return "issued";
  if (value === "verified") return "issued";
  if (value.includes("verif") || value.includes("awaiting")) return "in-verification";
  if (value.includes("submit")) return "submitted";
  return "assembling";
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

  const connection = findConnection(tenantId, project.registry, project.id);
  if (!connection || project.registry !== "Isometric") {
    return Response.json(
      { periods: [], origin: "draft" as const },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const credentials = resolveCredentials(connection, {
    externalProjectId: scopedCertifyId(project),
  });
  if (!credentials) {
    return Response.json(
      { periods: [], origin: "draft" as const, warning: "credentials-missing" },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const listed = await listFiledPeriodWindows(
    connection.environment,
    credentials.externalProjectId,
    credentials,
  );

  const periods: ReportingPeriod[] = listed.windows.map((window, index) => ({
    id: window.id,
    projectId,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    periodLabel: formatPeriodLabel(window.periodStart, window.periodEnd),
    status: statementStatus(window.status),
    origin: "certify" as const,
    sequence: index + 1,
    ghgStatementId: window.ghgStatementId,
  }));

  return Response.json(
    {
      periods,
      origin: "certify" as const,
      warning: listed.warning,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function DELETE(request: NextRequest) {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return jsonError("Unknown tenant", 403);
  }

  const body = (await request.json().catch(() => null)) as {
    projectId?: string;
    periodStart?: string;
    periodEnd?: string;
    ghgStatementId?: string;
  } | null;

  const projectId = body?.projectId?.trim();
  const periodStart = body?.periodStart?.trim();
  const periodEnd = body?.periodEnd?.trim();
  if (!projectId || !periodStart || !periodEnd) {
    return jsonError("projectId, periodStart and periodEnd are required", 400);
  }

  const project = resolveOwnedProject(tenantId, projectId);
  if (!project) return jsonError("Unknown project", 404);

  const connection = findConnection(tenantId, project.registry, project.id);
  if (!connection || project.registry !== "Isometric") {
    return Response.json(
      { deletedSubmissions: 0, deletedEntries: 0, warnings: [] },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const credentials = resolveCredentials(connection, {
    externalProjectId: scopedCertifyId(project),
  });
  if (!credentials) {
    return jsonError("Registry credentials are missing", 400);
  }

  try {
    const result = await withdrawPeriodEvidence(
      connection.environment,
      credentials.externalProjectId,
      credentials,
      periodStart,
      periodEnd,
      body?.ghgStatementId?.trim() || undefined,
    );
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not withdraw period from Certify",
      502,
    );
  }
}
