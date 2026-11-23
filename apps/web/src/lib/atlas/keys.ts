import { registrySlug } from "@/lib/stream-schema";
import type { Registry } from "@/lib/types";

/**
 * Where the Atlas keeps its data. One DynamoDB table (pk + sk, each item's
 * fields as JSON in `doc`) and one S3 bucket for documents and binary assets.
 * The seed scripts and the server both build their keys here.
 *
 * Table
 *   CATALOG              TENANT#<tenant>                 a tenant
 *   CATALOG              PROJECT#<tenant>#<project>      a catalogue project
 *   CATALOG              LOCATION#<project>              an operator's map pin for a project
 *   PROJECT#<project>    SITEMODEL#CURRENT               the project's live 3D model: its manifest
 *   PROJECT#<project>    SITEMODEL#v0001                 every published version, kept
 *   SCENARIO             SCENARIO#<scenario>             a practice journey's starting point
 *   USER#<tenant>#<user> PRACTICE#<scenario>             one person's practice journey
 *   USER#<tenant>#<user> CORTEX_STAGED                   files and details staged for Cortex, not yet sent
 *
 * Bucket
 *   site-models/<tenant>/<project>/v<n>/manifest.json    what the version holds, with hashes
 *   site-models/<tenant>/<project>/v<n>/layout.json      the scene: objects, flows, supply, subsurface
 *   site-models/<tenant>/<project>/v<n>/assets/…         photos, textures, glTF meshes
 *   mrv/<tenant>/<registry>/<project>.json               a project's seeded monitoring history, registry named as the stream bucket names it
 */

export const CATALOG_PK = "CATALOG";
export const SCENARIO_PK = "SCENARIO";
export const SITE_MODEL_CURRENT = "SITEMODEL#CURRENT";

export const tenantSk = (tenantId: string) => `TENANT#${tenantId}`;
export const projectSk = (tenantId: string, projectId: string) => `PROJECT#${tenantId}#${projectId}`;
export const locationSk = (projectId: string) => `LOCATION#${projectId}`;
export const projectPk = (projectId: string) => `PROJECT#${projectId}`;
export const siteModelVersionSk = (version: number) => `SITEMODEL#v${String(version).padStart(4, "0")}`;
export const scenarioSk = (scenarioId: string) => `SCENARIO#${scenarioId}`;
export const userPk = (tenantId: string, userId: string) => `USER#${tenantId}#${userId}`;
export const practiceSk = (scenarioId: string) => `PRACTICE#${scenarioId}`;
export const CORTEX_STAGED_SK = "CORTEX_STAGED";

export function siteModelPrefix(tenantId: string, projectId: string, version: number): string {
  return `site-models/${tenantId}/${projectId}/v${version}`;
}

export function mrvKey(tenantId: string, registry: Registry, projectId: string): string {
  return `mrv/${tenantId}/${registrySlug(registry)}/${projectId}.json`;
}
