import type { Registry } from "../types";
import type { RegistryConnection } from "./types";

/**
 * Which tenant is wired to which registry, and with what scope.
 *
 * Two things this encodes deliberately:
 *  - Credentials are named, not stored. Only the server resolves the env var to
 *    a value, so a tenant user of the dashboard never holds registry access.
 *  - An Isometric access token is scoped to one organisation, and the token we
 *    hold covers one project. `projectIds` says which local project a
 *    connection may answer for; anything else falls back to the bundled spec.
 *  - The Certify API identifies that project; it does not return a reliable
 *    map pin. Site coordinates are operator input, stored as an overlay keyed
 *    by the local project id, not in the Isometric secret.
 */
export const REGISTRY_CONNECTIONS: RegistryConnection[] = [
  {
    id: "conn-4401-isometric-sandbox",
    tenantId: "fourfourone",
    registry: "Isometric",
    environment: "sandbox",
    projectIds: ["fujairah-mineral"],
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
  projectId: string,
): RegistryConnection | undefined {
  return REGISTRY_CONNECTIONS.find(
    (connection) =>
      connection.tenantId === tenantId &&
      connection.registry === registry &&
      connection.projectIds.includes(projectId),
  );
}

/** Used by the UI to badge projects that read their requirements from source. */
export function hasConnection(tenantId: string, projectId: string): boolean {
  return REGISTRY_CONNECTIONS.some(
    (connection) =>
      connection.tenantId === tenantId &&
      connection.projectIds.includes(projectId),
  );
}
