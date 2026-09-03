import type { Project, Registry, RequirementSpec } from "../types";
import { goldStandardAdapter } from "./gold-standard";
import { isometricAdapter } from "./isometric";
import { puroAdapter } from "./puro";
import type { RegistryAdapter } from "./types";
import { verraAdapter } from "./verra";

export type {
  FallbackReason,
  LiveSpecMeta,
  MethodologyModule,
  RegistryAdapter,
  RegistryConnection,
  RegistryEnvironment,
  SpecOrigin,
} from "./types";
export { REGISTRY_CONNECTIONS, findConnection, hasConnection } from "./connections";

/**
 * One adapter per registry. Everything in here is safe to import from the
 * browser: adapters expose the bundled rulebook only. Live reads live in each
 * adapter's `server.ts` and are reachable exclusively through the API route.
 */
export const REGISTRY_ADAPTERS: Record<Registry, RegistryAdapter> = {
  "Verra VCS": verraAdapter,
  "Gold Standard": goldStandardAdapter,
  "Puro.earth": puroAdapter,
  Isometric: isometricAdapter,
};

export function getAdapter(registry: Registry): RegistryAdapter {
  return REGISTRY_ADAPTERS[registry];
}

/**
 * The requirement set from the bundled rulebook. Synchronous, so the board can
 * always render something while a live read is in flight.
 */
export function getRequirementSpec(project: Project): RequirementSpec {
  return getAdapter(project.registry).buildSpec(project);
}

export function specItemCount(spec: RequirementSpec): number {
  return spec.groups.reduce((sum, group) => sum + group.items.length, 0);
}
