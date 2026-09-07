import { countryFromIso3 } from "@/lib/iso-geo";
import { PROJECTS } from "@/lib/projects";
import type { CertifyProject } from "@/lib/registries/isometric/api";
import type { Project } from "@/lib/types";

function looksLikeFujairah(row: CertifyProject): boolean {
  const hay = `${row.name} ${row.short_description ?? ""} ${row.description ?? ""}`.toLowerCase();
  return hay.includes("fujairah") || hay.includes("peridotite");
}

function asLiveProject(tenantId: string, row: CertifyProject): Project {
  const geo = countryFromIso3(row.country_code);
  return {
    id: row.id,
    tenantId,
    name: row.name,
    country: geo.name,
    region: row.short_description?.slice(0, 48) || geo.name,
    lat: geo.lat,
    lng: geo.lng,
    status: "monitoring",
    registry: "Isometric",
    methodology: "Isometric Certify",
    methodologyKey: "isometric-certify",
    afolu: false,
    developer: "Isometric organisation",
    hectares: 0,
    creditsIssued: 0,
    annualForecast: 0,
    vintage: new Date().getUTCFullYear(),
    sensors: 0,
    lastSyncMinutes: 0,
    bufferPct: 2,
    creditingStart: 0,
    creditingYears: 15,
    createdOn: row.created_at?.slice(0, 10),
    origin: "isometric",
    externalProjectId: row.id,
  };
}

function aliasCatalog(
  tenantId: string,
  row: CertifyProject,
  catalog: Project,
): Project {
  const geo = countryFromIso3(row.country_code);
  return {
    ...catalog,
    name: row.name || catalog.name,
    country: geo.name || catalog.country,
    origin: "isometric",
    externalProjectId: row.id,
    createdOn: row.created_at?.slice(0, 10) ?? catalog.createdOn,
  };
}

/**
 * At most one Certify row may reuse a catalog id (Fujairah pin). Prefer a
 * name match, else the preferred `prj_…` from env.
 */
export function mapCertifyProjects(
  tenantId: string,
  rows: CertifyProject[],
  preferredExternalId?: string | null,
): Project[] {
  const catalog = PROJECTS.find(
    (project) =>
      project.tenantId === tenantId && project.id === "fujairah-mineral",
  );
  const aliasRow =
    rows.find((row) => looksLikeFujairah(row)) ??
    (preferredExternalId
      ? rows.find((row) => row.id === preferredExternalId)
      : undefined);

  const seen = new Set<string>();
  const mapped: Project[] = [];
  for (const row of rows) {
    const project =
      catalog && aliasRow && row.id === aliasRow.id
        ? aliasCatalog(tenantId, row, catalog)
        : asLiveProject(tenantId, row);
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    mapped.push(project);
  }
  return mapped;
}

export function mapCertifyProject(
  tenantId: string,
  row: CertifyProject,
  preferredExternalId?: string | null,
): Project {
  return (
    mapCertifyProjects(tenantId, [row], preferredExternalId)[0] ??
    asLiveProject(tenantId, row)
  );
}

export function uniqueProjects(projects: Project[]): Project[] {
  const seen = new Set<string>();
  const next: Project[] = [];
  for (const project of projects) {
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    next.push(project);
  }
  return next;
}
