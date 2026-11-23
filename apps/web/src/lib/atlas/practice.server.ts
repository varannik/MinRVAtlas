import "server-only";

import type { SessionPayload } from "@/lib/auth/session";
import { MAX_VALUE_CHARS, applyAction, settledTasks, type JourneyAction, type JourneyRecord, type Outcome, type Tasks } from "@/lib/journey/engine";
import { ALL_TASK_IDS } from "@/lib/journey/steps";
import { practiceSk, userPk } from "./keys";
import { scenarioOrNew } from "./scenarios.server";
import { AtlasConflict, getDoc, putDoc } from "./store.server";

/**
 * Practice journeys, one per person per starting point, in the Atlas table.
 * They start from a scenario (seeded in the table) plus any answers they
 * begin with, and change only through the journey engine, as a project's
 * stored journey does. Nothing about them is kept in the browser.
 */

export interface PracticeJourney extends JourneyRecord {
  scenarioId: string;
  /** Answers it began with (an Atlas project's name, place and registry), or null. */
  seed: Tasks | null;
  name: string;
  place: string;
  tag: string;
}

export interface StoredPractice {
  journey: PracticeJourney;
  version: number;
}

export class PracticeConflict extends Error {
  constructor(readonly current: StoredPractice) {
    super("This practice journey changed in another tab. It now shows that version.");
  }
}

const KEY = /^[a-z0-9][a-z0-9-]{0,99}$/;
const TASK_IDS = new Set(ALL_TASK_IDS.map((entry) => entry.id));

export function isPracticeKey(key: string): boolean {
  return KEY.test(key);
}

/** Answers a practice may begin with: done tasks of the journey, with short values. */
export function parseSeed(raw: unknown): Tasks | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("seed must be an object");
  const seed: Tasks = {};
  for (const [id, state] of Object.entries(raw as Record<string, unknown>)) {
    const value = (state as { value?: unknown })?.value;
    if (!TASK_IDS.has(id) || (value !== undefined && (typeof value !== "string" || value.length > MAX_VALUE_CHARS))) {
      throw new Error(`seed has an unknown or oversized answer: ${id}`);
    }
    seed[id] = { status: "done", ...(typeof value === "string" ? { value } : {}) };
  }
  return Object.keys(seed).length ? seed : null;
}

function keys(session: SessionPayload, key: string) {
  return { pk: userPk(session.tenantId, session.sub), sk: practiceSk(key) };
}

export async function loadPractice(session: SessionPayload, key: string): Promise<StoredPractice | null> {
  const { pk, sk } = keys(session, key);
  const stored = await getDoc<PracticeJourney>(pk, sk);
  return stored ? { journey: { ...stored.doc, tasks: settledTasks(stored.doc.tasks) }, version: stored.version } : null;
}

/** Opens the practice, starting it if there is none yet; `restart` starts it again from its scenario. */
export async function startPractice(
  session: SessionPayload,
  key: string,
  scenarioId: string,
  seed: Tasks | null,
  restart: boolean,
): Promise<StoredPractice> {
  const existing = await loadPractice(session, key);
  if (existing && !restart) return existing;
  const scenario = await scenarioOrNew(scenarioId);
  const journey: PracticeJourney = {
    current: scenario.current,
    laps: scenario.laps,
    tasks: { ...structuredClone(scenario.seed), ...(seed ? structuredClone(seed) : {}) },
    scenarioId: scenario.id,
    seed,
    name: seed?.["setup.name"]?.value ?? scenario.name,
    place: scenario.place,
    tag: scenario.tag,
  };
  const { pk, sk } = keys(session, key);
  try {
    const version = await putDoc(pk, sk, journey, existing?.version ?? 0);
    return { journey, version };
  } catch (error) {
    // Another tab started it first: open that one.
    if (error instanceof AtlasConflict) {
      const now = await loadPractice(session, key);
      if (now) return now;
    }
    throw error;
  }
}

/** Runs one change from the version the browser last saw. */
export async function applyPractice(
  session: SessionPayload,
  key: string,
  version: number,
  action: JourneyAction,
): Promise<{ practice: StoredPractice; outcome: Outcome }> {
  const stored = await loadPractice(session, key);
  if (!stored) throw new Error("Start this practice journey first.");
  if (stored.version !== version) throw new PracticeConflict(stored);
  const outcome = applyAction(stored.journey, action, new Date().toISOString());
  const journey: PracticeJourney = { ...stored.journey, ...outcome.record };
  const { pk, sk } = keys(session, key);
  try {
    const next = await putDoc(pk, sk, journey, stored.version);
    return { practice: { journey, version: next }, outcome };
  } catch (error) {
    if (error instanceof AtlasConflict) {
      const now = await loadPractice(session, key);
      if (now) throw new PracticeConflict(now);
    }
    throw error;
  }
}
