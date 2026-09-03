import type { DraftStage } from "@/store/requirement-draft-store";
import type { PipelineResult } from "@/lib/sentinel/pipeline-types";

export function draftStageLabel(stage: DraftStage | undefined): string | null {
  if (stage === "running") return "RUNNING";
  if (stage === "complete") return "CHECKED";
  if (stage === "failed") return "DQA FAIL";
  if (stage === "queued") return "STAGED";
  if (stage === "review") return "REVIEW";
  return null;
}

export function pipelineOutcomeLabel(
  result: PipelineResult | undefined,
  stage: DraftStage | undefined,
  submit?: { status?: string; ok?: boolean } | null,
): string | null {
  if (submit?.status === "running") return "SUBMITTING";
  if (submit?.ok || submit?.status === "submitted") return "SUBMITTED";
  if (submit?.status === "failed") return "SUBMIT FAIL";
  if (stage === "running") return "RUNNING";
  if (!result) return draftStageLabel(stage);
  if (result.engines.dqa?.status === "failed") return "DQA FAIL";
  if (result.engines.anomaly?.status === "failed") return "ANOMALY FAIL";
  if (result.engines.vv?.status === "failed") return "V&V FAIL";
  if (result.engines["registry-rules"]?.status === "failed") return "STEP-3 FAIL";
  if (result.readyToSubmit) return "READY";
  return draftStageLabel(stage);
}
