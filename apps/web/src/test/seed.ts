import { readFileSync } from "node:fs";
import path from "node:path";

import { mrvKey } from "@/lib/atlas/keys";
import type { JourneyScenario } from "@/lib/journey/types";
import type { MrvDataset } from "@/lib/mrv/types";
import type { Project } from "@/lib/types";

/**
 * The seed data (apps/web/seed) as test fixtures: the same tenants, projects,
 * scenarios and monitoring histories `npm run seed` loads into the Atlas table
 * and bucket. Tests only; nothing in the app imports this.
 */

const SEED_DIR = path.join(process.cwd(), "seed");

function read<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(SEED_DIR, relative), "utf8")) as T;
}

export const SEED_PROJECTS = read<Project[]>("catalog/projects.json");
export const SEED_SCENARIOS = read<JourneyScenario[]>("journey/scenarios.json");

export function seedProject(id: string): Project {
  const project = SEED_PROJECTS.find((entry) => entry.id === id);
  if (!project) throw new Error(`No seeded project ${id}`);
  return project;
}

export function seedScenario(id: string): JourneyScenario {
  const scenario = SEED_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`No seeded scenario ${id}`);
  return scenario;
}

export function seedDataset(project: Project): MrvDataset {
  return read<MrvDataset>(mrvKey(project.tenantId, project.registry, project.id));
}
