import "server-only";

import {
  catalogProjectName,
  getSentinelConfig,
  isCatalogProjectId,
  isUuid,
  SentinelProjectMapError,
} from "./config";

type SentinelProjectRow = {
  id?: string;
  name?: string;
  description?: string | null;
  config?: Record<string, unknown> | null;
};

const ensurePromises = new Map<string, Promise<string>>();
const resolvedMap: Record<string, string> = {};

function catalogIdFromRow(project: SentinelProjectRow): string | null {
  const tags = project.config?.tags;
  if (tags && typeof tags === "object" && !Array.isArray(tags)) {
    const catalogId = (tags as Record<string, unknown>).catalog_id;
    if (typeof catalogId === "string" && catalogId) return catalogId;
  }
  if (typeof project.description === "string") {
    const match = /catalog:([^\s|]+)/i.exec(project.description);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function listSentinelProjects(): Promise<SentinelProjectRow[]> {
  const config = getSentinelConfig();
  const url = new URL("api/v1/projects", `${config.baseUrl}/`);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${config.serviceToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Sentinel project list failed (${response.status})`);
  }
  const json = (await response.json()) as unknown;
  return Array.isArray(json) ? (json as SentinelProjectRow[]) : [];
}

async function createEmptySentinelProject(
  catalogId: string,
  name: string,
): Promise<string> {
  const config = getSentinelConfig();
  const url = new URL("api/v1/projects", `${config.baseUrl}/`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.serviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      description: `3DMinRV catalog:${catalogId}`,
      domain: "ccs",
      config: { tags: { catalog_id: catalogId } },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new SentinelProjectMapError(catalogId);
  }
  const json = (await response.json()) as { id?: string };
  if (!json.id || !isUuid(json.id)) {
    throw new SentinelProjectMapError(catalogId);
  }
  return json.id;
}

async function findOrCreate(catalogId: string, name?: string): Promise<string> {
  const pinned = getSentinelConfig().projectMap[catalogId];
  if (pinned) return pinned;

  const projects = await listSentinelProjects();
  const tagged = projects.find(
    (project) => catalogIdFromRow(project) === catalogId,
  );
  if (tagged?.id && isUuid(tagged.id)) return tagged.id;

  return createEmptySentinelProject(
    catalogId,
    name?.trim() || catalogProjectName(catalogId),
  );
}

/**
 * Resolve a control-room / Certify id to a Sentinel UUID.
 * Creates an empty Sentinel project (no rules, no datasets) on first use.
 */
export async function ensureSentinelUuid(
  catalogId: string,
  name?: string,
): Promise<string> {
  if (isUuid(catalogId)) return catalogId;
  if (!isCatalogProjectId(catalogId)) {
    throw new SentinelProjectMapError(catalogId);
  }

  if (resolvedMap[catalogId]) return resolvedMap[catalogId];

  let pending = ensurePromises.get(catalogId);
  if (!pending) {
    pending = findOrCreate(catalogId, name);
    ensurePromises.set(catalogId, pending);
  }

  try {
    const id = await pending;
    resolvedMap[catalogId] = id;
    return id;
  } finally {
    ensurePromises.delete(catalogId);
  }
}
