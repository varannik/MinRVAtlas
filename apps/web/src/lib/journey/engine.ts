import { checkAnswer, draftFor } from "./cortex";
import { ALL_TASK_IDS, CHOICE_TASKS, VERIFICATION_STEPS, nextStep, planOf, stepIndex } from "./steps";
import { isSha256 } from "@/lib/cortex/uploads";
import type { ApprovedValues } from "@/lib/requirements/catalog";
import type { FiledFile, JourneyStep, StepId, TaskState } from "./types";

/**
 * What happens to a project's journey when someone answers, asks for a draft,
 * accepts Cortex's flag or moves on. Pure: the server runs it for a stored
 * project (so the stored status is always Cortex's verdict), the browser runs
 * it for the practice scenarios.
 */

export type Tasks = Record<string, TaskState>;

/** A project's place on the journey and what has been given so far. */
export interface JourneyRecord {
  current: StepId;
  /** Monitoring periods closed so far. */
  laps: number;
  tasks: Tasks;
}

export type FileAnswer = FiledFile;

export type JourneyAction =
  | { action: "answer"; taskId: string; value?: string; files?: FileAnswer[] }
  | { action: "draft"; taskId: string }
  | { action: "accept"; taskId: string }
  | { action: "advance" };

export interface Outcome {
  record: JourneyRecord;
  /** The task the action settled, and whether Cortex passed it. */
  taskId?: string;
  ok?: boolean;
}

/** An action the journey does not allow now; the message is safe to show. */
export class JourneyRefusal extends Error {}

export const MAX_VALUE_CHARS = 4000;
export const MAX_FILES = 50;

export function taskState(tasks: Record<string, TaskState | undefined>, id: string): TaskState {
  return tasks[id] ?? { status: "open" };
}

/** Progress counts required tasks only; optional ones never hold a step back. */
export function stepProgress(step: JourneyStep, tasks: Record<string, TaskState | undefined>) {
  let done = 0;
  let total = 0;
  let flagged = 0;
  let blocking = 0;
  for (const task of step.tasks) {
    const state = taskState(tasks, task.id);
    if (state.status === "flagged") flagged += 1;
    if (task.optional) continue;
    total += 1;
    if (state.status === "done") done += 1;
    else if (task.blocks) blocking += 1;
  }
  return { done, flagged, blocking, total, complete: done === total };
}

/** Clear what depends on a step-2 answer that changed. */
function clearAfterChoice(tasks: Tasks, taskId: string): Tasks {
  const next = { ...tasks };
  const position = CHOICE_TASKS.indexOf(taskId as (typeof CHOICE_TASKS)[number]);
  for (const id of CHOICE_TASKS.slice(position + 1)) delete next[id];
  const after = stepIndex("methodology");
  for (const { id, step } of ALL_TASK_IDS) if (stepIndex(step) > after) delete next[id];
  return next;
}

function taskOf(tasks: Tasks, taskId: string) {
  const task = planOf(tasks).taskById[taskId];
  if (!task) throw new JourneyRefusal("That task is not part of this project's journey.");
  return task;
}

/** Cortex's verdict on a pending answer, as the stored task. */
function settled(record: JourneyRecord, taskId: string, pending: TaskState, now: string, values?: ApprovedValues): Outcome {
  const answers: Tasks = { ...record.tasks, [taskId]: { ...pending, status: "checking", note: undefined } };
  const plan = planOf(answers);
  const task = plan.taskById[taskId];
  if (!task) throw new JourneyRefusal("That task is not part of this project's journey.");
  const verdict = checkAnswer(task, pending, answers, { plan, laps: record.laps, values });
  const state: TaskState = { ...pending, status: verdict.ok ? "done" : "flagged", note: verdict.note || undefined, at: now };
  return { record: { ...record, tasks: { ...record.tasks, [taskId]: state } }, taskId, ok: verdict.ok };
}

function answer(
  record: JourneyRecord,
  taskId: string,
  given: { value?: string; files?: FileAnswer[] },
  now: string,
  values?: ApprovedValues,
): Outcome {
  const task = taskOf(record.tasks, taskId);
  if (given.value !== undefined && given.value.length > MAX_VALUE_CHARS) throw new JourneyRefusal("That answer is too long.");
  if (given.files && given.files.length > MAX_FILES) throw new JourneyRefusal("Too many files for one task.");
  const previous = taskState(record.tasks, taskId);
  let { tasks, current, laps } = record;

  // A different pathway, registry or methodology changes every later
  // requirement, so the answers given for the old one are cleared.
  if ((CHOICE_TASKS as readonly string[]).includes(taskId) && previous.value && previous.value !== given.value) {
    tasks = clearAfterChoice(tasks, taskId);
    if (stepIndex(current) > stepIndex("methodology")) {
      current = "methodology";
      laps = 0;
    }
  }
  const pending: TaskState = { ...previous, ...given };

  if (task.cortex.role === "none") {
    // Nothing for Cortex to check: the input's own check, then done.
    const plan = planOf({ ...tasks, [taskId]: pending });
    const verdict = checkAnswer(task, pending, tasks, { plan, laps, values });
    const state: TaskState = {
      ...pending,
      status: verdict.ok ? "done" : "flagged",
      note: verdict.ok ? undefined : verdict.note,
      at: now,
    };
    return { record: { current, laps, tasks: { ...tasks, [taskId]: state } }, taskId, ok: verdict.ok };
  }
  return settled({ current, laps, tasks }, taskId, pending, now, values);
}

function draft(record: JourneyRecord, taskId: string, now: string, values?: ApprovedValues): Outcome {
  const task = taskOf(record.tasks, taskId);
  if (task.input.type !== "draft") throw new JourneyRefusal("Cortex drafts only the documents it writes.");
  const plan = planOf(record.tasks);
  const pending: TaskState = { ...taskState(record.tasks, taskId), draft: draftFor(task, record.tasks, plan) };
  return settled(record, taskId, pending, now, values);
}

/** Keep an answer Cortex flagged: a person's call, recorded as theirs. */
function accept(record: JourneyRecord, taskId: string, now: string): Outcome {
  const task = taskOf(record.tasks, taskId);
  const state = taskState(record.tasks, taskId);
  if (task.cortex.role === "none" || state.status !== "flagged") {
    throw new JourneyRefusal("Only an answer Cortex flagged can be accepted as it is.");
  }
  return { record: { ...record, tasks: { ...record.tasks, [taskId]: { ...state, status: "done", at: now } } }, taskId, ok: true };
}

function advance(record: JourneyRecord): Outcome {
  const plan = planOf(record.tasks);
  if (!stepProgress(plan.stepById[record.current], record.tasks).complete) {
    throw new JourneyRefusal("This step still has work left.");
  }
  const next = nextStep(record.current);
  if (record.current === "issued") {
    // Close the period: the loop starts again, dated from the answer.
    const start = record.tasks["issued.next"]?.value;
    const tasks = { ...record.tasks };
    for (const { id, step } of ALL_TASK_IDS) if (VERIFICATION_STEPS.includes(step)) delete tasks[id];
    if (start) tasks["monitor.period"] = { status: "open", value: `${start}|` };
    return { record: { current: next, laps: record.laps + 1, tasks } };
  }
  return { record: { ...record, current: next } };
}

/** values: registry values approved for the project (lib/requirements); the built-in ones apply otherwise. */
export function applyAction(record: JourneyRecord, action: JourneyAction, now: string, values?: ApprovedValues): Outcome {
  switch (action.action) {
    case "answer": {
      // Only what was given: an answer without files keeps the files given before, and the reverse.
      const given: { value?: string; files?: FileAnswer[] } = {};
      if (action.value !== undefined) given.value = action.value;
      if (action.files !== undefined) given.files = action.files;
      return answer(record, action.taskId, given, now, values);
    }
    case "draft":
      return draft(record, action.taskId, now, values);
    case "accept":
      return accept(record, action.taskId, now);
    case "advance":
      return advance(record);
  }
}

/** A request body as an action, or null when it is not one. */
export function parseAction(body: unknown): JourneyAction | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const taskId = typeof raw.taskId === "string" && raw.taskId.length <= 80 ? raw.taskId : null;
  switch (raw.action) {
    case "advance":
      return { action: "advance" };
    case "draft":
    case "accept":
      return taskId ? { action: raw.action, taskId } : null;
    case "answer": {
      if (!taskId) return null;
      const value = typeof raw.value === "string" ? raw.value : undefined;
      let files: FileAnswer[] | undefined;
      if (raw.files !== undefined) {
        if (!Array.isArray(raw.files)) return null;
        files = [];
        for (const file of raw.files) {
          const { name, size, key, sha256 } = (file ?? {}) as Record<string, unknown>;
          if (typeof name !== "string" || !name || name.length > 255 || typeof size !== "number" || !(size >= 0)) return null;
          const filed: FileAnswer = { name, size };
          if (key !== undefined) {
            if (typeof key !== "string" || !key || key.length > 1024 || key.includes("..") || key.startsWith("/")) return null;
            filed.key = key;
          }
          if (sha256 !== undefined) {
            if (!isSha256(sha256)) return null;
            filed.sha256 = sha256;
          }
          files.push(filed);
        }
      }
      if (value === undefined && files === undefined) return null;
      return { action: "answer", taskId, value, files };
    }
    default:
      return null;
  }
}

/** A stored task with an interrupted check cannot stay "checking": it is asked again. */
export function settledTasks(tasks: Tasks): Tasks {
  return Object.fromEntries(
    Object.entries(tasks).map(([id, task]) => [
      id,
      task.status === "checking" ? { ...task, status: "open" as const, note: undefined } : task,
    ]),
  );
}
