import type { Registry } from "../types";
import type { RegistryConnection } from "./types";

/**
 * Which tenant is wired to which registry, and with what scope.
 *
 * Two things this encodes deliberately:
 *  - Credentials are named, not stored. Only the server resolves the env var to
 *    a value, so a tenant user of the dashboard never holds registry access.
 *  - An Isometric access token is scoped to one organisation. Empty
 *    `projectIds` means the connection may list and read every Certify
 *    project that token can see. `ISOMETRIC_PROJECT_ID` is only a preferred
 *    pin (Fujairah), not a hard scope.
 *  - Certify does not return a reliable map pin. Site coordinates are
 *    operator input, stored as an overlay keyed by the local project id.
 */
export const REGISTRY_CONNECTIONS: RegistryConnection[] = [
  {
    id: "conn-4401-isometric-sandbox",
    tenantId: "fourfourone",
    registry: "Isometric",
    environment: "sandbox",
    /** Local catalog ids this connection may answer for. Empty = whole org. */
    projectIds: [] as string[],
    externalProjectId: null,
    transport: "machine-to-machine",
    credentials: {
      accessTokenEnv: "ISOMETRIC_ACCESS_TOKEN",
      clientSecretEnv: "ISOMETRIC_CLIENT_SECRET",
      projectIdEnv: "ISOMETRIC_PROJECT_ID",
    },
  },
];

export function findConnection(
  tenantId: string,
  registry: Registry,
  projectId?: string,
): RegistryConnection | undefined {
  return REGISTRY_CONNECTIONS.find((connection) => {
    if (connection.tenantId !== tenantId || connection.registry !== registry) {
      return false;
    }
    if (connection.projectIds.length === 0) return true;
    if (!projectId) return true;
    return connection.projectIds.includes(projectId);
  });
}

/** Used by the UI to badge projects that read their requirements from source. */
export function hasConnection(
  tenantId: string,
  projectId?: string,
  registry: Registry = "Isometric",
): boolean {
  return Boolean(findConnection(tenantId, registry, projectId));
}
