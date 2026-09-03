import "server-only";

import {
  MRV_BASE_URL,
  PAGE_SIZE,
  REGISTRY_BASE_URL,
  datapointsPath,
  monitoringRequirementsPath,
  monitoringSubmissionsPath,
  projectDocumentsPath,
  sourcePath,
  sourcesPath,
  type Datapoint,
  type MonitoringSubmission,
  type PaginatedList,
  type ProjectDocument,
  type ProjectMonitoringRequirement,
  type Source,
} from "./api";
import {
  evidenceCount,
  toRequirementSpec,
  type LiveRequirement,
} from "./transform";
import { RegistryApiError } from "../types";
import type {
  FallbackReason,
  LiveSpecRequest,
  LiveSpecResult,
  RegistryCredentials,
  RegistryEnvironment,
  RegistryLiveAdapter,
} from "../types";

/**
 * Machine-to-machine client for Isometric Certify + Registry. Credentials come
 * from the platform's own secret store, never from the browser.
 *
 * Auth is two headers at once (docs/api-reference/authentication):
 *   x-client-secret  — identifies this integration, per environment
 *   Authorization    — org-scoped JWT, so one token reads one supplier's data
 *
 * Step E reads: monitoring list, submissions, source metadata, datapoints,
 * published registry documents. It does not download source bytes and does
 * not POST to Certify.
 */

const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
const SUBMISSION_CONCURRENCY = 4;
const MISSING_SOURCE_CAP = 40;

type ApiHost = "mrv" | "registry";

const BASE_URL: Record<ApiHost, Record<RegistryEnvironment, string>> = {
  mrv: MRV_BASE_URL,
  registry: REGISTRY_BASE_URL,
};

function headers(credentials: RegistryCredentials): HeadersInit {
  return {
    accept: "application/json",
    authorization: `Bearer ${credentials.accessToken}`,
    "x-client-secret": credentials.clientSecret,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function classifyRegistryFailure(error: unknown): {
  reason: FallbackReason;
  message: string;
} {
  if (!(error instanceof RegistryApiError)) {
    return {
      reason: "api-error",
      message: error instanceof Error ? error.message : "Unknown registry error",
    };
  }
  const body = error.message;
  if (error.status === 429) {
    return {
      reason: "rate-limited",
      message: `Isometric rate-limited (429) on ${error.endpoint}`,
    };
  }
  if (error.status === 403) {
    if (/beta|opt[- ]?in|not enabled|not authorised to use|not authorized to use/i.test(body)) {
      return {
        reason: "beta-not-opted-in",
        message: `Isometric beta not opted in (403) on ${error.endpoint}`,
      };
    }
    return {
      reason: "forbidden",
      message: `Isometric forbidden (403) on ${error.endpoint}`,
    };
  }
  return {
    reason: "api-error",
    message: `Isometric API error ${error.status} on ${error.endpoint}`,
  };
}

async function request<T>(
  host: ApiHost,
  environment: RegistryEnvironment,
  path: string,
  search: Record<string, string | number | undefined>,
  credentials: RegistryCredentials,
): Promise<T> {
  const url = new URL(`${BASE_URL[host][environment]}${path}`);
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let lastError: RegistryApiError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: headers(credentials),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = new RegistryApiError(
        error instanceof Error ? error.message : "Network failure",
        0,
        path,
      );
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await delay(2 ** attempt * 250);
      continue;
    }

    if (response.ok) return (await response.json()) as T;

    const retryable = response.status === 429 || response.status >= 500;
    const body = await response.text();
    lastError = new RegistryApiError(
      `Isometric returned ${response.status}: ${body.slice(0, 240)}`,
      response.status,
      path,
    );

    if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;

    const retryAfter = Number(response.headers.get("retry-after"));
    await delay(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 400,
    );
  }

  throw lastError ?? new RegistryApiError("Request failed", 0, path);
}

async function collect<T>(
  host: ApiHost,
  environment: RegistryEnvironment,
  path: string,
  credentials: RegistryCredentials,
  extra: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const nodes: T[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await request<PaginatedList<T>>(
      host,
      environment,
      path,
      { first: PAGE_SIZE, after, ...extra },
      credentials,
    );
    nodes.push(...payload.nodes);

    if (!payload.page_info.has_next_page || !payload.page_info.end_cursor) break;
    after = payload.page_info.end_cursor;
  }

  return nodes;
}

async function softCollect<T>(
  host: ApiHost,
  environment: RegistryEnvironment,
  path: string,
  credentials: RegistryCredentials,
  extra: Record<string, string | number | undefined> = {},
): Promise<{ nodes: T[]; warning?: string }> {
  try {
    return { nodes: await collect<T>(host, environment, path, credentials, extra) };
  } catch (error) {
    const classified = classifyRegistryFailure(error);
    return { nodes: [], warning: classified.message };
  }
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

async function resolveSources(
  environment: RegistryEnvironment,
  projectId: string,
  credentials: RegistryCredentials,
  neededIds: string[],
): Promise<{ byId: Map<string, Source>; warning?: string }> {
  const listed = await softCollect<Source>(
    "mrv",
    environment,
    sourcesPath(),
    credentials,
    { project_id: projectId },
  );
  const byId = new Map(listed.nodes.map((source) => [source.id, source]));
  const missing = neededIds
    .filter((id) => id && !byId.has(id))
    .slice(0, MISSING_SOURCE_CAP);

  if (missing.length > 0) {
    await mapWithLimit(missing, SUBMISSION_CONCURRENCY, async (id) => {
      try {
        const source = await request<Source>(
          "mrv",
          environment,
          sourcePath(id),
          {},
          credentials,
        );
        byId.set(source.id, source);
      } catch {
        // Leave unresolved; the board still shows the source_id.
      }
    });
  }

  return { byId, warning: listed.warning };
}

async function fetchSpec(req: LiveSpecRequest): Promise<LiveSpecResult> {
  const { connection, credentials, project } = req;
  const environment = connection.environment;
  const projectId = credentials.externalProjectId;

  const requirements = await collect<ProjectMonitoringRequirement>(
    "mrv",
    environment,
    monitoringRequirementsPath(projectId),
    credentials,
  );

  const live: LiveRequirement[] = await mapWithLimit(
    requirements,
    SUBMISSION_CONCURRENCY,
    async (requirement) => ({
      requirement,
      submissions: await collect<MonitoringSubmission>(
        "mrv",
        environment,
        monitoringSubmissionsPath(projectId, requirement.id),
        credentials,
      ),
    }),
  );

  const neededSourceIds = [
    ...new Set(
      live.flatMap((entry) => entry.submissions.map((row) => row.source_id)),
    ),
  ];

  const [sources, datapoints, documents] = await Promise.all([
    resolveSources(environment, projectId, credentials, neededSourceIds),
    softCollect<Datapoint>(
      "mrv",
      environment,
      datapointsPath(),
      credentials,
      { project_id: projectId },
    ),
    softCollect<ProjectDocument>(
      "registry",
      environment,
      projectDocumentsPath(projectId),
      credentials,
    ),
  ]);

  const extras = {
    sources: sources.byId,
    datapoints: datapoints.nodes,
    documents: documents.nodes,
  };
  const warnings = [sources.warning, datapoints.warning, documents.warning].filter(
    (warning): warning is string => Boolean(warning),
  );

  return {
    spec: toRequirementSpec(project, live, extras),
    meta: {
      origin: "registry-api",
      registry: "Isometric",
      environment,
      externalProjectId: projectId,
      fetchedAt: new Date().toISOString(),
      requirementCount: requirements.length,
      evidenceCount: evidenceCount(live, extras),
      sourceCount: sources.byId.size,
      datapointCount: datapoints.nodes.length,
      documentCount: documents.nodes.length,
      endpoint: `${MRV_BASE_URL[environment]}${monitoringRequirementsPath(projectId)}`,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  };
}

export const isometricLiveAdapter: RegistryLiveAdapter = {
  registry: "Isometric",
  fetchSpec,
};
