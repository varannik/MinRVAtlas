import type { Project } from "../../types";
import { assembleSpec } from "../assemble";
import type { RegistryAdapter } from "../types";
import { ISOMETRIC_METHODOLOGIES } from "./methodologies";
import { RULEBOOK } from "./rulebook";

export const isometricAdapter: RegistryAdapter = {
  registry: "Isometric",
  rulebookVersion: RULEBOOK.version,
  submissionLabel: RULEBOOK.submissionLabel,
  platform: "Isometric Certify (MRV API v0)",
  docsUrl: "https://docs.isometric.com/api-reference/introduction",
  // Certify exposes project monitoring requirements over REST, so this adapter
  // reads the real requirement set for any project we hold credentials for.
  supportsLiveRequirements: true,
  sources: RULEBOOK.sources,
  buildSpec(project: Project) {
    const methodology = ISOMETRIC_METHODOLOGIES[project.methodologyKey];
    if (!methodology) {
      return {
        registry: "Isometric" as const,
        methodology: project.methodology,
        specVersion: RULEBOOK.version,
        sources: RULEBOOK.sources,
        groups: [],
      };
    }
    const assembled = assembleSpec(project, RULEBOOK, ISOMETRIC_METHODOLOGIES);
    return {
      ...assembled,
      groups: [methodology.group],
    };
  },
};
