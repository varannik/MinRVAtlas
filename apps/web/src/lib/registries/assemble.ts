import type { Project, RequirementSpec, SpecGroup } from "../types";
import type { RegistryRulebook } from "./rulebook";
import type { MethodologyModule } from "./types";

/**
 * Registry rulebook first, then the applied methodology's monitoring
 * parameters. Pure and synchronous so the 3D board can render a project's
 * requirements before — or without — any registry round trip.
 */
export function assembleSpec(
  project: Project,
  rulebook: RegistryRulebook,
  methodologies: Record<string, MethodologyModule>,
): RequirementSpec {
  const methodology = methodologies[project.methodologyKey];

  const groups: SpecGroup[] = [...rulebook.core];
  if (project.afolu && rulebook.permanence) {
    groups.push(rulebook.permanence);
  }
  if (methodology) {
    groups.push(methodology.group);
  }

  return {
    registry: project.registry,
    methodology: project.methodology,
    specVersion: `${rulebook.version} · ${methodology?.version ?? project.methodology}`,
    sources: [...rulebook.sources, ...(methodology?.sources ?? [])],
    groups,
  };
}
