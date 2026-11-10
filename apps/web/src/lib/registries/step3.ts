import { getProject } from "@/lib/projects";
import { getRequirementSpec } from "@/lib/registries";
import { bindMethodologySlot } from "@/lib/slot-schema";
import { isInsituMethodology } from "@/lib/stream-schema";
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
  label?: string;
};

function skipped(detail: string): Step3Evaluation {
  return { status: "skipped", detail, checks: [] };
}

function cadenceForSlot(
  catalogProjectId: string,
  slotId: string,
  label?: string,
): string | null {
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
  const bound = bindMethodologySlot(slotId, label);
  if (!bound) return null;
  for (const group of spec.groups) {
    for (const item of group.items) {
      if (item.id === bound) return item.cadence ?? null;
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
  // Keyed on methodology, not registry: in-situ storage runs the same maths
  // under Isometric or Puro. Never routed through Sentinel’s Puro stub.
  if (!isInsituMethodology(project.methodologyKey)) {
    return skipped(
      `No Step-3 checks for ${project.registry} methodology ${project.methodologyKey}`,
    );
  }
  const bound = bindMethodologySlot(input.slotId, input.label);
  return evaluateInsituMineralization({
    slotId: bound ? `${bound}` : input.slotId,
    kind: input.kind,
    csvText: input.csvText,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    cadence: cadenceForSlot(input.catalogProjectId, input.slotId, input.label),
  });
}
