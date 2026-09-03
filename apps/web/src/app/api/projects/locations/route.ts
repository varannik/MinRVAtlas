import type { NextRequest } from "next/server";

import { PROJECTS } from "@/lib/projects";
import {
  parseLatitude,
  parseLongitude,
} from "@/lib/project-locations";
import {
  readLocationOverlay,
  upsertProjectLocation,
} from "@/lib/project-locations.server";
import { TENANTS } from "@/lib/tenants";

export const dynamic = "force-dynamic";

function unauthorized(message: string) {
  return Response.json({ error: message }, { status: 403 });
}

function resolveTenant(request: NextRequest) {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return null;
  }
  return tenantId;
}

function ownedProjectIds(tenantId: string): Set<string> {
  return new Set(
    PROJECTS.filter((project) => project.tenantId === tenantId).map(
      (project) => project.id,
    ),
  );
}

export async function GET(request: NextRequest) {
  const tenantId = resolveTenant(request);
  if (!tenantId) return unauthorized("Unknown tenant");

  const allowed = ownedProjectIds(tenantId);
  const overlay = await readLocationOverlay();
  const locations = Object.fromEntries(
    Object.entries(overlay).filter(([projectId]) => allowed.has(projectId)),
  );

  return Response.json(
    { locations },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PUT(request: NextRequest) {
  const tenantId = resolveTenant(request);
  if (!tenantId) return unauthorized("Unknown tenant");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON body is required" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "JSON body is required" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const projectId =
    typeof record.projectId === "string" ? record.projectId : "";
  const project = PROJECTS.find((candidate) => candidate.id === projectId);
  if (!project) {
    return Response.json({ error: "Unknown project" }, { status: 404 });
  }
  if (project.tenantId !== tenantId) {
    return unauthorized("Project belongs to another tenant");
  }

  const lat = parseLatitude(record.lat);
  const lng = parseLongitude(record.lng);
  if (lat === null || lng === null) {
    return Response.json(
      { error: "lat must be -90..90 and lng must be -180..180" },
      { status: 400 },
    );
  }

  const location = {
    lat,
    lng,
    updatedAt: new Date().toISOString(),
  };
  const overlay = await upsertProjectLocation(project.id, location);
  const allowed = ownedProjectIds(tenantId);
  const locations = Object.fromEntries(
    Object.entries(overlay).filter(([id]) => allowed.has(id)),
  );

  return Response.json(
    { location, locations },
    { headers: { "cache-control": "private, no-store" } },
  );
}
