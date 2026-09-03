import "server-only";

import type { Project, Registry } from "../types";
import { getAdapter } from "./index";
import { isometricLiveAdapter, classifyRegistryFailure } from "./isometric/server";
import type {
  LiveSpecResult,
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

/** Resolve the named secrets for a connection. Returns null if any is unset. */
export function resolveCredentials(
  connection: RegistryConnection,
): RegistryCredentials | null {
  const accessToken = process.env[connection.credentials.accessTokenEnv];
  const clientSecret = process.env[connection.credentials.clientSecretEnv];
  const externalProjectId =
    connection.externalProjectId ??
    (connection.credentials.projectIdEnv
      ? process.env[connection.credentials.projectIdEnv]
      : undefined);

  if (!accessToken || !clientSecret || !externalProjectId) return null;

  return { accessToken, clientSecret, externalProjectId };
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

  const credentials = resolveCredentials(connection);
  if (!credentials) {
    return bundledResult(project, {
      environment: connection.environment,
      fallbackReason: "credentials-missing",
      message: `Set ${connection.credentials.accessTokenEnv}, ${connection.credentials.clientSecretEnv} and ${connection.credentials.projectIdEnv ?? "the project id"} to read live requirements.`,
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
