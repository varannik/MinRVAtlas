import type { ItemKind, ItemState } from "@/lib/types";
import type { QualityEngine } from "@/lib/requirement-payload";

export type PipelineOrigin = "operator-upload";

export type EngineRunStatus =
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "deferred";

export type EngineRun = {
  status: EngineRunStatus;
  detail?: string;
};

export type RegistryCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type PipelineResult = {
  tenantId: string;
  projectId: string;
  batchId: string;
  slotId: string;
  kind: ItemKind;
  origin: PipelineOrigin;
  datasetId?: string;
  runId?: string;
  vvProjectId?: string;
  gatePassed?: boolean | null;
  totalViolations?: number;
  readinessScore?: number | null;
  mappedColumns?: Record<string, string>;
  registryChecks?: RegistryCheck[];
  readyToSubmit?: boolean;
  blockReason?: string;
  engines: Partial<Record<QualityEngine, EngineRun>>;
  error?: string;
  updatedAt: string;
};

export function pipelineKey(
  projectId: string,
  batchId: string,
  slotId: string,
): string {
  return `${projectId}:${batchId}:${slotId}`;
}

function statusOf(
  result: PipelineResult,
  engine: QualityEngine,
): EngineRunStatus | undefined {
  return result.engines[engine]?.status;
}

export function pipelineBlockReason(result: PipelineResult): string | undefined {
  if (result.error) return result.error;
  if (statusOf(result, "dqa") === "failed") {
    return result.engines.dqa?.detail || "DQA hard-gate fail";
  }
  if (statusOf(result, "anomaly") === "failed") {
    return result.engines.anomaly?.detail || "Critical anomaly";
  }
  if (statusOf(result, "vv") === "failed") {
    return result.engines.vv?.detail || "V&V checkpoint fail";
  }
  if (statusOf(result, "registry-rules") === "failed") {
    return result.engines["registry-rules"]?.detail || "Step-3 methodology fail";
  }
  if (statusOf(result, "registry-rules") === "deferred") {
    return "Step-3 not wired";
  }
  return undefined;
}

export function computeReadyToSubmit(result: PipelineResult): boolean {
  if (result.error) return false;
  const entries = Object.entries(result.engines);
  if (entries.length === 0) return false;
  for (const [engine, run] of entries) {
    const status = run?.status;
    if (!status || status === "running" || status === "idle") return false;
    if (status === "failed" || status === "deferred") return false;
    if (engine === "dqa" && status !== "passed") return false;
    if (engine === "anomaly" && status !== "passed") return false;
    if (engine === "registry-rules" && status !== "passed") return false;
  }
  return true;
}

export function itemStateFromPipeline(result: PipelineResult): ItemState {
  const dqa = statusOf(result, "dqa");
  const anomaly = statusOf(result, "anomaly");
  const vv = statusOf(result, "vv");
  const step3 = statusOf(result, "registry-rules");
  if (
    dqa === "running" ||
    anomaly === "running" ||
    vv === "running" ||
    step3 === "running"
  ) {
    return "pending";
  }
  if (dqa === "failed") return "rejected";
  if (anomaly === "failed") return "rejected";
  if (vv === "failed") return "rejected";
  if (step3 === "failed") return "rejected";
  if (result.error) return "rejected";
  if (result.readyToSubmit ?? computeReadyToSubmit(result)) return "complete";
  return "pending";
}
