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
 * Client-safe gate for Sentinel's remaining engines: document V&V and the registry's
 * step-3 rules. Data quality is the quality engine's: the BFF refuses a data write
 * whose period the engine blocks (lib/quality/gate.ts), so Sentinel's DQA and anomaly
 * runs no longer gate a write. Never treat a client `readyToSubmit: true` as enough.
 */

/** Sentinel engines whose job the data quality engine took over. */
const ENGINE_OWNED = new Set<string>(["dqa", "anomaly"]);

function sentinelEngines(pipeline: PipelineResult): PipelineResult {
  return {
    ...pipeline,
    engines: Object.fromEntries(Object.entries(pipeline.engines).filter(([engine]) => !ENGINE_OWNED.has(engine))) as PipelineResult["engines"],
  };
}
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

  if (!computeReadyToSubmit(sentinelEngines(pipeline))) {
    return pipeline.blockReason || "Quality gates are not green";
  }
  return null;
}

export function qualityBlockReason(
  pipeline: PipelineResult,
  classification: RequirementClassification,
): string | null {
  if (pipeline.engines.vv?.status === "failed") {
    return "V&V checkpoint fail — Certify write refused";
  }
  if (pipeline.engines["registry-rules"]?.status === "failed") {
    return "Step-3 methodology fail — Certify write refused";
  }

  for (const engine of classification.engines) {
    if (ENGINE_OWNED.has(engine)) continue;
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
