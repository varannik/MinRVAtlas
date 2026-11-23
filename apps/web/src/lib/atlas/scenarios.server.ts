import "server-only";

import type { JourneyScenario } from "@/lib/journey/types";
import { SCENARIO_PK, scenarioSk } from "./keys";
import { getDoc, queryDocs } from "./store.server";

/** Practice journeys' starting points, from the Atlas table. */

/** Every scenario a practice journey can start from. */
export async function listScenarios(): Promise<JourneyScenario[]> {
  return (await queryDocs<JourneyScenario>(SCENARIO_PK, "SCENARIO#")).map((row) => row.stored.doc);
}

export async function getScenario(id: string): Promise<JourneyScenario | null> {
  return (await getDoc<JourneyScenario>(SCENARIO_PK, scenarioSk(id)))?.doc ?? null;
}

/** The scenario by id, else the empty project every journey can start from. */
export async function scenarioOrNew(id: string): Promise<JourneyScenario> {
  const scenario = (await getScenario(id)) ?? (await getScenario("new"));
  if (!scenario) throw new Error("No journey scenarios in the Atlas table. Run `npm run seed`.");
  return scenario;
}
