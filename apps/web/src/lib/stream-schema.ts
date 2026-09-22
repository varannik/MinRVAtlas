import { GHG_ACCOUNTING_HEADERS } from "@/lib/ghg-csv-columns";
import { PROJECTS } from "@/lib/projects";
import { DQA_CANONICAL } from "@/lib/sentinel/column-map";
import type { Project, Registry } from "@/lib/types";

export const STREAM_REGISTRY_SLUGS = {
  isometric: "Isometric",
  puro: "Puro.earth",
  verra: "Verra VCS",
  "gold-standard": "Gold Standard",
} as const;

export type StreamRegistrySlug = keyof typeof STREAM_REGISTRY_SLUGS;

export const MAX_ASSEMBLED_CSV_BYTES = 50 * 1024 * 1024;

const SKIP_SERIES = new Set(["timestamp_utc", "operational_state", "batch_id"]);

export const INSITU_REQUIRED_SERIES = DQA_CANONICAL.filter(
  (name) => !SKIP_SERIES.has(name),
);

export type StreamContract = {
  schemaVersion: 1;
  kind: "timeseries";
  timezone: "UTC";
  cadence: string;
  registry: Registry;
  methodologyKey: string;
  requiredSeries: string[];
  requiredAttributes: string[];
};

export function registrySlug(registry: Registry): StreamRegistrySlug {
  switch (registry) {
    case "Isometric":
      return "isometric";
    case "Puro.earth":
      return "puro";
    case "Verra VCS":
      return "verra";
    case "Gold Standard":
      return "gold-standard";
  }
}

export function registryFromSlug(slug: string): Registry | null {
  const key = slug.trim().toLowerCase();
  if (key in STREAM_REGISTRY_SLUGS) {
    return STREAM_REGISTRY_SLUGS[key as StreamRegistrySlug];
  }
  return null;
}

export function sourcePrefix(
  tenantId: string,
  registry: Registry,
  projectId: string,
): string {
  return `${tenantId}/${registrySlug(registry)}/${projectId}/`;
}

export function assertKeyInPrefix(key: string, prefix: string): void {
  if (!key.startsWith(prefix) || key.includes("..")) {
    throw new Error("Object key is outside the project stream prefix");
  }
}

export function dtFromKey(key: string): string | null {
  const match = /\/dt=(\d{4}-\d{2}-\d{2})\//.exec(key);
  return match?.[1] ?? null;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function eachUtcDay(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return [];
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function cadenceSeconds(cadence: string): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(cadence.trim());
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

export function requiredFor(project: Project): StreamContract {
  const isometric = project.registry === "Isometric";
  return {
    schemaVersion: 1,
    kind: "timeseries",
    timezone: "UTC",
    cadence: isometric ? "PT2M" : "PT1H",
    registry: project.registry,
    methodologyKey: project.methodologyKey,
    requiredSeries: isometric ? [...INSITU_REQUIRED_SERIES] : [],
    requiredAttributes: isometric ? [...GHG_ACCOUNTING_HEADERS] : [],
  };
}

export function catalogProject(
  tenantId: string,
  registry: Registry,
  projectId: string,
): Project | null {
  const row = PROJECTS.find((project) => project.id === projectId);
  if (!row) return null;
  if (row.tenantId !== tenantId || row.registry !== registry) return null;
  return row;
}

export function projectsForTenantRegistry(
  tenantId: string,
  registry: Registry,
): Project[] {
  return PROJECTS.filter(
    (project) => project.tenantId === tenantId && project.registry === registry,
  );
}
