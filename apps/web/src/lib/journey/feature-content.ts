import type { CapabilityId } from "@/lib/cortex/capabilities";
import type { StagedItem } from "@/store/cortex-store";
import type { Plan } from "./steps";
import type { JourneyTask, TaskState } from "./types";

/**
 * What a Cortex feature has to work with for a task: what was added to it on
 * the Cortex page, plus what this journey already gives it (the methodology
 * chosen in step 2, the registry rule built in for the task, files filed and
 * answers given). Shown on the feature's pin beside Cortex.
 */

export interface FeatureContent {
  count: number;
  /** "3 rules" or "No rules yet". */
  label: string;
  /** Where the count comes from, for a tooltip. */
  sources: string[];
}

/** What each feature holds, singular and plural, after the kind of thing it takes in. */
const NOUN: Record<CapabilityId, [string, string]> = {
  datasets: ["stream", "streams"],
  connectors: ["source", "sources"],
  evidence: ["document", "documents"],
  rules: ["rule", "rules"],
  runs: ["run", "runs"],
  anomaly: ["baseline", "baselines"],
  violations: ["verdict", "verdicts"],
  corrections: ["correction", "corrections"],
  calibration: ["calibration record", "calibration records"],
  knowledge: ["entry", "entries"],
  protocols: ["methodology", "methodologies"],
  models: ["model", "models"],
  verification: ["verification", "verifications"],
  reviewer: ["review record", "review records"],
  reports: ["report", "reports"],
  schedules: ["schedule", "schedules"],
};

const plural = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`;

export function featureContent(
  id: CapabilityId,
  context: {
    staged: StagedItem[];
    tasks: Record<string, TaskState | undefined>;
    plan: Plan;
    task: JourneyTask;
  },
): FeatureContent {
  const noun = NOUN[id];
  const sources: string[] = [];
  let count = 0;

  const added = context.staged.filter((item) => item.capabilityId === id).length;
  if (added > 0) {
    count += added;
    sources.push(`${plural(added, noun)} added in Cortex`);
  }

  switch (id) {
    // The registry's own clauses (fee tiers, exclusions, buffer shares) are
    // part of its protocol, not data-quality rules: the Rules pin only counts
    // rule sets added in Cortex, which run on measured data.
    case "protocols":
      if (context.plan.methodology) {
        count += 1;
        const { label, version } = context.plan.methodology;
        sources.push(`${[label, version].filter(Boolean).join(" ")}, chosen in step 2`);
      }
      if (context.task.rule) sources.push(`Checks ${context.task.rule}`);
      break;
    case "evidence": {
      const files = new Set(Object.values(context.tasks).flatMap((state) => state?.files?.map((file) => file.name) ?? []));
      if (files.size > 0) {
        count += files.size;
        sources.push(`${plural(files.size, noun)} filed in this journey`);
      }
      break;
    }
    case "knowledge": {
      const answers = Object.values(context.tasks).filter(
        (state) => state?.value && (state.status === "done" || state.status === "flagged"),
      ).length;
      if (answers > 0) {
        count += answers;
        sources.push(`${answers} answer${answers === 1 ? "" : "s"} given in this journey`);
      }
      break;
    }
  }

  return {
    count,
    label: count > 0 ? plural(count, noun) : `No ${noun[1]} yet`,
    sources: sources.length > 0 ? sources : ["Nothing added in Cortex yet"],
  };
}
