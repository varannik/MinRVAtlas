import { formatAnswer } from "./cortex";
import { JOURNEY_VERSION } from "./definition";
import { stepProgress, taskState, type JourneyRecord } from "./engine";
import { planOf, stepState } from "./steps";

/**
 * A saved journey as Cortex reads it (the journey___status tool, which reads it
 * from the stored item): every step with its progress and every task with its
 * status, answer, files and Cortex's note. Built here, by the same code the
 * journey page runs, so the tool never re-derives the journey's rules.
 */

const ANSWER_CHARS = 300;
const NOTE_CHARS = 300;

export interface TaskSummary {
  id: string;
  label: string;
  kind: string;
  status: string;
  optional?: true;
  blocks?: true;
  answer?: string;
  files?: { name: string; in_cortex: boolean }[];
  draft_lines?: number;
  note?: string;
  rule?: string;
  answered_at?: string;
}

export interface StepSummary {
  id: string;
  label: string;
  phase: string;
  /** done, current or upcoming, from where the project is. */
  place: string;
  gate: string;
  done: number;
  total: number;
  flagged: number;
  tasks: TaskSummary[];
}

export interface JourneySummary {
  definition: string;
  registry: string | null;
  methodology: string | null;
  current: string;
  periods_closed: number;
  steps: StepSummary[];
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function journeySummary(record: JourneyRecord): JourneySummary {
  const plan = planOf(record.tasks);
  const methodology = plan.methodology ? [plan.methodology.label, plan.methodology.version].filter(Boolean).join(" ") : null;
  return {
    definition: JOURNEY_VERSION,
    registry: plan.registry?.label ?? null,
    methodology,
    current: record.current,
    periods_closed: record.laps,
    steps: plan.steps.map((step) => {
      const progress = stepProgress(step, record.tasks);
      return {
        id: step.id,
        label: step.label,
        phase: step.phase,
        place: stepState(step.id, record.current),
        gate: step.gate,
        done: progress.done,
        total: progress.total,
        flagged: progress.flagged,
        tasks: step.tasks.map((task) => {
          const state = taskState(record.tasks, task.id);
          const summary: TaskSummary = { id: task.id, label: task.label, kind: task.kind, status: state.status };
          if (task.optional) summary.optional = true;
          if (task.blocks) summary.blocks = true;
          if (task.rule) summary.rule = task.rule;
          const answer = task.input.type === "file" || task.input.type === "draft" ? "" : formatAnswer(task, state);
          if (answer) summary.answer = clip(answer, ANSWER_CHARS);
          if (state.files?.length) summary.files = state.files.map((file) => ({ name: file.name, in_cortex: Boolean(file.key) }));
          if (state.draft?.length) summary.draft_lines = state.draft.length;
          if (state.note) summary.note = clip(state.note, NOTE_CHARS);
          if (state.at) summary.answered_at = state.at;
          return summary;
        }),
      };
    }),
  };
}
