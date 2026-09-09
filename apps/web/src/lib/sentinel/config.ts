import "server-only";

import { isCertifyProjectId } from "@/lib/iso-geo";
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
      `No Sentinel project for catalog id "${localId}". ` +
        `Select an existing control-room project in Quality Console.`,
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
    // Ignore malformed optional override.
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

function baseSentinelConfig(): Omit<SentinelConfig, "projectMap"> {
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
  };
}

export function getSentinelConfig(): SentinelConfig {
  return {
    ...baseSentinelConfig(),
    projectMap: parseProjectMap(),
  };
}

export async function getSentinelConfigAsync(): Promise<SentinelConfig> {
  return getSentinelConfig();
}

export function isCatalogProjectId(value: string): boolean {
  return PROJECTS.some((project) => project.id === value) || isCertifyProjectId(value);
}

export function catalogProjectName(localId: string): string {
  return PROJECTS.find((project) => project.id === localId)?.name ?? localId;
}

export function resolveRequestTenant(request: Request): string | null {
  const tenantId = request.headers.get("x-tenant-id");
  if (!tenantId || !TENANTS.some((tenant) => tenant.id === tenantId)) {
    return null;
  }
  return tenantId;
}
