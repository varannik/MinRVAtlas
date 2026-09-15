import "server-only";

import {
  entryFromCertify,
  inPeriod,
  statementFromCertify,
  templateFromCertify,
  type AccountingSnapshot,
} from "@/lib/accounting";
import { periodsOverlap } from "@/lib/period-desk";
import {
  MRV_BASE_URL,
  PAGE_SIZE,
  REGISTRY_BASE_URL,
  datapointsPath,
  ghgEntriesPath,
  ghgEntryPath,
  ghgEntryTemplatesPath,
  ghgStatementsPath,
  monitoringRequirementsPath,
  monitoringSubmissionPath,
  monitoringSubmissionsPath,
  projectDocumentsPath,
  projectPath,
  projectsPath,
  sourcePath,
  sourcesPath,
  storageLocationsPath,
  type CertifyProject,
  type Datapoint,
  type GhgEntry,
  type GhgEntryTemplate,
  type GhgStatement,
  type MonitoringSubmission,
  type PaginatedList,
  type ProjectDocument,
  type ProjectMonitoringRequirement,
  type Source,
  type StorageLocation,
} from "./api";
import { assembleDefinition } from "./definition";
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
  OrgCredentials,
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

function headers(credentials: OrgCredentials): HeadersInit {
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
  credentials: OrgCredentials,
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

export async function destroy(
  host: ApiHost,
  environment: RegistryEnvironment,
  path: string,
  credentials: OrgCredentials,
): Promise<void> {
  const url = `${BASE_URL[host][environment]}${path}`;
  let lastError: RegistryApiError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "DELETE",
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

    if (response.ok || response.status === 404) return;

    const retryable = response.status === 429 || response.status >= 500;
    const body = await response.text();
    lastError = new RegistryApiError(
      `Isometric returned ${response.status}: ${body.slice(0, 240)}`,
      response.status,
      path,
    );
    if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
    await delay(2 ** attempt * 400);
  }

  throw lastError ?? new RegistryApiError("Delete failed", 0, path);
}

function dayOf(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

function isFiledStatement(status: string | null | undefined): boolean {
  const value = (status ?? "").toLowerCase().replaceAll("-", "_");
  return value.length > 0 && value !== "draft" && value !== "assembling";
}

function statementWindow(row: GhgStatement): { start: string; end: string } | null {
  const start =
    dayOf(row.reporting_period_start_at) ??
    dayOf(row.start_on) ??
    dayOf(row.started_on) ??
    dayOf(row.start_date);
  const end =
    dayOf(row.reporting_period_end_at) ??
    dayOf(row.end_on) ??
    dayOf(row.ended_on) ??
    dayOf(row.end_date);
  if (!start || !end) return null;
  return { start, end };
}

export async function collect<T>(
  host: ApiHost,
  environment: RegistryEnvironment,
  path: string,
  credentials: OrgCredentials,
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

export async function softCollect<T>(
  host: ApiHost,
  environment: RegistryEnvironment,
  path: string,
  credentials: OrgCredentials,
  extra: Record<string, string | number | undefined> = {},
): Promise<{ nodes: T[]; warning?: string }> {
  try {
    return { nodes: await collect<T>(host, environment, path, credentials, extra) };
  } catch (error) {
    const classified = classifyRegistryFailure(error);
    return { nodes: [], warning: classified.message };
  }
}

export async function mapWithLimit<T, R>(
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
  credentials: OrgCredentials,
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

  const periodRequirements = requirements.filter(
    (requirement) => requirement.monitoring_phase !== "pre_op",
  );

  const live: LiveRequirement[] = await mapWithLimit(
    periodRequirements,
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

  const [sources, datapoints] = await Promise.all([
    resolveSources(environment, projectId, credentials, neededSourceIds),
    softCollect<Datapoint>(
      "mrv",
      environment,
      datapointsPath(),
      credentials,
      { project_id: projectId },
    ),
  ]);

  const extras = {
    sources: sources.byId,
    datapoints: datapoints.nodes,
  };
  const warnings = [sources.warning, datapoints.warning].filter(
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
      requirementCount: periodRequirements.length,
      evidenceCount: evidenceCount(live, extras),
      sourceCount: sources.byId.size,
      datapointCount: datapoints.nodes.length,
      endpoint: `${MRV_BASE_URL[environment]}${monitoringRequirementsPath(projectId)}`,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  };
}

export async function listGhgStatements(
  environment: RegistryEnvironment,
  projectId: string,
  credentials: OrgCredentials,
): Promise<{ nodes: GhgStatement[]; warning?: string }> {
  return softCollect<GhgStatement>(
    "mrv",
    environment,
    ghgStatementsPath(),
    credentials,
    { project_id: projectId },
  );
}

export async function listGhgEntries(
  environment: RegistryEnvironment,
  projectId: string,
  credentials: OrgCredentials,
): Promise<{ nodes: GhgEntry[]; warning?: string }> {
  return softCollect<GhgEntry>(
    "mrv",
    environment,
    ghgEntriesPath(),
    credentials,
    { project_id: projectId },
  );
}

export async function fetchAccountingSnapshot(
  environment: RegistryEnvironment,
  certifyProjectId: string,
  credentials: OrgCredentials,
  periodStart: string,
  periodEnd: string,
): Promise<AccountingSnapshot> {
  const [templates, entries, statements] = await Promise.all([
    softCollect<GhgEntryTemplate>(
      "mrv",
      environment,
      ghgEntryTemplatesPath(certifyProjectId),
      credentials,
    ),
    listGhgEntries(environment, certifyProjectId, credentials),
    listGhgStatements(environment, certifyProjectId, credentials),
  ]);

  const mappedEntries = entries.nodes
    .map(entryFromCertify)
    .filter(
      (row) =>
        inPeriod(row.completedOn, periodStart, periodEnd) ||
        inPeriod(row.startedOn, periodStart, periodEnd),
    );

  const mappedStatements = statements.nodes
    .map(statementFromCertify)
    .filter((row) => {
      if (row.periodStart && row.periodEnd) {
        return periodsOverlap(
          row.periodStart,
          row.periodEnd,
          periodStart,
          periodEnd,
        );
      }
      return row.entryIds.some((id) =>
        mappedEntries.some((entry) => entry.id === id),
      );
    });

  const warnings = [
    templates.warning,
    entries.warning,
    statements.warning,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    origin: "registry-api",
    warning: warnings.length > 0 ? warnings.join(" · ") : undefined,
    templates: templates.nodes.map(templateFromCertify),
    entries: mappedEntries,
    statements: mappedStatements,
  };
}

export async function listCertifyProjects(
  environment: RegistryEnvironment,
  credentials: OrgCredentials,
): Promise<{ nodes: CertifyProject[]; warning?: string }> {
  return softCollect<CertifyProject>(
    "mrv",
    environment,
    projectsPath(),
    credentials,
  );
}

export async function fetchProjectDefinition(
  environment: RegistryEnvironment,
  catalogProjectId: string,
  certifyProjectId: string,
  credentials: OrgCredentials,
  givenDescription?: string | null,
) {
  const [documents, templates, locations, requirements] = await Promise.all([
    softCollect<ProjectDocument>(
      "registry",
      environment,
      projectDocumentsPath(certifyProjectId),
      credentials,
    ),
    softCollect<GhgEntryTemplate>(
      "mrv",
      environment,
      ghgEntryTemplatesPath(certifyProjectId),
      credentials,
    ),
    softCollect<StorageLocation>(
      "mrv",
      environment,
      storageLocationsPath(certifyProjectId),
      credentials,
    ),
    softCollect<ProjectMonitoringRequirement>(
      "mrv",
      environment,
      monitoringRequirementsPath(certifyProjectId),
      credentials,
    ),
  ]);

  const preOpReqs = requirements.nodes.filter(
    (row) => row.monitoring_phase === "pre_op",
  );
  const preOp: LiveRequirement[] = await mapWithLimit(
    preOpReqs,
    SUBMISSION_CONCURRENCY,
    async (requirement) => ({
      requirement,
      submissions: await collect<MonitoringSubmission>(
        "mrv",
        environment,
        monitoringSubmissionsPath(certifyProjectId, requirement.id),
        credentials,
      ),
    }),
  );

  const warnings = [
    documents.warning,
    templates.warning,
    locations.warning,
    requirements.warning,
  ].filter((warning): warning is string => Boolean(warning));

  let createdOn: string | null = null;
  let description = givenDescription;
  try {
    const row = await request<
      CertifyProject & { crediting_period_start?: string | null }
    >("registry", environment, projectPath(certifyProjectId), {}, credentials);
    createdOn =
      dayOf(row.created_at) ?? dayOf(row.crediting_period_start);
    description =
      givenDescription ?? row.description ?? row.short_description ?? null;
  } catch {
    try {
      const row = await request<CertifyProject>(
        "mrv",
        environment,
        projectPath(certifyProjectId),
        {},
        credentials,
      );
      createdOn = dayOf(row.created_at);
      description =
        givenDescription ?? row.description ?? row.short_description ?? null;
    } catch {
      // Charter still works without Certify created_at.
    }
  }

  return assembleDefinition({
    projectId: catalogProjectId,
    certifyProjectId,
    origin: "registry-api",
    description,
    createdOn,
    documents: documents.nodes,
    templates: templates.nodes,
    storageLocations: locations.nodes,
    preOp,
    warnings,
  });
}

export type FiledPeriodWindow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  ghgStatementId?: string;
  ghgEntryIds?: string[];
};

export async function listFiledPeriodWindows(
  environment: RegistryEnvironment,
  certifyProjectId: string,
  credentials: OrgCredentials,
): Promise<{ windows: FiledPeriodWindow[]; warning?: string }> {
  const listed = await listGhgStatements(environment, certifyProjectId, credentials);
  const windows: FiledPeriodWindow[] = [];
  const seen = new Set<string>();

  for (const row of listed.nodes) {
    if (row.project_id && row.project_id !== certifyProjectId) continue;
    if (!isFiledStatement(row.status)) continue;
    const span = statementWindow(row);
    if (!span) continue;
    const key = `${span.start}|${span.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    windows.push({
      id: row.id,
      periodStart: span.start,
      periodEnd: span.end,
      status: row.status ?? "submitted",
      ghgStatementId: row.id,
      ghgEntryIds: row.ghg_entry_ids,
    });
  }

  const requirements = await softCollect<ProjectMonitoringRequirement>(
    "mrv",
    environment,
    monitoringRequirementsPath(certifyProjectId),
    credentials,
  );

  const operational = requirements.nodes.filter(
    (requirement) => requirement.monitoring_phase !== "pre_op",
  );
  const live = await mapWithLimit(
    operational,
    SUBMISSION_CONCURRENCY,
    async (requirement) => ({
      requirement,
      submissions: await collect<MonitoringSubmission>(
        "mrv",
        environment,
        monitoringSubmissionsPath(certifyProjectId, requirement.id),
        credentials,
      ),
    }),
  );

  for (const entry of live) {
    for (const submission of entry.submissions) {
      const start = dayOf(submission.valid_from) ?? dayOf(submission.valid_to);
      const end = dayOf(submission.valid_to);
      if (!start || !end) continue;
      if (
        windows.some((window) =>
          periodsOverlap(window.periodStart, window.periodEnd, start, end),
        )
      ) {
        continue;
      }
      const key = `${start}|${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      windows.push({
        id: `mon-${start}-${end}`,
        periodStart: start,
        periodEnd: end,
        status: "submitted",
      });
    }
  }

  const warning = [listed.warning, requirements.warning]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return { windows, warning: warning || undefined };
}

export type PeriodWithdrawResult = {
  deletedSubmissions: number;
  deletedEntries: number;
  warnings: string[];
};

export async function withdrawPeriodEvidence(
  environment: RegistryEnvironment,
  certifyProjectId: string,
  credentials: OrgCredentials,
  periodStart: string,
  periodEnd: string,
  ghgStatementId?: string,
): Promise<PeriodWithdrawResult> {
  const warnings: string[] = [];
  let deletedSubmissions = 0;
  let deletedEntries = 0;

  const requirements = await collect<ProjectMonitoringRequirement>(
    "mrv",
    environment,
    monitoringRequirementsPath(certifyProjectId),
    credentials,
  );
  const operational = requirements.filter(
    (requirement) => requirement.monitoring_phase !== "pre_op",
  );

  for (const requirement of operational) {
    const submissions = await collect<MonitoringSubmission>(
      "mrv",
      environment,
      monitoringSubmissionsPath(certifyProjectId, requirement.id),
      credentials,
    );
    for (const submission of submissions) {
      const start = dayOf(submission.valid_from) ?? dayOf(submission.valid_to);
      const end = dayOf(submission.valid_to);
      if (!start || !end) continue;
      if (!periodsOverlap(periodStart, periodEnd, start, end)) continue;
      try {
        await destroy(
          "mrv",
          environment,
          monitoringSubmissionPath(certifyProjectId, requirement.id, submission.id),
          credentials,
        );
        deletedSubmissions += 1;
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : `Could not delete monitoring ${submission.id}`,
        );
      }
    }
  }

  const listed = await listGhgStatements(environment, certifyProjectId, credentials);
  const matching = listed.nodes.filter((row) => {
    if (row.project_id && row.project_id !== certifyProjectId) return false;
    if (ghgStatementId && row.id === ghgStatementId) return true;
    const span = statementWindow(row);
    return Boolean(span && periodsOverlap(periodStart, periodEnd, span.start, span.end));
  });

  const entryIds = [
    ...new Set(matching.flatMap((row) => row.ghg_entry_ids ?? [])),
  ];
  for (const entryId of entryIds) {
    try {
      await destroy("mrv", environment, ghgEntryPath(entryId), credentials);
      deletedEntries += 1;
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? error.message
          : `Could not delete GHG entry ${entryId}`,
      );
    }
  }

  const filed = matching.filter((row) => isFiledStatement(row.status));
  if (filed.length > 0) {
    warnings.push(
      "Certify does not delete a GHG statement after it has been submitted. Monitoring files for this window were withdrawn.",
    );
  }

  return { deletedSubmissions, deletedEntries, warnings };
}

export const isometricLiveAdapter: RegistryLiveAdapter = {
  registry: "Isometric",
  fetchSpec,
};
