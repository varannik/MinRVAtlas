import type { BlockStage } from "./types";

/**
 * What happens to a block after it leaves us, per registry. Kept as data so a
 * registry that changes its process is a one-file edit.
 *
 * Who appoints the verifier differs: Isometric selects and pays the VVB; on
 * Puro the supplier engages an auditor from Puro's approved list; on Verra and
 * Gold Standard the proponent contracts an accredited VVB.
 */

export interface PipelineStep {
  stage: Exclude<BlockStage, "issues">;
  label: string;
  /** Who acts at this step. */
  actor: string;
  detail: string;
}

export interface RegistryPipeline {
  registry: string;
  creditName: string;
  steps: PipelineStep[];
}

const PIPELINES: Record<string, RegistryPipeline> = {
  Isometric: {
    registry: "Isometric",
    creditName: "credits",
    steps: [
      { stage: "draft", label: "Draft", actor: "Operator", detail: "Data batched and checked here." },
      { stage: "submitted", label: "GHG statement", actor: "Isometric", detail: "Statement submitted on Certify." },
      { stage: "verification", label: "Verification", actor: "VVB (Isometric-appointed)", detail: "Isometric assigns and pays the verifier." },
      { stage: "issued", label: "Issued", actor: "Isometric", detail: "Credits issued to the registry account." },
    ],
  },
  "Puro.earth": {
    registry: "Puro.earth",
    creditName: "CORCs",
    steps: [
      { stage: "draft", label: "Draft", actor: "Supplier", detail: "Output data batched and checked here." },
      { stage: "submitted", label: "Output report", actor: "Puro.earth", detail: "Output report filed with Puro." },
      { stage: "verification", label: "Output audit", actor: "Auditor (Puro-approved)", detail: "Third-party audit of the output report." },
      { stage: "issued", label: "CORCs issued", actor: "Puro Registry", detail: "CORCs issued to the supplier's account." },
    ],
  },
  "Verra VCS": {
    registry: "Verra VCS",
    creditName: "VCUs",
    steps: [
      { stage: "draft", label: "Monitoring report", actor: "Proponent", detail: "Monitoring report prepared here." },
      { stage: "verification", label: "Verification", actor: "VVB (proponent-contracted)", detail: "Accredited VVB verifies the report." },
      { stage: "submitted", label: "Verra review", actor: "Verra", detail: "Verification report submitted for review." },
      { stage: "issued", label: "VCUs issued", actor: "Verra Registry", detail: "VCUs issued." },
    ],
  },
  "Gold Standard": {
    registry: "Gold Standard",
    creditName: "VERs",
    steps: [
      { stage: "draft", label: "Monitoring report", actor: "Proponent", detail: "Monitoring report prepared here." },
      { stage: "verification", label: "Verification", actor: "VVB (proponent-contracted)", detail: "Accredited VVB verifies the report." },
      { stage: "submitted", label: "GS review", actor: "Gold Standard", detail: "Design & performance review." },
      { stage: "issued", label: "VERs issued", actor: "Gold Standard Registry", detail: "VERs issued." },
    ],
  },
};

const FALLBACK: RegistryPipeline = PIPELINES.Isometric;

export function pipelineFor(registry: string): RegistryPipeline {
  return PIPELINES[registry] ?? FALLBACK;
}

/** Index of the step a block has reached; issues sit on the last step reached. */
export function stepIndex(pipeline: RegistryPipeline, stage: BlockStage, lastStage?: BlockStage): number {
  const target = stage === "issues" ? (lastStage ?? "verification") : stage;
  const index = pipeline.steps.findIndex((step) => step.stage === target);
  return index === -1 ? 0 : index;
}

export const STAGE_META: Record<BlockStage, { label: string; tone: "draft" | "progress" | "verify" | "done" | "alert" }> = {
  draft: { label: "Draft", tone: "draft" },
  submitted: { label: "Submitted", tone: "progress" },
  verification: { label: "With verifier", tone: "verify" },
  issued: { label: "Issued", tone: "done" },
  issues: { label: "Issues raised", tone: "alert" },
};
