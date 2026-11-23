import type { CapabilityId } from "@/lib/cortex/capabilities";

/**
 * A project's path to credits: validate the facility once, then verify every
 * monitoring period. The steps and what each needs come from journey.yaml,
 * and change with the registry and methodology chosen in step 2.
 */

export type StepId =
  | "setup"
  | "methodology"
  | "onboarding"
  | "package"
  | "validation"
  | "listed"
  | "monitor"
  | "report"
  | "audit"
  | "issued";

export type Phase = "validation" | "verification";

/** A question, a document to upload, or a document Cortex drafts. */
export type TaskKind = "question" | "document" | "generate";

export type ChoiceSource = "categories" | "registries" | "methodologies";

export type TaskInput =
  | { type: "text"; placeholder?: string; multiline?: boolean }
  | { type: "choice"; options?: string[]; source?: ChoiceSource; multi?: boolean }
  | { type: "date" }
  | { type: "number"; unit: string; placeholder?: string }
  | { type: "period" }
  /** pin: where a filed document goes in Cortex (journey.yaml files_to, Evidence by default). */
  | { type: "file"; accept: string; formats: string; pin: CapabilityId }
  | { type: "draft" }
  | { type: "location" };

/** What a Cortex capability does for a task. */
export interface FeatureUse {
  id: CapabilityId;
  doing: string;
}

/**
 * How Cortex helps: not at all (you fill it in), by checking the answer
 * against the registry's rules, or by drafting the document.
 */
export type CortexRole = "none" | "check" | "draft";

export interface CortexHelp {
  role: CortexRole;
  /** A named rule in cortex.ts; otherwise the input type's own check. */
  check?: string;
  /** Capabilities Cortex draws on: the pins on the orb. */
  uses: FeatureUse[];
}

export interface DraftSpec {
  /** Tasks the draft leans on; any not done is flagged. */
  needs: string[];
  lines: string[];
}

export interface JourneyTask {
  id: string;
  step: StepId;
  kind: TaskKind;
  /** Short name, used in lists and on the disc tooltip. */
  label: string;
  /** What is asked. */
  ask: string;
  /** Why it matters. */
  why: string;
  /** Rule the task comes from. */
  rule?: string;
  input: TaskInput;
  cortex: CortexHelp;
  draft?: DraftSpec;
  /** Without it the period's credits can't be calculated or defended. */
  blocks: boolean;
  /** Doesn't hold the step back. */
  optional: boolean;
  /** What Cortex adds once the task is answered. */
  tip?: string;
}

export interface JourneyStep {
  id: StepId;
  phase: Phase;
  /** Name on the canvas. */
  label: string;
  /** Second line on the canvas. */
  sub: string;
  caption: string;
  /** What must be true to move on. */
  gate: string;
  tasks: JourneyTask[];
}

export interface Category {
  id: string;
  label: string;
  detail: string;
}

export interface Registry {
  id: string;
  label: string;
  category: string;
  /** Requirements are in journey.yaml; otherwise listed but not selectable. */
  mapped: boolean;
  credit: { one: string; many: string };
  pays?: string;
  evidence?: string;
  gate?: string;
  clocks?: string;
}

export interface Methodology {
  id: string;
  registry: string;
  label: string;
  version?: string;
  modules: string[];
  detail?: string;
  lock?: string;
  mapped: boolean;
}

export type TaskStatus = "open" | "checking" | "flagged" | "done";

/**
 * A file given on a task. On a saved project, a document Cortex reads is uploaded
 * to the task's pin and `key` is where Cortex keeps it; a spreadsheet keeps its
 * name and fingerprint only. Practice journeys keep the name and size.
 */
export interface FiledFile {
  name: string;
  size: number;
  key?: string;
  /** SHA-256 (base64) of what was given. */
  sha256?: string;
}

export interface TaskState {
  status: TaskStatus;
  value?: string;
  files?: FiledFile[];
  /** Draft lines Cortex produced for a generate task. */
  draft?: string[];
  /** Cortex's verdict on the last answer. */
  note?: string;
  at?: string;
}

/** A practice journey's starting point, by id ("fujairah-mineral", "new"); they live in the Atlas table. */
export type ScenarioId = string;

export interface JourneyScenario {
  id: ScenarioId;
  name: string;
  place: string;
  /** Short state shown in the switcher. */
  tag: string;
  current: StepId;
  /** Monitoring periods already closed. */
  laps: number;
  seed: Record<string, TaskState>;
}
