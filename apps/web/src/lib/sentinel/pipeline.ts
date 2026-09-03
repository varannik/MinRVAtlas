import "server-only";

import { classifyRequirement, orderedEngines } from "@/lib/requirement-payload";
import { evaluateRegistryRules } from "@/lib/registries/step3";
import type { ItemKind } from "@/lib/types";
import { remapCsv } from "./column-map";
import type { EngineRun, PipelineOrigin, PipelineResult } from "./pipeline-types";
import {
  computeReadyToSubmit,
  pipelineBlockReason,
} from "./pipeline-types";
import { sentinelUpstream, sentinelUpstreamJson } from "./upstream";

const DATA_EXT = /\.(csv|xlsx|xls|parquet|json)$/i;
const DOC_EXT = /\.(pdf|docx?|txt|png|jpe?g|tif{1,2}|html|pptx|json)$/i;
const POLL_MS = 1_500;
const RUN_DEADLINE_MS = 90_000;
const VV_DEADLINE_MS = 25_000;

export type PipelineFile = {
  name: string;
  type: string;
  bytes: Uint8Array;
};

export type PipelineInput = {
  tenantId: string;
  catalogProjectId: string;
  slotId: string;
  batchId: string;
  kind: ItemKind;
  label: string;
  notes: string;
  origin: PipelineOrigin;
  files: PipelineFile[];
  periodStart?: string;
  periodEnd?: string;
};

type RunOut = {
  id: string;
  status: string;
  gate_passed?: boolean | null;
  total_violations?: number;
  readiness_score?: number | null;
  error_message?: string | null;
};

type AnomalyOut = {
  success?: boolean;
  anomalies_detected?: number;
  readiness_score?: number;
  summary?: { critical?: number; high?: number; medium?: number };
};

function isDataFile(name: string): boolean {
  return DATA_EXT.test(name);
}

function isDocFile(name: string): boolean {
  return DOC_EXT.test(name) && !/\.(csv|xlsx|xls|parquet)$/i.test(name);
}

async function pollRun(runId: string): Promise<RunOut> {
  const deadline = Date.now() + RUN_DEADLINE_MS;
  while (Date.now() < deadline) {
    const run = await sentinelUpstreamJson<RunOut>(`v1/runs/${runId}`);
    if (run.status === "completed" || run.status === "failed") return run;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`DQA run ${runId} did not finish within 90s`);
}

async function uploadDataset(
  catalogProjectId: string,
  file: PipelineFile,
): Promise<{
  id: string;
  mappedColumns: Record<string, string>;
  csvText: string | null;
}> {
  let bytes = file.bytes;
  let name = file.name;
  let type = file.type || "text/csv";
  let mappedColumns: Record<string, string> = {};
  let csvText: string | null = null;

  if (name.toLowerCase().endsWith(".csv")) {
    const text = new TextDecoder().decode(file.bytes);
    const remapped = remapCsv(name, text);
    if (remapped) {
      bytes = new TextEncoder().encode(remapped.csv);
      mappedColumns = remapped.mapped;
      csvText = remapped.csv;
      name = name.replace(/\.csv$/i, ".mapped.csv");
      type = "text/csv";
    } else {
      csvText = text;
    }
  }

  const form = new FormData();
  form.set("project_id", catalogProjectId);
  form.set("file", new File([Buffer.from(bytes)], name, { type }));
  const uploaded = await sentinelUpstreamJson<{ id: string }>(
    "v1/datasets/upload",
    { method: "POST", body: form },
  );
  if (!uploaded.id) throw new Error("Dataset upload returned no id");
  return { id: uploaded.id, mappedColumns, csvText };
}

async function runDqa(
  catalogProjectId: string,
  datasetId: string,
): Promise<RunOut> {
  const created = await sentinelUpstreamJson<RunOut>("v1/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dataset_id: datasetId,
      project_id: catalogProjectId,
    }),
  });
  if (!created.id) throw new Error("Create run returned no id");
  return pollRun(created.id);
}

async function runAnomaly(datasetId: string): Promise<AnomalyOut> {
  return sentinelUpstreamJson<AnomalyOut>(`v1/anomaly/run/${datasetId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

async function runVv(
  files: PipelineFile[],
): Promise<{ id: string; detail: string; passed: boolean }> {
  const created = await sentinelUpstreamJson<{ id: string }>("v2/vv/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Board intake ${new Date().toISOString().slice(0, 19)}`,
      registry_slug: "puro_earth_ccs",
      methodology_code: "PURO-CCS-GSC",
      location: "Fujairah",
      project_developer: "44.01",
      vintage_year: 2026,
    }),
  });
  if (!created.id) throw new Error("V&V project create returned no id");

  for (const file of files) {
    const form = new FormData();
    form.set(
      "file",
      new File([Buffer.from(file.bytes)], file.name, {
        type: file.type || "application/octet-stream",
      }),
    );
    form.set("document_type", "monitoring_data");
    const response = await sentinelUpstream(`v2/vv/projects/${created.id}/documents`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.slice(0, 200) || "V&V upload failed");
    }
  }

  await sentinelUpstreamJson(`v2/vv/projects/${created.id}/verify`, {
    method: "POST",
  });

  const deadline = Date.now() + VV_DEADLINE_MS;
  let count = 0;
  while (Date.now() < deadline) {
    const cps = await sentinelUpstreamJson<unknown>(
      `v2/vv/projects/${created.id}/checkpoints`,
    );
    const list = Array.isArray(cps) ? cps : [];
    count = list.length;
    if (count > 0) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return {
    id: created.id,
    detail: count > 0 ? `${count} checkpoints` : "Verification started",
    passed: count > 0,
  };
}

export async function runOperatorPipeline(
  input: PipelineInput,
): Promise<PipelineResult> {
  const classification = classifyRequirement({
    kind: input.kind,
    label: input.label,
  });
  const engines = orderedEngines(classification.engines);
  const now = () => new Date().toISOString();

  const result: PipelineResult = {
    tenantId: input.tenantId,
    projectId: input.catalogProjectId,
    batchId: input.batchId,
    slotId: input.slotId,
    kind: input.kind,
    origin: input.origin,
    engines: Object.fromEntries(
      engines.map((engine) => [engine, { status: "running" } satisfies EngineRun]),
    ),
    updatedAt: now(),
  };

  const dataFiles = input.files.filter((file) => isDataFile(file.name));
  const docFiles = input.files.filter((file) => isDocFile(file.name));
  let csvText: string | null = null;

  try {
    if (engines.includes("dqa")) {
      if (dataFiles.length === 0) {
        result.engines.dqa = {
          status: "failed",
          detail: "Upload a CSV or workbook for DQA",
        };
      } else {
        const uploaded = await uploadDataset(input.catalogProjectId, dataFiles[0]);
        result.datasetId = uploaded.id;
        result.mappedColumns = uploaded.mappedColumns;
        csvText = uploaded.csvText;
        const run = await runDqa(input.catalogProjectId, uploaded.id);
        result.runId = run.id;
        result.gatePassed = run.gate_passed ?? null;
        result.totalViolations = run.total_violations;
        result.readinessScore = run.readiness_score ?? null;
        const passed = run.status === "completed" && run.gate_passed !== false;
        result.engines.dqa = {
          status: passed ? "passed" : "failed",
          detail: `${run.total_violations ?? 0} violations · gate ${
            run.gate_passed ? "pass" : "fail"
          }`,
        };
      }
    }

    if (engines.includes("anomaly")) {
      if (!result.datasetId) {
        result.engines.anomaly = {
          status: "skipped",
          detail: "No dataset from DQA",
        };
      } else {
        try {
          const anomaly = await runAnomaly(result.datasetId);
          const critical = anomaly.summary?.critical ?? 0;
          result.engines.anomaly = {
            status: critical > 0 ? "failed" : "passed",
            detail: `${anomaly.anomalies_detected ?? 0} hits · ${critical} critical`,
          };
        } catch (error) {
          result.engines.anomaly = {
            status: "skipped",
            detail: error instanceof Error ? error.message : "Anomaly unavailable",
          };
        }
      }
    }

    if (engines.includes("vv")) {
      if (docFiles.length === 0) {
        result.engines.vv = {
          status: "skipped",
          detail: "No document files in this drop",
        };
      } else {
        try {
          const vv = await runVv(docFiles);
          result.vvProjectId = vv.id;
          result.engines.vv = {
            status: vv.passed ? "passed" : "failed",
            detail: vv.detail,
          };
        } catch (error) {
          result.engines.vv = {
            status: "failed",
            detail: error instanceof Error ? error.message : "V&V failed",
          };
        }
      }
    }

    if (engines.includes("registry-rules")) {
      const dqaFailed = result.engines.dqa?.status === "failed";
      const anomalyFailed = result.engines.anomaly?.status === "failed";
      if (dqaFailed || anomalyFailed) {
        result.engines["registry-rules"] = {
          status: "skipped",
          detail: dqaFailed
            ? "Blocked until DQA hard gates pass"
            : "Blocked until critical anomalies are cleared",
        };
      } else {
        if (!csvText && dataFiles[0]?.name.toLowerCase().endsWith(".csv")) {
          csvText = new TextDecoder().decode(dataFiles[0].bytes);
        }
        const step3 = evaluateRegistryRules({
          catalogProjectId: input.catalogProjectId,
          slotId: input.slotId,
          kind: input.kind,
          csvText,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        });
        result.registryChecks = step3.checks;
        result.engines["registry-rules"] = {
          status: step3.status,
          detail: step3.detail,
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline failed";
    result.error = message;
    if (result.engines.dqa?.status === "running") {
      result.engines.dqa = { status: "failed", detail: message };
    }
  }

  result.updatedAt = now();
  result.readyToSubmit = computeReadyToSubmit(result);
  result.blockReason = result.readyToSubmit
    ? undefined
    : pipelineBlockReason(result);
  return result;
}
