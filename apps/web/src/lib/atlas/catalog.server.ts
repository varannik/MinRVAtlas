import "server-only";

import { parseLatitude, parseLongitude, type LocationOverlay, type SiteLocation } from "@/lib/project-locations";
import type { Project, Tenant } from "@/lib/types";
import { CATALOG_PK, locationSk } from "./keys";
import { deleteDoc, putDoc, queryDocs } from "./store.server";

/**
 * The catalogue: tenants and their projects, from the Atlas table. Read often
 * and changed rarely, so kept for a short while in memory; a change made here
 * clears it straight away.
 */

const TTL_MS = 30_000;
let cached: { at: number; tenants: Tenant[]; projects: Project[] } | null = null;

async function load() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  const [tenants, projects] = await Promise.all([queryDocs<Tenant>(CATALOG_PK, "TENANT#"), queryDocs<Project>(CATALOG_PK, "PROJECT#")]);
  cached = {
    at: Date.now(),
    tenants: tenants.map((row) => row.stored.doc),
    projects: projects.map((row) => ({ ...row.stored.doc, origin: "catalog" as const })),
  };
  return cached;
}

export async function listTenants(): Promise<Tenant[]> {
  return (await load()).tenants;
}

export async function isKnownTenant(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  return (await load()).tenants.some((tenant) => tenant.id === tenantId);
}

/** Every catalogue project, or one tenant's. */
export async function listProjects(tenantId?: string): Promise<Project[]> {
  const { projects } = await load();
  return tenantId ? projects.filter((project) => project.tenantId === tenantId) : projects;
}

export async function findProject(projectId: string | null | undefined): Promise<Project | null> {
  if (!projectId) return null;
  return (await load()).projects.find((project) => project.id === projectId) ?? null;
}

// ── Map pins ─────────────────────────────────────────────────────────────────

/** Operator-entered pins, by project id. */
export async function readLocations(): Promise<LocationOverlay> {
  const rows = await queryDocs<SiteLocation>(CATALOG_PK, "LOCATION#");
  return Object.fromEntries(rows.map((row) => [row.sk.slice("LOCATION#".length), row.stored.doc]));
}

export async function writeLocation(projectId: string, lat: unknown, lng: unknown): Promise<SiteLocation | null> {
  const latitude = parseLatitude(lat);
  const longitude = parseLongitude(lng);
  if (latitude === null || longitude === null) return null;
  const location: SiteLocation = { lat: latitude, lng: longitude, updatedAt: new Date().toISOString() };
  await putDoc(CATALOG_PK, locationSk(projectId), location);
  return location;
}

export async function clearLocation(projectId: string): Promise<void> {
  await deleteDoc(CATALOG_PK, locationSk(projectId));
}
