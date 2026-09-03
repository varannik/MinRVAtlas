import "server-only";

import { PROJECTS } from "@/lib/projects";
import { TENANTS } from "@/lib/tenants";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export class SentinelProjectMapError extends Error {
  readonly localId: string;

  constructor(localId: string) {
    super(
      `No Sentinel UUID mapped for catalog project "${localId}". Set SENTINEL_PROJECT_ID (Fujairah) or SENTINEL_PROJECT_MAP.`,
    );
    this.name = "SentinelProjectMapError";
    this.localId = localId;
  }
}

export type SentinelConfig = {
  baseUrl: string;
  serviceToken: string;
  tenantId: string;
  projectMap: Record<string, string>;
};

function parseProjectMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const fujairah = process.env.SENTINEL_PROJECT_ID?.trim();
  if (fujairah && isUuid(fujairah)) {
    map["fujairah-mineral"] = fujairah;
  }

  const raw = process.env.SENTINEL_PROJECT_MAP?.trim();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [localId, value] of Object.entries(parsed)) {
      if (typeof value === "string" && isUuid(value)) {
        map[localId] = value;
      }
    }
  } catch {
    // Keep the single-id mapping if JSON is malformed.
  }
  return map;
}

function isLocalSentinelHost(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function getSentinelConfig(): SentinelConfig {
  const baseUrl = (process.env.SENTINEL_BASE_URL ?? "http://localhost:8000").replace(
    /\/$/,
    "",
  );
  const fromEnv = process.env.SENTINEL_SERVICE_TOKEN?.trim() ?? "";
  const serviceToken =
    fromEnv || (isLocalSentinelHost(baseUrl) ? "local-sentinel-m2m-token" : "");
  return {
    baseUrl,
    serviceToken,
    tenantId: process.env.SENTINEL_TENANT_ID?.trim() || "fourfourone",
    projectMap: parseProjectMap(),
  };
}

export function isCatalogProjectId(value: string): boolean {
  return PROJECTS.some((project) => project.id === value);
}

export function mapCatalogProjectId(
  localId: string,
  projectMap: Record<string, string>,
): string {
  const mapped = projectMap[localId];
  if (!mapped) throw new SentinelProjectMapError(localId);
  return mapped;
}

export function resolveRequestTenant(request: Request): string | null {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return null;
  }
  return tenantId;
}
