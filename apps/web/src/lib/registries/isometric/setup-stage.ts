import type { ProjectDefinition } from "@/lib/project-definition";
import type { Source } from "./api";
import { parsePddSourceRef } from "./pdd-catalog";
import type { ValidationStage } from "./setup-types";

export function inferValidationStage(
  definition: ProjectDefinition,
  sources: Source[],
): ValidationStage {
  if (definition.flags.hasValidation) return "validated";
  if (definition.flags.hasPdd) return "vvb";
  const hasDraftSources = sources.some((source) => parsePddSourceRef(source.supplier_reference_id));
  if (hasDraftSources) return "pre-screen";
  return "draft";
}

export function setupIsLocked(stage: ValidationStage): boolean {
  return stage === "vvb" || stage === "validated";
}

export const VALIDATION_STEPS: { id: ValidationStage; label: string; n: number }[] = [
  { id: "draft", label: "Draft", n: 1 },
  { id: "pre-screen", label: "Pre-screen", n: 2 },
  { id: "vvb", label: "VVB Review", n: 3 },
  { id: "validated", label: "Validated", n: 4 },
];
