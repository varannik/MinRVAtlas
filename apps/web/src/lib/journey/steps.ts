import {
  CATEGORIES,
  METHODOLOGIES,
  METHODOLOGY_BY_ID,
  REGISTRIES,
  REGISTRY_BY_ID,
  STEP_DEFS,
  resolveTask,
} from "./definition";
import type {
  ChoiceSource,
  JourneyStep,
  JourneyTask,
  Methodology,
  Phase,
  Registry,
  StepId,
  TaskState,
} from "./types";

/**
 * The journey for one project: the ten stations, holding the tasks of the
 * registry and methodology chosen in step 2. Before a registry is chosen,
 * each later step holds only the tasks every registry shares.
 */

export const STEP_ORDER: StepId[] = STEP_DEFS.map((step) => step.id);

export const PHASE: Record<StepId, Phase> = Object.fromEntries(
  STEP_DEFS.map((step) => [step.id, step.phase]),
) as Record<StepId, Phase>;

export const VERIFICATION_STEPS = STEP_ORDER.filter((id) => PHASE[id] === "verification");

/** The tasks whose answers decide the plan. */
export const CHOICE_TASKS = ["methodology.category", "methodology.registry", "methodology.pick"] as const;

export interface Plan {
  key: string;
  registry: Registry | null;
  methodology: Methodology | null;
  steps: JourneyStep[];
  stepById: Record<StepId, JourneyStep>;
  /** Every task in this plan. */
  taskById: Record<string, JourneyTask>;
  /** What the registry calls a credit. */
  credit: { one: string; many: string };
}

const plans = new Map<string, Plan>();

function applies(only: string[] | undefined, registry: Registry | null, methodology: Methodology | null): boolean {
  if (!only) return true;
  return only.some((entry) => entry === registry?.id || entry === methodology?.id);
}

export function planFor(registryId: string | null, methodologyId: string | null): Plan {
  const key = `${registryId ?? "-"}|${methodologyId ?? "-"}`;
  const cached = plans.get(key);
  if (cached) return cached;

  const registry = registryId ? (REGISTRY_BY_ID[registryId] ?? null) : null;
  const methodology = methodologyId ? (METHODOLOGY_BY_ID[methodologyId] ?? null) : null;
  const steps = STEP_DEFS.map((def): JourneyStep => {
    const words = { ...def.base, ...(registry ? def.byRegistry[registry.id] : undefined) };
    return {
      id: def.id,
      phase: def.phase,
      label: String(words.label),
      sub: String(words.sub ?? ""),
      caption: String(words.caption ?? ""),
      gate: String(words.gate ?? ""),
      tasks: def.tasks
        .filter((task) => applies(task.only, registry, methodology))
        .map((task) => resolveTask(task, def.id, registry?.id ?? null)),
    };
  });
  const plan: Plan = {
    key,
    registry,
    methodology,
    steps,
    stepById: Object.fromEntries(steps.map((step) => [step.id, step])) as Record<StepId, JourneyStep>,
    taskById: Object.fromEntries(steps.flatMap((step) => step.tasks).map((task) => [task.id, task])),
    credit: registry?.credit ?? { one: "credit", many: "credits" },
  };
  plans.set(key, plan);
  return plan;
}

/** The registry and methodology the answers in step 2 point to. */
export function chosen(tasks: Record<string, TaskState | undefined>): {
  category: string | null;
  registryId: string | null;
  methodologyId: string | null;
} {
  const category = tasks["methodology.category"]?.value ?? null;
  const registryValue = tasks["methodology.registry"]?.value;
  const registry = registryValue ? REGISTRY_BY_ID[registryValue] : undefined;
  const registryId = registry?.mapped && registry.category === category ? registry.id : null;
  const methodologyValue = tasks["methodology.pick"]?.value;
  const methodology = methodologyValue ? METHODOLOGY_BY_ID[methodologyValue] : undefined;
  const methodologyId = methodology?.mapped && methodology.registry === registryId ? methodology.id : null;
  return { category, registryId, methodologyId };
}

export function planOf(tasks: Record<string, TaskState | undefined>): Plan {
  const { registryId, methodologyId } = chosen(tasks);
  return planFor(registryId, methodologyId);
}

// ── Choices in step 2 ───────────────────────────────────────────────────────

export interface ChoiceOption {
  value: string;
  label: string;
  detail?: string;
  /** Listed but not selectable yet. */
  disabled?: boolean;
}

/** Options for a choice: fixed in the file, or from the catalogue, narrowed by earlier answers. */
export function choiceOptions(
  task: JourneyTask,
  tasks: Record<string, TaskState | undefined>,
): { options: ChoiceOption[]; hint?: string } {
  if (task.input.type !== "choice") return { options: [] };
  const source: ChoiceSource | undefined = task.input.source;
  if (!source) return { options: (task.input.options ?? []).map((option) => ({ value: option, label: option })) };

  if (source === "categories") {
    return { options: CATEGORIES.map((entry) => ({ value: entry.id, label: entry.label, detail: entry.detail })) };
  }
  const category = tasks["methodology.category"]?.value;
  if (source === "registries") {
    if (!category) return { options: [], hint: "Choose the pathway type first." };
    return {
      options: REGISTRIES.filter((entry) => entry.category === category).map((entry) => ({
        value: entry.id,
        label: entry.label,
        detail: entry.mapped ? entry.pays : "Requirements not mapped yet",
        disabled: !entry.mapped,
      })),
    };
  }
  const { registryId } = chosen(tasks);
  if (!registryId) return { options: [], hint: "Choose the registry first." };
  return {
    options: METHODOLOGIES.filter((entry) => entry.registry === registryId).map((entry) => ({
      value: entry.id,
      label: entry.label,
      detail: entry.mapped
        ? [entry.version, entry.modules.length > 0 ? `with ${entry.modules[0]}` : null].filter(Boolean).join(" · ")
        : "Requirements not mapped yet",
      disabled: !entry.mapped,
    })),
  };
}

/** How an answer reads: catalogue ids become their names. */
export function answerLabel(task: JourneyTask, value: string | undefined): string {
  if (!value || task.input.type !== "choice" || !task.input.source) return value ?? "";
  const source = task.input.source;
  if (source === "categories") return CATEGORIES.find((entry) => entry.id === value)?.label ?? value;
  if (source === "registries") return REGISTRY_BY_ID[value]?.label ?? value;
  const methodology = METHODOLOGY_BY_ID[value];
  return methodology ? [methodology.label, methodology.version].filter(Boolean).join(" · ") : value;
}

// ── Order ───────────────────────────────────────────────────────────────────

export function stepIndex(id: StepId): number {
  return STEP_ORDER.indexOf(id);
}

export function nextStep(id: StepId): StepId {
  if (id === "issued") return "monitor";
  return STEP_ORDER[stepIndex(id) + 1] ?? id;
}

export type StepState = "done" | "current" | "upcoming";

/** Steps before the current one are done; after it, upcoming. */
export function stepState(id: StepId, current: StepId): StepState {
  const a = stepIndex(id);
  const b = stepIndex(current);
  if (a === b) return "current";
  return a < b ? "done" : "upcoming";
}

/** Every task id in the file, whatever the registry: for clearing answers. */
export const ALL_TASK_IDS: { id: string; step: StepId }[] = STEP_DEFS.flatMap((step) =>
  step.tasks.map((task) => ({ id: task.id, step: step.id })),
);
