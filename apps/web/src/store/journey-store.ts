"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { checkAnswer, draftFor } from "@/lib/journey/cortex";
import { SCENARIO_BY_ID } from "@/lib/journey/scenarios";
import {
  ALL_TASK_IDS,
  CHOICE_TASKS,
  VERIFICATION_STEPS,
  nextStep,
  planOf,
  stepIndex,
  type Plan,
} from "@/lib/journey/steps";
import type { JourneyStep, ScenarioId, StepId, TaskState } from "@/lib/journey/types";

/**
 * Where a project is on its journey, and what has been given so far. The
 * steps come from the plan the step-2 answers point to (planOf). Kept in this
 * tab only for this review build; nothing is written to a registry.
 */

const CHECK_MS = 1100;

type Answer = Pick<TaskState, "value" | "files">;
type Tasks = Record<string, TaskState>;

interface JourneyState {
  scenarioId: ScenarioId;
  current: StepId;
  laps: number;
  tasks: Tasks;
  selectedStep: StepId | null;
  selectedTask: string | null;
  hoveredStep: StepId | null;
  hoveredTask: string | null;
  /** Bumped on load so late checks from an earlier scenario are dropped. */
  epoch: number;
  load: (id: ScenarioId) => void;
  selectStep: (id: StepId | null) => void;
  selectTask: (id: string | null) => void;
  hoverStep: (id: StepId | null) => void;
  hoverTask: (id: string | null) => void;
  answer: (taskId: string, answer: Answer) => void;
  draft: (taskId: string) => void;
  accept: (taskId: string) => void;
  advance: () => void;
}

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

/** First required task still needing work, then any optional one, then the first task. */
export function firstOpenTask(step: JourneyStep, tasks: Record<string, TaskState | undefined>): string | null {
  const open = (optional: boolean) =>
    step.tasks.find((task) => task.optional === optional && taskState(tasks, task.id).status !== "done");
  return (open(false) ?? open(true) ?? step.tasks[0])?.id ?? null;
}

/** The plan for the answers given so far. */
export function currentPlan(): Plan {
  return planOf(useJourney.getState().tasks);
}

/** The plan, re-rendering when the registry or methodology changes. */
export function usePlan(): Plan {
  return useJourney((state) => planOf(state.tasks));
}

/** Answers given after step 2: what changing the registry or methodology would clear. */
export function laterAnswers(tasks: Tasks): number {
  const after = stepIndex("methodology");
  return ALL_TASK_IDS.filter(({ id, step }) => stepIndex(step) > after && tasks[id]?.status && tasks[id].status !== "open")
    .length;
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

function initial(id: ScenarioId) {
  const scenario = SCENARIO_BY_ID[id];
  return {
    scenarioId: id,
    current: scenario.current,
    laps: scenario.laps,
    tasks: structuredClone(scenario.seed),
    selectedStep: null,
    selectedTask: null,
    hoveredStep: null,
    hoveredTask: null,
  };
}

export const useJourney = create<JourneyState>()(
  persist(
    (set, get) => {
      /** After an answer settles: move to the next task in the step still needing work. */
      const following = (taskId: string, tasks: Tasks, ok: boolean): string | null => {
        const state = get();
        const plan = planOf(tasks);
        const task = plan.taskById[taskId];
        if (!ok || !task || state.selectedTask !== taskId) return state.selectedTask;
        const list = plan.stepById[task.step].tasks;
        const at = list.findIndex((entry) => entry.id === taskId);
        const ahead = [...list.slice(at + 1), ...list.slice(0, at)];
        return ahead.find((entry) => taskState(tasks, entry.id).status !== "done")?.id ?? taskId;
      };

      /** Hold the answer as "checking", then settle it with Cortex's verdict. */
      const settle = (taskId: string, pending: TaskState) => {
        const epoch = get().epoch;
        set((state) => ({ tasks: { ...state.tasks, [taskId]: { ...pending, status: "checking", note: undefined } } }));
        window.setTimeout(() => {
          const state = get();
          if (state.epoch !== epoch) return;
          const plan = planOf(state.tasks);
          const task = plan.taskById[taskId];
          if (!task) return;
          const verdict = checkAnswer(task, pending, state.tasks, { plan, laps: state.laps });
          const tasks: Tasks = {
            ...state.tasks,
            [taskId]: { ...pending, status: verdict.ok ? "done" : "flagged", note: verdict.note || undefined, at: new Date().toISOString() },
          };
          set({ tasks, selectedTask: following(taskId, tasks, verdict.ok) });
        }, CHECK_MS);
      };

      return {
        ...initial("fujairah-mineral"),
        epoch: 0,
        load: (id) => set((state) => ({ ...initial(id), epoch: state.epoch + 1 })),
        selectStep: (id) =>
          set((state) => ({
            selectedStep: id,
            selectedTask: id ? firstOpenTask(planOf(state.tasks).stepById[id], state.tasks) : null,
          })),
        selectTask: (id) =>
          set((state) => {
            if (!id) return { selectedTask: null };
            const task = planOf(state.tasks).taskById[id];
            return task ? { selectedTask: id, selectedStep: task.step } : {};
          }),
        hoverStep: (id) => set({ hoveredStep: id }),
        hoverTask: (id) => set({ hoveredTask: id }),

        answer: (taskId, answer) => {
          const state = get();
          const task = planOf(state.tasks).taskById[taskId];
          if (!task) return;
          const previous = taskState(state.tasks, taskId);
          let tasks = state.tasks;
          let current = state.current;
          let laps = state.laps;

          // A different pathway, registry or methodology changes every later
          // requirement, so the answers given for the old one are cleared.
          if ((CHOICE_TASKS as readonly string[]).includes(taskId) && previous.value && previous.value !== answer.value) {
            tasks = clearAfterChoice(tasks, taskId);
            if (stepIndex(current) > stepIndex("methodology")) {
              current = "methodology";
              laps = 0;
            }
          }
          const pending: TaskState = { ...previous, ...answer };

          if (task.cortex.role === "none") {
            // Nothing for Cortex to check: the input's own check, then done.
            const plan = planOf({ ...tasks, [taskId]: pending });
            const verdict = checkAnswer(task, pending, tasks, { plan, laps });
            const next: Tasks = {
              ...tasks,
              [taskId]: { ...pending, status: verdict.ok ? "done" : "flagged", note: verdict.ok ? undefined : verdict.note, at: new Date().toISOString() },
            };
            set({ tasks: next, current, laps });
            set({ selectedTask: following(taskId, next, verdict.ok) });
            return;
          }

          set({ tasks, current, laps });
          settle(taskId, pending);
        },

        draft: (taskId) => {
          const state = get();
          const plan = planOf(state.tasks);
          const task = plan.taskById[taskId];
          if (!task) return;
          settle(taskId, { ...taskState(state.tasks, taskId), draft: draftFor(task, state.tasks, plan) });
        },

        accept: (taskId) =>
          set((state) => {
            const tasks = { ...state.tasks, [taskId]: { ...taskState(state.tasks, taskId), status: "done" as const } };
            return { tasks, selectedTask: following(taskId, tasks, true) };
          }),

        advance: () => {
          const state = get();
          const plan = planOf(state.tasks);
          if (!stepProgress(plan.stepById[state.current], state.tasks).complete) return;
          const next = nextStep(state.current);

          if (state.current === "issued") {
            // Close the period: the loop starts again, dated from the answer.
            const start = state.tasks["issued.next"]?.value;
            const tasks = { ...state.tasks };
            for (const { id, step } of ALL_TASK_IDS) if (VERIFICATION_STEPS.includes(step)) delete tasks[id];
            if (start) tasks["monitor.period"] = { status: "open", value: `${start}|` };
            set({ current: next, laps: state.laps + 1, tasks, selectedStep: next, selectedTask: "monitor.period" });
            return;
          }

          set({ current: next, selectedStep: next, selectedTask: firstOpenTask(plan.stepById[next], state.tasks) });
        },
      };
    },
    {
      // Kept for this tab only, so stepping out to Cortex and back loses nothing.
      // v2: steps and task ids come from journey.yaml.
      name: "minrv-journey-v2",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        scenarioId: state.scenarioId,
        current: state.current,
        laps: state.laps,
        selectedStep: state.selectedStep,
        selectedTask: state.selectedTask,
        // A check cut short by leaving the page is asked again.
        tasks: Object.fromEntries(
          Object.entries(state.tasks).map(([id, task]) => [
            id,
            task.status === "checking" ? { ...task, status: "open" as const, note: undefined } : task,
          ]),
        ),
      }),
    },
  ),
);
