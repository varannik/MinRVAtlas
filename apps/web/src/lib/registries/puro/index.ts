import type { Project } from "../../types";
import { assembleSpec } from "../assemble";
import type { RegistryAdapter } from "../types";
import { PURO_METHODOLOGIES } from "./methodologies";
import { RULEBOOK } from "./rulebook";

export const puroAdapter: RegistryAdapter = {
  registry: "Puro.earth",
  rulebookVersion: RULEBOOK.version,
  submissionLabel: RULEBOOK.submissionLabel,
  platform: RULEBOOK.platform,
  docsUrl: "https://puro.earth/carbon-removal-methods",
  supportsLiveRequirements: false,
  sources: RULEBOOK.sources,
  buildSpec(project: Project) {
    return assembleSpec(project, RULEBOOK, PURO_METHODOLOGIES);
  },
};
