import type { Project, Registry, RequirementSpec, SpecGroup } from "../types";

/**
 * Methodology-level monitoring parameters. The registry decides which reports
 * are filed; the methodology decides what has to be measured to fill them.
 */
export interface MethodologyModule {
  key: string;
  name: string;
  version: string;
  sources: string[];
  group: SpecGroup;
}

export type RegistryEnvironment = "sandbox" | "production";

export type SpecOrigin = "bundled" | "registry-api";

/** Why a request fell back to the bundled rulebook instead of the live API. */
export type FallbackReason =
  | "no-connection"
  | "credentials-missing"
  | "not-supported"
  | "api-error"
  | "forbidden"
  | "beta-not-opted-in"
  | "rate-limited";

/**
 * Client-safe half of an adapter: everything that can be resolved offline from
 * the published rulebook, with no credentials involved.
 */
export interface RegistryAdapter {
  registry: Registry;
  /** Rulebook edition the bundled spec was transcribed from. */
  rulebookVersion: string;
  /** What a submission is called in this registry's process. */
  submissionLabel: string;
  platform: string;
  docsUrl?: string;
  /** Whether this adapter can read requirements from the registry itself. */
  supportsLiveRequirements: boolean;
  sources: string[];
  buildSpec(project: Project): RequirementSpec;
}

/**
 * A tenant's binding to one registry. Credentials are referenced by env var
 * name only — values are resolved server-side and never cross the wire.
 */
export interface RegistryConnection {
  id: string;
  tenantId: string;
  registry: Registry;
  environment: RegistryEnvironment;
  /** Local catalog ids this connection may answer for. Empty = whole org. */
  projectIds: string[];
  /**
   * Preferred Certify project when the caller does not name one. The access
   * token is organisation-scoped and can list every project it can see.
   */
  externalProjectId: string | null;
  transport: "machine-to-machine";
  credentials: {
    accessTokenEnv: string;
    clientSecretEnv: string;
    /** Falls back to this env var when `externalProjectId` is null. */
    projectIdEnv?: string;
  };
}

export interface RegistryCredentials {
  accessToken: string;
  clientSecret: string;
  /** Present when the call is scoped to one Certify project. */
  externalProjectId: string;
}

export type OrgCredentials = {
  accessToken: string;
  clientSecret: string;
};

export interface LiveSpecRequest {
  project: Project;
  connection: RegistryConnection;
  credentials: RegistryCredentials;
}

export interface LiveSpecMeta {
  origin: SpecOrigin;
  registry: Registry;
  environment?: RegistryEnvironment;
  externalProjectId?: string;
  fetchedAt?: string;
  requirementCount?: number;
  evidenceCount?: number;
  endpoint?: string;
  fallbackReason?: FallbackReason;
  message?: string;
  warnings?: string[];
  datapointCount?: number;
  sourceCount?: number;
  documentCount?: number;
}

export interface LiveSpecResult {
  spec: RequirementSpec;
  meta: LiveSpecMeta;
}

/** Server-only half of an adapter. Implemented in each `<registry>/server.ts`. */
export interface RegistryLiveAdapter {
  registry: Registry;
  fetchSpec(request: LiveSpecRequest): Promise<LiveSpecResult>;
}

export class RegistryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "RegistryApiError";
  }
}
