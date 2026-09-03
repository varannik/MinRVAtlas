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
    return assembleSpec(project, RULEBOOK, ISOMETRIC_METHODOLOGIES);
  },
};
