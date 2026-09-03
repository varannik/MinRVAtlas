import type { Project } from "../../types";
import { assembleSpec } from "../assemble";
import type { RegistryAdapter } from "../types";
import { VERRA_METHODOLOGIES } from "./methodologies";
import { RULEBOOK } from "./rulebook";

export const verraAdapter: RegistryAdapter = {
  registry: "Verra VCS",
  rulebookVersion: RULEBOOK.version,
  submissionLabel: RULEBOOK.submissionLabel,
  platform: RULEBOOK.platform,
  docsUrl: "https://verra.org/programs/verified-carbon-standard/",
  // The Project Hub publishes digital monitoring report schemas, but there is
  // no public read API for them yet, so requirements stay bundled.
  supportsLiveRequirements: false,
  sources: RULEBOOK.sources,
  buildSpec(project: Project) {
    return assembleSpec(project, RULEBOOK, VERRA_METHODOLOGIES);
  },
};
