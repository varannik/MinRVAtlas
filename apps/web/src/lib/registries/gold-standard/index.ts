import type { Project } from "../../types";
import { assembleSpec } from "../assemble";
import type { RegistryAdapter } from "../types";
import { GOLD_STANDARD_METHODOLOGIES } from "./methodologies";
import { RULEBOOK } from "./rulebook";

export const goldStandardAdapter: RegistryAdapter = {
  registry: "Gold Standard",
  rulebookVersion: RULEBOOK.version,
  submissionLabel: RULEBOOK.submissionLabel,
  platform: RULEBOOK.platform,
  docsUrl: "https://globalgoals.goldstandard.org/",
  supportsLiveRequirements: false,
  sources: RULEBOOK.sources,
  buildSpec(project: Project) {
    return assembleSpec(project, RULEBOOK, GOLD_STANDARD_METHODOLOGIES);
  },
};
