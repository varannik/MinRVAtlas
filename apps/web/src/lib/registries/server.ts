import "server-only";

import { isCertifyProjectId, scopedCertifyId } from "@/lib/iso-geo";
import { PROJECTS } from "@/lib/projects";
import { findConnection } from "./connections";
import { mapCertifyProject } from "@/lib/registries/isometric/project-map";
import type { Project, Registry } from "../types";
import { getAdapter } from "./index";
import { isometricLiveAdapter, classifyRegistryFailure } from "./isometric/server";
import type {
  LiveSpecResult,
  OrgCredentials,
  RegistryConnection,
  RegistryCredentials,
  RegistryLiveAdapter,
} from "./types";

/**
 * Server half of the adapter layer. Importing this from a client component is a
 * build error by design: registry credentials and registry traffic stay on the
 * platform side of the boundary.
 */
const LIVE_ADAPTERS: Partial<Record<Registry, RegistryLiveAdapter>> = {
  Isometric: isometricLiveAdapter,
};

export function resolveOrgCredentials(
  connection: RegistryConnection,
): OrgCredentials | null {
  const accessToken = process.env[connection.credentials.accessTokenEnv];
  const clientSecret = process.env[connection.credentials.clientSecretEnv];
  if (!accessToken || !clientSecret) return null;
  return { accessToken, clientSecret };
}

/** Resolve org token plus the Certify project the call should hit. */
export function resolveCredentials(
  connection: RegistryConnection,
  options?: { externalProjectId?: string | null },
): RegistryCredentials | null {
  const org = resolveOrgCredentials(connection);
  const externalProjectId =
    options?.externalProjectId ||
    connection.externalProjectId ||
    (connection.credentials.projectIdEnv
      ? process.env[connection.credentials.projectIdEnv]
      : undefined);

  if (!org || !externalProjectId) return null;

  return { ...org, externalProjectId };
}

export function preferredCertifyProjectId(
  connection: RegistryConnection,
): string | undefined {
  return (
    connection.externalProjectId ??
    (connection.credentials.projectIdEnv
      ? process.env[connection.credentials.projectIdEnv]
      : undefined)
  );
}

function withPreferredExternal(project: Project): Project {
  if (project.registry !== "Isometric" || project.externalProjectId) {
    return project;
  }
  const connection = findConnection(project.tenantId, "Isometric", project.id);
  const preferred = connection ? preferredCertifyProjectId(connection) : undefined;
  if (!preferred) return project;
  return { ...project, externalProjectId: preferred };
}

/**
 * Tenant-owned catalog row, or a Certify `prj_…` this tenant's Isometric
 * connection is allowed to read.
 */
export function resolveOwnedProject(
  tenantId: string,
  projectId: string,
): Project | null {
  const catalog = PROJECTS.find((candidate) => candidate.id === projectId);
  if (catalog) {
    if (catalog.tenantId !== tenantId) return null;
    return withPreferredExternal(catalog);
  }

  if (!isCertifyProjectId(projectId)) return null;
  const connection = findConnection(tenantId, "Isometric", projectId);
  if (!connection) return null;

  return mapCertifyProject(tenantId, {
    id: projectId,
    name: projectId,
    country_code: "ARE",
    description: null,
    short_description: null,
  });
}

export function bundledResult(
  project: Project,
  meta: Partial<LiveSpecResult["meta"]> = {},
): LiveSpecResult {
  return {
    spec: getAdapter(project.registry).buildSpec(project),
    meta: {
      origin: "bundled",
      registry: project.registry,
      ...meta,
    },
  };
}

/**
 * Read requirements from the registry, falling back to the bundled rulebook so
 * a registry outage degrades the source of truth rather than the dashboard.
 */
export async function fetchRequirementSpec(
  project: Project,
  connection: RegistryConnection,
): Promise<LiveSpecResult> {
  const adapter = LIVE_ADAPTERS[connection.registry];
  if (!adapter) {
    return bundledResult(project, {
      fallbackReason: "not-supported",
      message: `${connection.registry} has no requirement read API yet.`,
    });
  }

  const credentials = resolveCredentials(connection, {
    externalProjectId: scopedCertifyId(project),
  });
  if (!credentials) {
    return bundledResult(project, {
      environment: connection.environment,
      fallbackReason: "credentials-missing",
      message: `Set ${connection.credentials.accessTokenEnv} and ${connection.credentials.clientSecretEnv} to read live requirements.`,
    });
  }

  try {
    return await adapter.fetchSpec({ project, connection, credentials });
  } catch (error) {
    const classified = classifyRegistryFailure(error);
    return bundledResult(project, {
      environment: connection.environment,
      externalProjectId: credentials.externalProjectId,
      fallbackReason: classified.reason,
      message: classified.message,
    });
  }
}
