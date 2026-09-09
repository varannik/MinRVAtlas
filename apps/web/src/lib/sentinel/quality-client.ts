import { DEFAULT_TENANT_ID } from "@/lib/tenants";

export type QualityProjectOption = {
  id: string;
  name: string;
  registry: string;
  origin: "catalog" | "isometric";
};

function tenantHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("x-tenant-id", DEFAULT_TENANT_ID);
  return headers;
}

export async function fetchQualityProjects(): Promise<QualityProjectOption[]> {
  const response = await fetch("/api/quality/projects", {
    headers: tenantHeaders(),
    cache: "no-store",
  });
  const json = (await response.json()) as {
    projects?: QualityProjectOption[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(json.error ?? "Could not load projects");
  }
  return json.projects ?? [];
}

export async function bindQualityProject(
  catalogProjectId: string,
  name?: string,
): Promise<{ catalogProjectId: string; sentinelProjectId: string; name: string }> {
  const response = await fetch("/api/quality/projects", {
    method: "POST",
    headers: tenantHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ catalogProjectId, name }),
    cache: "no-store",
  });
  const json = (await response.json()) as {
    catalogProjectId?: string;
    sentinelProjectId?: string;
    name?: string;
    error?: string;
  };
  if (!response.ok || !json.sentinelProjectId) {
    throw new Error(json.error ?? "Could not bind quality project");
  }
  return {
    catalogProjectId: json.catalogProjectId ?? catalogProjectId,
    sentinelProjectId: json.sentinelProjectId,
    name: json.name ?? name ?? catalogProjectId,
  };
}
