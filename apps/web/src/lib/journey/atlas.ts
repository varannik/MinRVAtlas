import { REGISTRY_BY_ID } from "./definition";
import type { TaskState } from "./types";

/**
 * Opening any Atlas project's journey, whatever its registry. A project saved in
 * Cortex opens its stored journey; any other project opens a practice journey
 * that starts from what the Atlas already knows about it.
 */

/** What the Atlas link tells the journey about a project. */
export interface AtlasProjectHint {
  name: string;
  /** The Atlas registry name, for example "Puro.earth". */
  registry: string | null;
  /** "lat, lng", the same form the location task stores. */
  location: string | null;
}

/** Atlas registry names to journey registry ids (journey.yaml). */
const JOURNEY_REGISTRY: Record<string, string> = {
  "Puro.earth": "puro",
  Isometric: "isometric",
  "Verra VCS": "verra",
  "Gold Standard": "gold-standard",
};

const LOCATION = /^-?\d{1,2}(\.\d+)?,\s*-?\d{1,3}(\.\d+)?$/;
const MAX_NAME = 160;

/** Link from the Atlas to a project's journey. */
export function journeyHref(project: {
  id: string;
  name: string;
  registry: string;
  lat: number;
  lng: number;
}): string {
  const params = new URLSearchParams({ project: project.id, name: project.name, registry: project.registry });
  if (Number.isFinite(project.lat) && Number.isFinite(project.lng)) {
    params.set("at", `${project.lat}, ${project.lng}`);
  }
  return `/journey?${params.toString()}`;
}

/** The hint carried by a journey link, or null when the link names no project. */
export function readAtlasHint(
  name: string | null,
  registry: string | null,
  at: string | null,
): AtlasProjectHint | null {
  const trimmed = name?.trim().slice(0, MAX_NAME);
  if (!trimmed) return null;
  const place = at?.trim() ?? "";
  return {
    name: trimmed,
    registry: registry && Object.hasOwn(JOURNEY_REGISTRY, registry) ? registry : null,
    location: LOCATION.test(place) ? place : null,
  };
}

/** The answers a practice journey for an Atlas project starts with: name, place and registry. */
export function atlasSeed(hint: AtlasProjectHint): Record<string, TaskState> {
  const seed: Record<string, TaskState> = { "setup.name": { status: "done", value: hint.name } };
  if (hint.location) seed["setup.location"] = { status: "done", value: hint.location };
  const registry = hint.registry ? REGISTRY_BY_ID[JOURNEY_REGISTRY[hint.registry]] : undefined;
  // Step 2 only offers registries whose requirements are mapped; leave the rest to the user.
  if (registry?.mapped) {
    seed["methodology.category"] = { status: "done", value: registry.category };
    seed["methodology.registry"] = { status: "done", value: registry.id };
  }
  return seed;
}
