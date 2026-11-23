import type { NextRequest } from "next/server";

import { isKnownTenant, listProjects, readLocations, writeLocation } from "@/lib/atlas/catalog.server";
import { atlasFailure } from "@/lib/atlas/access.server";
import { isCertifyProjectId } from "@/lib/iso-geo";
import { findConnection } from "@/lib/registries";

/**
 * Operator-entered map pins, kept in the Atlas table.
 * GET: this tenant's pins. PUT { projectId, lat, lng }: set one.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

function unauthorized(message: string) {
  return Response.json({ error: message }, { status: 403 });
}

async function resolveTenant(request: NextRequest): Promise<string | null> {
  const tenantId = request.headers.get("x-tenant-id");
  return tenantId && (await isKnownTenant(tenantId)) ? tenantId : null;
}

/** The tenant's catalogue projects, and any Certify project its connection reads. */
async function ownedIds(tenantId: string, candidates: string[]): Promise<Set<string>> {
  const ids = new Set((await listProjects(tenantId)).map((project) => project.id));
  for (const id of candidates) {
    if (isCertifyProjectId(id) && findConnection(tenantId, "Isometric", id)) ids.add(id);
  }
  return ids;
}

async function tenantLocations(tenantId: string) {
  const overlay = await readLocations();
  const allowed = await ownedIds(tenantId, Object.keys(overlay));
  return Object.fromEntries(Object.entries(overlay).filter(([projectId]) => allowed.has(projectId)));
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = await resolveTenant(request);
    if (!tenantId) return unauthorized("Unknown tenant");
    return Response.json({ locations: await tenantLocations(tenantId) }, { headers: NO_STORE });
  } catch (error) {
    return atlasFailure(error, "project locations read");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const tenantId = await resolveTenant(request);
    if (!tenantId) return unauthorized("Unknown tenant");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return Response.json({ error: "JSON body is required" }, { status: 400 });

    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!(await ownedIds(tenantId, [projectId])).has(projectId)) {
      return Response.json({ error: "Unknown project" }, { status: 404 });
    }

    const location = await writeLocation(projectId, body.lat, body.lng);
    if (!location) return Response.json({ error: "lat must be -90..90 and lng must be -180..180" }, { status: 400 });

    return Response.json({ location, locations: await tenantLocations(tenantId) }, { headers: NO_STORE });
  } catch (error) {
    return atlasFailure(error, "project location write");
  }
}
