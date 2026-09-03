import type { Registry, SpecGroup } from "../types";

/**
 * Registry-level requirements: what every submission to a given registry has to
 * carry, independent of the methodology. Each adapter folder holds its own
 * rulebook, transcribed from the registry's published documents listed in
 * `sources`.
 */

export interface RegistryRulebook {
  registry: Registry;
  /** Registry rulebook version the groups below were transcribed from. */
  version: string;
  submissionLabel: string;
  platform: string;
  sources: string[];
  core: SpecGroup[];
  /** Only attached when the project is an AFOLU / reversal-exposed activity. */
  permanence?: SpecGroup;
}
