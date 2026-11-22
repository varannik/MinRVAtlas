"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  JourneyRefusal,
  applyAction,
  settledTasks,
  stepProgress,
  taskState,
  type JourneyAction,
  type JourneyRecord,
  type Outcome,
  type Tasks,
} from "@/lib/journey/engine";
import { SCENARIO_BY_ID } from "@/lib/journey/scenarios";
import { ALL_TASK_IDS, planOf, stepIndex, type Plan } from "@/lib/journey/steps";
import type { JourneyStep, ScenarioId, StepId, TaskState } from "@/lib/journey/types";

export { stepProgress, taskState };

/**
 * Where a project is on its journey, and what has been given so far.
 *
 * A stored project (one of the user's Cortex projects) lives on the server:
 * every answer is sent to /api/journey/<project>, which runs Cortex's check and
 * saves it, so another device or colleague sees the same journey. The review
 * scenarios are practice: the same rules run in this tab and nothing is saved.
 *
 * `base` is the journey as last settled; `pending` holds answers being checked.
 * What the page shows (current, laps, tasks) is base with pending laid over it.
 */

const CHECK_MS = 1100;

type Answer = Pick<TaskState, "value" | "files">;

export interface JourneyProject {
  id: string;
  name: string;
  /** The stored version the next change must start from. */
  version: number;
  /** False until the first change is saved (the page shows the starting point). */
  stored: boolean;
  canEdit: boolean;
}

export type JourneySync =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "saving" }
  | { state: "error"; message: string };

/** What opening a stored project came to. */
export type OpenResult = "open" | "unavailable" | "failed" | "superseded";

interface StoredJourney extends JourneyRecord {
  version: number;
  stored: boolean;
}

interface JourneyState extends JourneyRecord {
  scenarioId: ScenarioId;
  /** The stored project open, or null while a practice scenario is open. */
  project: JourneyProject | null;
  /** Answers the open practice journey began with (an Atlas project's name, place, registry), or null. */
  practiceSeed: Tasks | null;
  sync: JourneySync;
  base: JourneyRecord;
  pending: Tasks;
  selectedStep: StepId | null;
  selectedTask: string | null;
  hoveredStep: StepId | null;
  hoveredTask: string | null;
  /** Bumped on every load so late answers for an earlier journey are dropped. */
  epoch: number;
  /** Start a practice journey; `seed` adds answers it begins with (an Atlas project's name, place, registry). */
  load: (id: ScenarioId, seed?: Tasks) => void;
  openProject: (projectId: string, name?: string) => Promise<OpenResult>;
  selectStep: (id: StepId | null) => void;
  selectTask: (id: string | null) => void;
  hoverStep: (id: StepId | null) => void;
  hoverTask: (id: string | null) => void;
  answer: (taskId: string, answer: Answer) => void;
  draft: (taskId: string) => void;
  accept: (taskId: string) => void;
  advance: () => Promise<void>;
  dismissError: () => void;
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

function scenarioRecord(id: ScenarioId): JourneyRecord {
  const scenario = SCENARIO_BY_ID[id];
  return { current: scenario.current, laps: scenario.laps, tasks: structuredClone(scenario.seed) };
}

/** What the page shows: the settled journey with answers being checked laid over it. */
function shown(base: JourneyRecord, pending: Tasks): JourneyRecord {
  return { current: base.current, laps: base.laps, tasks: Object.keys(pending).length ? { ...base.tasks, ...pending } : base.tasks };
}

function without(pending: Tasks, taskId: string | undefined): Tasks {
  if (!taskId || !(taskId in pending)) return pending;
  const next = { ...pending };
  delete next[taskId];
  return next;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Changes to a stored project go one at a time, each from the version the last one saved. */
let saving: Promise<void> = Promise.resolve();

export const useJourney = create<JourneyState>()(
  persist(
    (set, get) => {
      /** After an answer settles: move to the next task in the step still needing work. */
      const following = (taskId: string | undefined, tasks: Tasks, ok: boolean | undefined): string | null => {
        const state = get();
        if (!taskId) return state.selectedTask;
        const plan = planOf(tasks);
        const task = plan.taskById[taskId];
        if (!ok || !task || state.selectedTask !== taskId) return state.selectedTask;
        const list = plan.stepById[task.step].tasks;
        const at = list.findIndex((entry) => entry.id === taskId);
        const ahead = [...list.slice(at + 1), ...list.slice(0, at)];
        return ahead.find((entry) => taskState(tasks, entry.id).status !== "done")?.id ?? taskId;
      };

      /** Make a settled journey the base, keeping other answers still being checked. */
      const settle = (base: JourneyRecord, outcome: { taskId?: string; ok?: boolean }, extra: Partial<JourneyState> = {}) => {
        const pending = without(get().pending, outcome.taskId);
        const view = shown(base, pending);
        set({ base, pending, ...view, ...extra });
        set({ selectedTask: following(outcome.taskId, view.tasks, outcome.ok) });
      };

      const fail = (message: string, taskId?: string) => {
        const pending = without(get().pending, taskId);
        set({ pending, ...shown(get().base, pending), sync: { state: "error", message } });
      };

      const fromServer = (journey: StoredJourney, project: JourneyProject): Partial<JourneyState> => ({
        project: { ...project, version: journey.version, stored: journey.stored },
      });

      /** Run an action: on the server for a stored project, here for practice. Resolves once it has settled. */
      const run = (action: JourneyAction, checking?: TaskState): Promise<void> => {
        const state = get();
        const taskId = "taskId" in action ? action.taskId : undefined;
        const epoch = state.epoch;
        const project = state.project;
        if (project && !project.canEdit) {
          set({ sync: { state: "error", message: "Your role can read this journey but not change it." } });
          return Promise.resolve();
        }
        if (taskId && checking) {
          const pending = { ...state.pending, [taskId]: { ...checking, status: "checking" as const, note: undefined } };
          set({ pending, ...shown(state.base, pending) });
        }

        if (!project) {
          const apply = () => {
            if (get().epoch !== epoch) return;
            try {
              const outcome: Outcome = applyAction(get().base, action, new Date().toISOString());
              settle(outcome.record, outcome);
            } catch (error) {
              fail(error instanceof JourneyRefusal ? error.message : "That change could not be made.", taskId);
            }
          };
          if (!checking) {
            apply();
            return Promise.resolve();
          }
          return new Promise((resolve) =>
            window.setTimeout(() => {
              apply();
              resolve();
            }, CHECK_MS),
          );
        }

        set({ sync: { state: "saving" } });
        saving = saving.then(async () => {
          if (get().epoch !== epoch) return;
          const current = get().project;
          if (!current) return;
          try {
            const response = await fetch(`/api/journey/${encodeURIComponent(current.id)}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...action, version: current.version }),
            });
            const body = await readJson(response);
            if (get().epoch !== epoch) return;
            const journey = body.journey as StoredJourney | undefined;
            if (response.ok && journey) {
              settle(
                { current: journey.current, laps: journey.laps, tasks: journey.tasks },
                { taskId: typeof body.taskId === "string" ? body.taskId : taskId, ok: body.ok === true },
                {
                  ...fromServer(journey, current),
                  sync: { state: "idle" },
                },
              );
              return;
            }
            if (response.status === 409 && journey) {
              // Someone saved first: show their journey and say so.
              settle({ current: journey.current, laps: journey.laps, tasks: journey.tasks }, { taskId }, fromServer(journey, current));
              fail(String(body.error ?? "Someone else changed this journey."), taskId);
              return;
            }
            fail(String(body.error ?? "Cortex could not save that change."), taskId);
          } catch {
            if (get().epoch === epoch) fail("Cortex could not be reached; the change was not saved.", taskId);
          }
        });
        return saving;
      };

      return {
        scenarioId: "fujairah-mineral",
        project: null,
        practiceSeed: null,
        sync: { state: "idle" },
        base: scenarioRecord("fujairah-mineral"),
        pending: {},
        ...scenarioRecord("fujairah-mineral"),
        selectedStep: null,
        selectedTask: null,
        hoveredStep: null,
        hoveredTask: null,
        epoch: 0,

        load: (id, seed) => {
          const base = scenarioRecord(id);
          if (seed) base.tasks = { ...base.tasks, ...structuredClone(seed) };
          set((state) => ({
            scenarioId: id,
            project: null,
            practiceSeed: seed ? structuredClone(seed) : null,
            sync: { state: "idle" },
            base,
            pending: {},
            ...base,
            selectedStep: null,
            selectedTask: null,
            hoveredStep: null,
            hoveredTask: null,
            epoch: state.epoch + 1,
          }));
        },

        openProject: async (projectId, name) => {
          const epoch = get().epoch + 1;
          const empty = scenarioRecord("new");
          const project: JourneyProject = { id: projectId, name: name ?? projectId, version: 0, stored: false, canEdit: false };
          set({
            project,
            practiceSeed: null,
            sync: { state: "loading" },
            base: empty,
            pending: {},
            ...empty,
            selectedStep: null,
            selectedTask: null,
            epoch,
          });
          try {
            const response = await fetch(`/api/journey/${encodeURIComponent(projectId)}`, { cache: "no-store" });
            const body = await readJson(response);
            if (get().epoch !== epoch) return "superseded";
            const journey = body.journey as StoredJourney | undefined;
            if (response.ok && journey) {
              const info = body.project as { name?: string } | undefined;
              const base = { current: journey.current, laps: journey.laps, tasks: settledTasks(journey.tasks) };
              set({
                base,
                ...base,
                project: { ...project, name: info?.name ?? project.name, version: journey.version, stored: journey.stored, canEdit: body.canEdit === true },
                sync: { state: "idle" },
              });
              return "open";
            }
            set({ sync: { state: "error", message: String(body.error ?? "This project's journey could not be opened.") } });
            return response.status === 503 ? "unavailable" : "failed";
          } catch {
            if (get().epoch !== epoch) return "superseded";
            set({ sync: { state: "error", message: "Cortex could not be reached." } });
            return "failed";
          }
        },

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
          const checking = task.cortex.role === "none" ? undefined : { ...taskState(state.base.tasks, taskId), ...answer };
          void run({ action: "answer", taskId, ...answer }, checking);
        },

        draft: (taskId) => void run({ action: "draft", taskId }, taskState(get().base.tasks, taskId)),

        accept: (taskId) => void run({ action: "accept", taskId }),

        advance: async () => {
          const state = get();
          const plan = planOf(state.tasks);
          if (!stepProgress(plan.stepById[state.current], state.tasks).complete) return;
          const from = state.current;
          const epoch = state.epoch;
          await run({ action: "advance" });
          const next = get();
          if (next.epoch !== epoch || next.current === from) return;
          // Open the step the journey moved to; a closed period starts again at its dates.
          const selectedTask =
            from === "issued" ? "monitor.period" : firstOpenTask(planOf(next.tasks).stepById[next.current], next.tasks);
          set({ selectedStep: next.current, selectedTask });
        },

        dismissError: () => set({ sync: { state: "idle" } }),
      };
    },
    {
      // Practice journeys are kept for this tab, so stepping out to Cortex and back
      // loses nothing; a stored project is read from the server again.
      // v3: stored projects (base and pending).
      name: "minrv-journey-v3",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) =>
        state.project
          ? { project: { ...state.project, version: 0, stored: false, canEdit: false }, selectedStep: state.selectedStep, selectedTask: state.selectedTask }
          : {
              scenarioId: state.scenarioId,
              practiceSeed: state.practiceSeed,
              base: { ...state.base, tasks: settledTasks(state.base.tasks) },
              current: state.base.current,
              laps: state.base.laps,
              tasks: settledTasks(state.base.tasks),
              selectedStep: state.selectedStep,
              selectedTask: state.selectedTask,
            },
    },
  ),
);
