import type { CapabilityId } from "@/lib/cortex/capabilities";
import type { FeatureUse, JourneyTask } from "./types";

/**
 * The Cortex capabilities a task draws on come from journey.yaml
 * (`cortex.uses`). Shown as pins on Cortex beside an open step, and as chips
 * in the panel; each opens that capability in Cortex.
 */

export type { FeatureUse };

/** The capability's page in Cortex, with a way back to this journey. */
export function cortexHref(id: CapabilityId, scenarioId: string): string {
  const back = encodeURIComponent(`/journey?project=${scenarioId}`);
  return `/cortex?pin=${id}&back=${back}`;
}

export function featuresFor(task: JourneyTask): FeatureUse[] {
  return task.cortex.uses;
}
