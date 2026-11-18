import { CAPABILITY_BY_ID, type CapabilityId } from "@/lib/cortex/capabilities";
import journeyFile from "./journey.yaml";
import type {
  Category,
  ChoiceSource,
  CortexHelp,
  DraftSpec,
  JourneyTask,
  Methodology,
  Phase,
  Registry,
  StepId,
  TaskInput,
  TaskKind,
} from "./types";

/**
 * Reads journey.yaml: the catalogue for step 2 and the steps with their tasks.
 * A task is stored as written (with its per-registry variants) and resolved
 * for a registry when a plan is built (steps.ts). Mistakes in the file throw
 * here, naming the task, so they show up the first time the page loads.
 */

type Raw = Record<string, unknown>;

interface RawTask extends Raw {
  id: string;
  only?: string[];
  by_registry?: Record<string, Raw>;
}

export interface StepDef {
  id: StepId;
  phase: Phase;
  base: Raw;
  byRegistry: Record<string, Raw>;
  tasks: RawTask[];
}

const STEP_IDS: StepId[] = [
  "setup",
  "methodology",
  "onboarding",
  "package",
  "validation",
  "listed",
  "monitor",
  "report",
  "audit",
  "issued",
];

const ACCEPT: Record<string, { accept: string; formats: string }> = {
  docs: { accept: ".pdf,.docx,.doc", formats: "PDF or Word" },
  sheets: { accept: ".xlsx,.xlsm,.xls,.csv", formats: "Excel or CSV" },
  "docs-sheets": { accept: ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.csv", formats: "PDF, Word, Excel or CSV" },
};

const KINDS: TaskKind[] = ["question", "document", "generate"];
const SOURCES: ChoiceSource[] = ["categories", "registries", "methodologies"];

function fail(where: string, message: string): never {
  throw new Error(`journey.yaml · ${where}: ${message}`);
}

function text(value: unknown, where: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(where, `"${field}" must be text`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function input(raw: unknown, where: string): TaskInput {
  if (!raw || typeof raw !== "object") fail(where, `"input" is missing`);
  const spec = raw as Raw;
  switch (spec.type) {
    case "text":
      return { type: "text", placeholder: optionalText(spec.placeholder), multiline: spec.multiline === true };
    case "choice": {
      const source = spec.source as ChoiceSource | undefined;
      if (source && !SOURCES.includes(source)) fail(where, `unknown choice source "${source}"`);
      const options = list(spec.options);
      if (!source && options.length === 0) fail(where, "a choice needs options or a source");
      return { type: "choice", options: source ? undefined : options, source, multi: spec.multi === true };
    }
    case "date":
    case "period":
    case "draft":
    case "location":
      return { type: spec.type };
    case "number":
      return { type: "number", unit: text(spec.unit, where, "unit"), placeholder: optionalText(spec.placeholder) };
    case "file": {
      const preset = ACCEPT[String(spec.accept)];
      if (!preset) fail(where, `file accept must be one of ${Object.keys(ACCEPT).join(", ")}`);
      return { type: "file", ...preset };
    }
    default:
      fail(where, `unknown input type "${String(spec.type)}"`);
  }
}

function cortex(raw: unknown, where: string): CortexHelp {
  if (raw === "none") return { role: "none", uses: [] };
  if (!raw || typeof raw !== "object") fail(where, `"cortex" must be none or { role, uses }`);
  const spec = raw as Raw;
  const role = spec.role;
  if (role !== "check" && role !== "draft") fail(where, `cortex role must be check or draft`);
  const uses = (Array.isArray(spec.uses) ? spec.uses : []).map((entry, index) => {
    const use = entry as Raw;
    const id = String(use.id) as CapabilityId;
    if (!CAPABILITY_BY_ID[id]) fail(where, `cortex uses an unknown capability "${use.id}"`);
    return { id, doing: text(use.doing, `${where} uses[${index}]`, "doing") };
  });
  if (uses.length === 0) fail(where, "cortex helps but lists no capabilities in uses");
  return { role, check: optionalText(spec.check), uses };
}

function draft(raw: unknown): DraftSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const spec = raw as Raw;
  return { needs: list(spec.needs), lines: list(spec.lines) };
}

/** One task as it reads for a registry (or with no registry chosen yet). */
export function resolveTask(def: RawTask, step: StepId, registryId: string | null): JourneyTask {
  const variant = registryId ? def.by_registry?.[registryId] : undefined;
  const merged: Raw = { ...def, ...variant };
  const where = `${def.id}${registryId ? ` (${registryId})` : ""}`;
  const kind = merged.kind as TaskKind;
  if (!KINDS.includes(kind)) fail(where, `kind must be ${KINDS.join(", ")}`);
  const task: JourneyTask = {
    id: def.id,
    step,
    kind,
    label: text(merged.label, where, "label"),
    ask: text(merged.ask, where, "ask"),
    why: text(merged.why, where, "why"),
    rule: optionalText(merged.rule),
    input: input(merged.input, where),
    cortex: cortex(merged.cortex, where),
    draft: draft(merged.draft),
    blocks: merged.blocks === true,
    optional: merged.optional === true,
    tip: optionalText(merged.tip),
  };
  if (task.kind === "generate" && !task.draft) fail(where, "a generate task needs a draft");
  return task;
}

// ── Load ────────────────────────────────────────────────────────────────────

if (!journeyFile || typeof journeyFile !== "object") throw new Error("journey.yaml didn't load as a document");
const doc = journeyFile as Raw;
const catalog = (doc.catalog ?? {}) as Raw;

export const CATEGORIES: Category[] = (catalog.categories as Raw[]).map((entry) => ({
  id: String(entry.id),
  label: text(entry.label, `category ${entry.id}`, "label"),
  detail: text(entry.detail, `category ${entry.id}`, "detail"),
}));

export const REGISTRIES: Registry[] = (catalog.registries as Raw[]).map((entry) => {
  const credit = (entry.credit ?? {}) as Raw;
  return {
    id: String(entry.id),
    label: text(entry.label, `registry ${entry.id}`, "label"),
    category: String(entry.category),
    mapped: entry.mapped !== false,
    credit: { one: String(credit.one ?? "credit"), many: String(credit.many ?? "credits") },
    pays: optionalText(entry.pays),
    evidence: optionalText(entry.evidence),
    gate: optionalText(entry.gate),
    clocks: optionalText(entry.clocks),
  };
});

export const METHODOLOGIES: Methodology[] = (catalog.methodologies as Raw[]).map((entry) => ({
  id: String(entry.id),
  registry: String(entry.registry),
  label: text(entry.label, `methodology ${entry.id}`, "label"),
  version: optionalText(entry.version),
  modules: list(entry.modules),
  detail: optionalText(entry.detail),
  lock: optionalText(entry.lock),
  mapped: entry.mapped === true,
}));

export const REGISTRY_BY_ID: Record<string, Registry> = Object.fromEntries(REGISTRIES.map((entry) => [entry.id, entry]));
export const METHODOLOGY_BY_ID: Record<string, Methodology> = Object.fromEntries(
  METHODOLOGIES.map((entry) => [entry.id, entry]),
);

export const STEP_DEFS: StepDef[] = (doc.steps as Raw[]).map((entry) => {
  const id = entry.id as StepId;
  if (!STEP_IDS.includes(id)) fail(`step ${String(entry.id)}`, "unknown step id");
  const { tasks, by_registry: byRegistry, ...base } = entry;
  return {
    id,
    phase: entry.phase === "verification" ? "verification" : "validation",
    base,
    byRegistry: (byRegistry ?? {}) as Record<string, Raw>,
    tasks: (tasks as RawTask[]) ?? [],
  };
});

if (STEP_DEFS.map((step) => step.id).join() !== STEP_IDS.join()) {
  fail("steps", `must list the stations in order: ${STEP_IDS.join(", ")}`);
}

// Resolve every task for every registry once, so a mistake in any variant
// shows on load rather than when that registry is picked.
for (const step of STEP_DEFS) {
  for (const task of step.tasks) {
    resolveTask(task, step.id, null);
    for (const registry of REGISTRIES) resolveTask(task, step.id, registry.id);
  }
}
