import {
  classifyRequirement,
  type RequirementClassification,
} from "@/lib/requirement-payload";
import {
  computeReadyToSubmit,
  type PipelineResult,
} from "@/lib/sentinel/pipeline-types";
import type { ItemKind } from "@/lib/types";

/**
 * Client-safe gate. The BFF re-runs this and also confirms DQA with Sentinel.
 * Never treat a client `readyToSubmit: true` as sufficient on its own.
 */
export function slotSubmitBlockReason(
  pipeline: PipelineResult | undefined,
  kind: ItemKind,
  label: string,
  fileCount: number,
): string | null {
  if (fileCount < 1) return "Upload a file before submitting to Certify";
  if (!pipeline) return "Run quality check first";
  if (pipeline.error) return pipeline.error;

  const classification = classifyRequirement({ kind, label });
  const quality = qualityBlockReason(pipeline, classification);
  if (quality) return quality;

  if (!computeReadyToSubmit(pipeline)) {
    return pipeline.blockReason || "Quality gates are not green";
  }
  return null;
}

export function qualityBlockReason(
  pipeline: PipelineResult,
  classification: RequirementClassification,
): string | null {
  if (pipeline.engines.dqa?.status === "failed" || pipeline.gatePassed === false) {
    return "DQA hard-gate fail — Certify write refused";
  }
  if (pipeline.engines.anomaly?.status === "failed") {
    return "Critical anomaly — Certify write refused";
  }
  if (pipeline.engines.vv?.status === "failed") {
    return "V&V checkpoint fail — Certify write refused";
  }
  if (pipeline.engines["registry-rules"]?.status === "failed") {
    return "Step-3 methodology fail — Certify write refused";
  }

  for (const engine of classification.engines) {
    const status = pipeline.engines[engine]?.status;
    if (engine === "vv") {
      if (status !== "passed" && status !== "skipped") {
        return "Document V&V has not passed";
      }
      continue;
    }
    if (status !== "passed") {
      return `${engine} has not passed`;
    }
  }
  return null;
}

export function isGhgStatementSlot(slotId: string, label: string, itemId?: string): boolean {
  const hay = `${slotId} ${label} ${itemId ?? ""}`.toLowerCase();
  if (hay.includes("report")) return false;
  return hay.includes("ghg-statement") || hay.includes("ghg statement");
}
