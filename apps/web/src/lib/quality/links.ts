import { STEP_DEFS, resolveTask } from "@/lib/journey/definition";
import { walk } from "@/lib/mrv/calc/tree";
import type { CalcSpec } from "@/lib/mrv/calc/types";
import type { QualityFinding } from "./types";

/**
 * Where a finding leads: the calculation terms that read its meter or dated value,
 * and the journey task its records are filed on.
 */

let tasks: Map<string, string> | null = null;

/** "Monitor · Chain reconciliation" for a journey task id, or null when the journey has no such task. */
export function taskLabel(taskId: string | undefined): string | null {
  if (!taskId) return null;
  tasks ??= new Map(
    STEP_DEFS.flatMap((step) => {
      const stepLabel = typeof step.base.label === "string" ? step.base.label : step.id;
      return step.tasks.map((raw) => {
        const task = resolveTask(raw, step.id, null);
        return [task.id, `${stepLabel} · ${task.label}`] as const;
      });
    }),
  );
  return tasks.get(taskId) ?? null;
}

/** The input terms of the tree that read the finding's meter or dated value. */
export function termsFor(spec: CalcSpec | null, finding: Pick<QualityFinding, "metric" | "fixedKey">): { symbol: string; label: string }[] {
  if (!spec || (!finding.metric && !finding.fixedKey)) return [];
  const found: { symbol: string; label: string }[] = [];
  walk(spec.root, (node) => {
    if (node.kind !== "input") return;
    const source = node.source;
    const match =
      (source.type === "series" && source.metric === finding.metric) || (source.type === "fixed" && source.key === finding.fixedKey);
    if (match && !found.some((term) => term.symbol === node.symbol)) found.push({ symbol: node.symbol, label: node.label });
  });
  return found;
}
