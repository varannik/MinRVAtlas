"use client";

import { create } from "zustand";

import {
  settledTasks,
  stepProgress,
  taskState,
  type JourneyAction,
  type JourneyRecord,
  type Tasks,
} from "@/lib/journey/engine";
import { ALL_TASK_IDS, planOf, stepIndex, type Plan } from "@/lib/journey/steps";
import type { JourneyStep, ScenarioId, StepId, TaskState } from "@/lib/journey/types";

export { stepProgress, taskState };

/**
 * Where a project is on its journey, and what has been given so far.
 *
 * Every journey lives on the server and every answer goes there, which runs
 * Cortex's check and saves it. A stored project (one of the user's Cortex
 * projects) is at /api/journey/<project>, shared with colleagues. A practice
 * journey is the person's own, at /api/journey/practice/<key> in the Atlas
 * table, started from a scenario there. Nothing is kept in browser storage:
 * this store is the page's memory of what the server last said.
 *
 * `base` is the journey as last settled; `pending` holds answers being checked.
 * What the page shows (current, laps, tasks) is base with pending laid over it.
 */

type Answer = Pick<TaskState, "value" | "files">;

export interface JourneyProject {
  id: string;
  name: string;
  /** Where its journey is read and changed. */
  endpoint: string;
  /** A practice journey (the person's own), not a shared project's. */
  practice: boolean;
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

/** What opening a journey came to. */
export type OpenResult = "open" | "unavailable" | "failed" | "superseded";

interface StoredJourney extends JourneyRecord {
  version: number;
  stored: boolean;
}

/** A practice journey's starting point, as the page names it. */
export interface ScenarioInfo {
  name: string;
  place: string;
  tag: string;
}

interface JourneyState extends JourneyRecord {
  scenarioId: ScenarioId;
  /** The journey open (a stored project or a practice), or null before one is. */
  project: JourneyProject | null;
  /** The open practice journey's starting point, or null for a stored project. */
  scenario: ScenarioInfo | null;
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
  /**
   * Open the person's practice journey on a scenario, starting it on the server
   * if needed; `seed` adds answers it begins with (an Atlas project's name,
   * place, registry); `restart` starts it again from the beginning.
   */
  load: (id: ScenarioId, seed?: Tasks, restart?: boolean) => Promise<OpenResult>;
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

/** Before a journey is read: nothing given, at the first step. */
function emptyRecord(): JourneyRecord {
  return { current: "setup", laps: 0, tasks: {} };
}

/** A practice journey's key: its scenario, or the Atlas project it began from. */
function practiceKey(id: ScenarioId, seed?: Tasks): string {
  const name = seed?.["setup.name"]?.value;
  if (!name) return id;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `atlas-${slug || "project"}`;
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

    /** The journey in a response: a stored project's carries its version; a practice's sits beside it. */
    const journeyIn = (body: Record<string, unknown>): StoredJourney | undefined => {
      const journey = body.journey as StoredJourney | null | undefined;
      if (!journey) return undefined;
      return typeof body.version === "number" ? { ...journey, version: body.version, stored: true } : journey;
    };

    /** Run an action on the server, which checks and saves it. Resolves once it has settled. */
    const run = (action: JourneyAction, checking?: TaskState): Promise<void> => {
      const state = get();
      const taskId = "taskId" in action ? action.taskId : undefined;
      const epoch = state.epoch;
      const project = state.project;
      if (!project) {
        set({ sync: { state: "error", message: "The journey is still opening." } });
        return Promise.resolve();
      }
      if (!project.canEdit) {
        set({ sync: { state: "error", message: "Your role can read this journey but not change it." } });
        return Promise.resolve();
      }
      if (taskId && checking) {
        const pending = { ...state.pending, [taskId]: { ...checking, status: "checking" as const, note: undefined } };
        set({ pending, ...shown(state.base, pending) });
      }

      set({ sync: { state: "saving" } });
      saving = saving.then(async () => {
        if (get().epoch !== epoch) return;
        const current = get().project;
        if (!current) return;
        try {
          const response = await fetch(current.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...action, version: current.version }),
          });
          const body = await readJson(response);
          if (get().epoch !== epoch) return;
          const journey = journeyIn(body);
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
      scenario: null,
      practiceSeed: null,
      sync: { state: "loading" },
      base: emptyRecord(),
      pending: {},
      ...emptyRecord(),
      selectedStep: null,
      selectedTask: null,
      hoveredStep: null,
      hoveredTask: null,
      epoch: 0,

      load: async (id, seed, restart = false) => {
        const epoch = get().epoch + 1;
        const key = practiceKey(id, seed);
        const endpoint = `/api/journey/practice/${encodeURIComponent(key)}`;
        set({
          scenarioId: id,
          project: null,
          scenario: null,
          practiceSeed: seed ? structuredClone(seed) : null,
          sync: { state: "loading" },
          base: emptyRecord(),
          pending: {},
          ...emptyRecord(),
          selectedStep: null,
          selectedTask: null,
          hoveredStep: null,
          hoveredTask: null,
          epoch,
        });
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "start", scenario: id, seed, restart }),
          });
          const body = await readJson(response);
          if (get().epoch !== epoch) return "superseded";
          const journey = body.journey as (JourneyRecord & ScenarioInfo & { seed: Tasks | null }) | undefined;
          if (response.ok && journey && typeof body.version === "number") {
            const base = { current: journey.current, laps: journey.laps, tasks: settledTasks(journey.tasks) };
            set({
              base,
              ...base,
              project: { id: key, name: journey.name, endpoint, practice: true, version: body.version, stored: true, canEdit: true },
              scenario: { name: journey.name, place: journey.place, tag: journey.tag },
              practiceSeed: journey.seed ?? null,
              sync: { state: "idle" },
            });
            return "open";
          }
          set({ sync: { state: "error", message: String(body.error ?? "This practice journey could not be opened.") } });
          return response.status === 503 ? "unavailable" : "failed";
        } catch {
          if (get().epoch !== epoch) return "superseded";
          set({ sync: { state: "error", message: "The server could not be reached." } });
          return "failed";
        }
      },

      openProject: async (projectId, name) => {
        const epoch = get().epoch + 1;
        const empty = emptyRecord();
        const endpoint = `/api/journey/${encodeURIComponent(projectId)}`;
        const project: JourneyProject = { id: projectId, name: name ?? projectId, endpoint, practice: false, version: 0, stored: false, canEdit: false };
        set({
          project,
          scenario: null,
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
          const response = await fetch(endpoint, { cache: "no-store" });
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
);
