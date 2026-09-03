import { getProject } from "@/lib/projects";
import { getRequirementSpec } from "@/lib/registries";
import type { ItemKind } from "@/lib/types";
import {
  evaluateInsituMineralization,
  type Step3Evaluation,
} from "./isometric/step3";

export type { Step3Check, Step3Evaluation } from "./isometric/step3";
export { INSITU_THRESHOLDS } from "./isometric/step3";

export type RegistryRulesInput = {
  catalogProjectId: string;
  slotId: string;
  kind: ItemKind;
  csvText: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
};

function skipped(detail: string): Step3Evaluation {
  return { status: "skipped", detail, checks: [] };
}

function cadenceForSlot(catalogProjectId: string, slotId: string): string | null {
  const project = getProject(catalogProjectId);
  if (!project) return null;
  const spec = getRequirementSpec(project);
  for (const group of spec.groups) {
    for (const item of group.items) {
      const id = `${group.id}.${item.id}`;
      if (slotId === id || slotId.endsWith(`.${item.id}`) || slotId === item.id) {
        return item.cadence ?? null;
      }
    }
  }
  return null;
}

/**
 * Step-3 methodology math for the catalog project. Isometric in-situ
 * mineralisation is implemented here. Other registries are skipped — never
 * routed through Sentinel’s Puro stub.
 */
export function evaluateRegistryRules(input: RegistryRulesInput): Step3Evaluation {
  const project = getProject(input.catalogProjectId);
  if (!project) return skipped("Unknown project");
  if (project.registry !== "Isometric") {
    return skipped(
      `No Step-3 adapter for ${project.registry}. Not using Sentinel’s Puro stub.`,
    );
  }
  if (project.methodologyKey !== "isometric-insitu-mineralization") {
    return skipped(
      `No Step-3 checks for methodology ${project.methodologyKey}`,
    );
  }
  return evaluateInsituMineralization({
    slotId: input.slotId,
    kind: input.kind,
    csvText: input.csvText,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    cadence: cadenceForSlot(input.catalogProjectId, input.slotId),
  });
}
