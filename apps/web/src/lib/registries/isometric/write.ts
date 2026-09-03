import "server-only";

import { classifyRequirement } from "@/lib/requirement-payload";
import { sentinelUpstreamJson } from "@/lib/sentinel/upstream";
import type { PipelineResult } from "@/lib/sentinel/pipeline-types";
import type { ItemKind } from "@/lib/types";
import { RegistryApiError } from "../types";
import type { RegistryCredentials, RegistryEnvironment } from "../types";
import {
  MRV_BASE_URL,
  datapointsPath,
  ghgStatementSubmitPath,
  monitoringSubmissionsPath,
  sourcesPath,
  type Datapoint,
  type MonitoringSubmission,
  type Source,
} from "./api";
import {
  PARQUET_MAX_BYTES,
  SOURCE_MAX_BYTES,
  isParquet,
  sourceContentType,
} from "./mime";
import { classifyRegistryFailure } from "./server";
import { qualityBlockReason, slotSubmitBlockReason } from "../submit-gate";

/**
 * Certify write. Credentials stay on the server. Never called from the
 * pipeline — only from an explicit operator submit.
 */

const REQUEST_TIMEOUT_MS = 20_000;
const PUT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const BIOCHAR_OR_DAC_TYPES = new Set([
  "biochar_pyrolysis_reactor_facility_time_series",
  "dac_storage_site_time_series",
  "dac_facility_time_series",
  "wae_wastewater_treatment_plant_facility_time_series",
]);

export type SubmitFile = {
  name: string;
  type: string;
  bytes: Uint8Array;
};

export type DatapointDraft = {
  display_name: string;
  magnitude: number;
  unit: string;
  type?: "CONSTANT" | "STANDARD_PUBLISHED_VALUE" | "REPORTED" | "ASSUMPTION" | "DERIVED";
  description?: string;
};

export type SlotWriteInput = {
  tenantId: string;
  catalogProjectId: string;
  slotId: string;
  batchId: string;
  kind: ItemKind;
  label: string;
  notes: string;
  requirementId: string;
  specOrigin: "bundled" | "registry-api";
  periodStart?: string;
  periodEnd?: string;
  pipeline: PipelineResult;
  files: SubmitFile[];
  datapoints?: DatapointDraft[];
  environment: RegistryEnvironment;
  credentials: RegistryCredentials;
};

export type GhgWriteInput = {
  tenantId: string;
  catalogProjectId: string;
  batchId: string;
  reportUrl: string;
  submittedSlotIds: string[];
  mandatorySlotIds: string[];
  environment: RegistryEnvironment;
  credentials: RegistryCredentials;
};

export type SlotWriteResult = {
  ok: boolean;
  blocked?: string;
  sourceIds: string[];
  datapointIds: string[];
  submissionIds: string[];
  warnings: string[];
  error?: string;
  updatedAt: string;
};

export type GhgWriteResult = {
  ok: boolean;
  blocked?: string;
  statementId?: string;
  warnings: string[];
  error?: string;
  updatedAt: string;
};

export class SubmitBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmitBlockedError";
  }
}

const slotMemory = new Map<string, { sourceIds: string[] }>();

function memoryKey(tenantId: string, projectId: string, batchId: string, slotId: string): string {
  return `${tenantId}:${projectId}:${batchId}:${slotId}`;
}

export function rememberSlotWrite(
  tenantId: string,
  projectId: string,
  batchId: string,
  slotId: string,
  sourceIds: string[],
): void {
  slotMemory.set(memoryKey(tenantId, projectId, batchId, slotId), { sourceIds });
}

export function hasSlotWrite(
  tenantId: string,
  projectId: string,
  batchId: string,
  slotId: string,
): boolean {
  return slotMemory.has(memoryKey(tenantId, projectId, batchId, slotId));
}

export function isCertifyResourceId(id: string): boolean {
  return /^[a-z]{3}_[A-Za-z0-9]+$/i.test(id) && id.length >= 20 && id.length <= 37;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(credentials: RegistryCredentials): HeadersInit {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${credentials.accessToken}`,
    "x-client-secret": credentials.clientSecret,
  };
}

function toDate(value: string | undefined, endOfDay: boolean): string {
  const day = (value && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : new Date().toISOString().slice(0, 10));
  return endOfDay ? `${day}T23:59:59.000Z` : `${day}T00:00:00.000Z`;
}

function publishedAt(periodEnd?: string): string {
  if (periodEnd && /^\d{4}-\d{2}-\d{2}/.test(periodEnd)) return periodEnd.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function referenceId(parts: string[]): string {
  return parts.join(":").replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 200);
}

async function mrvJson<T>(
  environment: RegistryEnvironment,
  path: string,
  credentials: RegistryCredentials,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${MRV_BASE_URL[environment]}${path}`;
  const method = init.method ?? "POST";
  let lastError: RegistryApiError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: authHeaders(credentials),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
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

    if (response.ok) {
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

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

  throw lastError ?? new RegistryApiError("Request failed", 0, path);
}

async function putBytes(uploadUrl: string, contentType: string, bytes: Uint8Array): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "content-length": String(copy.byteLength),
    },
    body: copy.buffer,
    cache: "no-store",
    signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new RegistryApiError(
      `Source byte upload failed ${response.status}: ${body.slice(0, 240)}`,
      response.status,
      "signed-upload",
    );
  }
}

async function confirmDqa(pipeline: PipelineResult, needsDqa: boolean): Promise<void> {
  if (!needsDqa) return;
  if (!pipeline.runId) {
    throw new SubmitBlockedError("DQA run id missing — run quality check first");
  }
  try {
    const run = await sentinelUpstreamJson<{
      status: string;
      gate_passed?: boolean | null;
    }>(`v1/runs/${pipeline.runId}`);
    if (run.status === "failed" || run.gate_passed === false) {
      throw new SubmitBlockedError("Sentinel DQA is not green; Certify write refused");
    }
  } catch (error) {
    if (error instanceof SubmitBlockedError) throw error;
    throw new SubmitBlockedError(
      "Could not confirm DQA with Sentinel; Certify write refused",
    );
  }
}

type CreateSourceResponse = {
  signed_upload_url: string;
  source: Source;
};

async function uploadSource(
  input: SlotWriteInput,
  file: SubmitFile,
): Promise<Source> {
  if (file.bytes.byteLength > SOURCE_MAX_BYTES) {
    throw new SubmitBlockedError(
      `${file.name} is larger than Certify's 50 MB source limit`,
    );
  }
  const contentType = sourceContentType(file.name, file.type);
  const created = await mrvJson<CreateSourceResponse>(
    input.environment,
    sourcesPath(),
    input.credentials,
    {
      body: {
        __typename: "CreateDocumentSourceRequest",
        project_id: input.credentials.externalProjectId,
        display_name: `${input.label} · ${file.name}`.slice(0, 150),
        file_name: file.name,
        content_type: contentType,
        content_length: file.bytes.byteLength,
        published_at: publishedAt(input.periodEnd),
        is_public: false,
        description: input.notes.slice(0, 2000) || null,
        supplier_reference_id: referenceId([
          "minrv",
          input.batchId,
          input.slotId,
          file.name,
          crypto.randomUUID(),
        ]),
      },
    },
  );
  await putBytes(created.signed_upload_url, contentType, file.bytes);
  return created.source;
}

async function createDatapoints(
  input: SlotWriteInput,
  sourceIds: string[],
): Promise<{ ids: string[]; warnings: string[] }> {
  const drafts = input.datapoints ?? [];
  if (drafts.length === 0) return { ids: [], warnings: [] };
  const ids: string[] = [];
  const warnings: string[] = [];
  for (const draft of drafts) {
    try {
      const point = await mrvJson<Datapoint>(
        input.environment,
        datapointsPath(),
        input.credentials,
        {
          body: {
            project_id: input.credentials.externalProjectId,
            display_name: draft.display_name.slice(0, 150),
            type: draft.type ?? "REPORTED",
            quantity: { magnitude: draft.magnitude, unit: draft.unit },
            description: (draft.description ?? input.notes).slice(0, 500) || input.label,
            source_ids: sourceIds,
            measured_at: toDate(input.periodEnd, true),
            supplier_reference_id: referenceId([
              "minrv-dp",
              input.batchId,
              input.slotId,
              draft.display_name,
              crypto.randomUUID(),
            ]),
          },
        },
      );
      ids.push(point.id);
    } catch (error) {
      const classified = classifyRegistryFailure(error);
      warnings.push(`Datapoint skipped: ${classified.message}`);
    }
  }
  return { ids, warnings };
}

async function createMonitoringSubmissions(
  input: SlotWriteInput,
  sourceIds: string[],
): Promise<{ ids: string[]; warnings: string[] }> {
  if (input.specOrigin !== "registry-api" || !isCertifyResourceId(input.requirementId)) {
    return {
      ids: [],
      warnings: [
        "Monitoring submission skipped — board is on the bundled spec (no Certify requirement id).",
      ],
    };
  }
  const ids: string[] = [];
  const warnings: string[] = [];
  const projectId = input.credentials.externalProjectId;
  for (const sourceId of sourceIds) {
    try {
      const row = await mrvJson<MonitoringSubmission>(
        input.environment,
        monitoringSubmissionsPath(projectId, input.requirementId),
        input.credentials,
        {
          body: {
            source_id: sourceId,
            valid_from: toDate(input.periodStart, false),
            valid_to: toDate(input.periodEnd, true),
            notes: input.notes.slice(0, 2000) || null,
            supplier_reference_id: referenceId([
              "minrv-mns",
              input.batchId,
              input.slotId,
              sourceId,
            ]),
          },
        },
      );
      ids.push(row.id);
    } catch (error) {
      const classified = classifyRegistryFailure(error);
      warnings.push(`Monitoring submission skipped: ${classified.message}`);
    }
  }
  return { ids, warnings };
}

function timeSeriesWarning(input: SlotWriteInput): string | undefined {
  const parquet = input.files.some((file) => isParquet(file.name, file.type));
  if (!parquet) return undefined;
  const configured = process.env.ISOMETRIC_DATA_UPLOAD_TYPE?.trim();
  if (configured && BIOCHAR_OR_DAC_TYPES.has(configured)) {
    return "Parquet attached as a source. Fujairah is in-situ mineralisation — Certify time-series jobs are DAC/biochar/WAE only.";
  }
  if (input.files.some((file) => file.bytes.byteLength > PARQUET_MAX_BYTES)) {
    return "A parquet file exceeds Certify's 100 MB time-series cap; it was not sent as a data-upload job.";
  }
  return "Parquet attached as a source. Certify has no in-situ mineralisation time-series job type.";
}

export async function submitSlot(input: SlotWriteInput): Promise<SlotWriteResult> {
  const now = new Date().toISOString();
  const blocked = slotSubmitBlockReason(
    input.pipeline,
    input.kind,
    input.label,
    input.files.length,
  );
  if (blocked) {
    return {
      ok: false,
      blocked,
      sourceIds: [],
      datapointIds: [],
      submissionIds: [],
      warnings: [],
      updatedAt: now,
    };
  }

  const classification = classifyRequirement({
    kind: input.kind,
    label: input.label,
  });
  const quality = qualityBlockReason(input.pipeline, classification);
  if (quality) {
    return {
      ok: false,
      blocked: quality,
      sourceIds: [],
      datapointIds: [],
      submissionIds: [],
      warnings: [],
      updatedAt: now,
    };
  }

  await confirmDqa(input.pipeline, classification.engines.includes("dqa"));

  const sourceIds: string[] = [];
  for (const file of input.files) {
    const source = await uploadSource(input, file);
    sourceIds.push(source.id);
  }

  const datapoints = await createDatapoints(input, sourceIds);
  const submissions = await createMonitoringSubmissions(input, sourceIds);
  const warnings = [
    ...datapoints.warnings,
    ...submissions.warnings,
    timeSeriesWarning(input),
  ].filter((row): row is string => Boolean(row));

  rememberSlotWrite(
    input.tenantId,
    input.catalogProjectId,
    input.batchId,
    input.slotId,
    sourceIds,
  );

  return {
    ok: true,
    sourceIds,
    datapointIds: datapoints.ids,
    submissionIds: submissions.ids,
    warnings,
    updatedAt: now,
  };
}

export async function submitGhgStatement(input: GhgWriteInput): Promise<GhgWriteResult> {
  const now = new Date().toISOString();
  const statementId = process.env.ISOMETRIC_GHG_STATEMENT_ID?.trim();
  if (!statementId) {
    return {
      ok: false,
      blocked:
        "Set ISOMETRIC_GHG_STATEMENT_ID. GHG statement submit is last and is not created from the board.",
      warnings: [],
      updatedAt: now,
    };
  }
  if (!input.reportUrl.trim()) {
    return {
      ok: false,
      blocked: "GHG statement needs a verifier-accessible report URL",
      warnings: [],
      updatedAt: now,
    };
  }

  const missing = input.mandatorySlotIds.filter(
    (slotId) =>
      !input.submittedSlotIds.includes(slotId) &&
      !hasSlotWrite(input.tenantId, input.catalogProjectId, input.batchId, slotId),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      blocked: `GHG statement is last — submit ${missing.length} mandatory requirement${missing.length === 1 ? "" : "s"} to Certify first`,
      warnings: [],
      updatedAt: now,
    };
  }

  try {
    await mrvJson(
      input.environment,
      ghgStatementSubmitPath(statementId),
      input.credentials,
      {
        body: { ghg_statement_report_url: input.reportUrl.trim() },
      },
    );
    return { ok: true, statementId, warnings: [], updatedAt: now };
  } catch (error) {
    const classified = classifyRegistryFailure(error);
    return {
      ok: false,
      statementId,
      warnings: [],
      error: classified.message,
      updatedAt: now,
    };
  }
}
