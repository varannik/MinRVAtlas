export type DefinitionKind =
  | "pdd"
  | "lca"
  | "validation"
  | "safeguards"
  | "site"
  | "other";

export type LcaInput = {
  name: string;
  inputKey?: string;
  type?: string;
  quantityKind?: string;
  bound: boolean;
  datapointId?: string | null;
};

export type LcaComponent = {
  id: string;
  name: string;
  description?: string | null;
  blueprint?: string;
  inputs: LcaInput[];
};

export type LcaGroup = {
  id: string;
  name: string;
  description?: string;
  components: LcaComponent[];
};

export type LcaRecipe = {
  creditType: string;
  groups: LcaGroup[];
};

export type DefinitionArtifact = {
  id: string;
  kind: DefinitionKind;
  title: string;
  detail: string;
  submitted: boolean;
  submittedOn?: string | null;
  href?: string;
  reference?: string;
  recipe?: LcaRecipe;
};

export type ProjectDefinition = {
  projectId: string;
  certifyProjectId: string;
  origin: "registry-api" | "bundled";
  complete: boolean;
  warning?: string;
  createdOn?: string | null;
  artifacts: DefinitionArtifact[];
  flags: {
    hasPdd: boolean;
    hasLca: boolean;
    hasValidation: boolean;
  };
};

export function classifyDefinitionTitle(title: string): DefinitionKind {
  const value = title.toLowerCase();
  if (/\bpdd\b|project design|design document/.test(value)) return "pdd";
  if (/\blca\b|life cycle|lifecycle|ghg entry template|removal template/.test(value)) {
    return "lca";
  }
  if (/validat/.test(value)) return "validation";
  if (/safeguard|stakeholder|environmental & social/.test(value)) return "safeguards";
  if (/site|well|permit|characteri/.test(value)) return "site";
  return "other";
}

export const DEFINITION_KIND_LABEL: Record<DefinitionKind, string> = {
  pdd: "Project design",
  lca: "Life cycle assessment",
  validation: "Validation",
  safeguards: "Safeguards",
  site: "Site characterisation",
  other: "Registry file",
};

export function humanizeKey(value: string): string {
  const trimmed = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return value;
  return trimmed.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function latestDesignDate(artifacts: DefinitionArtifact[]): string | null {
  const dates = artifacts
    .map((row) => row.submittedOn)
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}/.test(value)))
    .map((value) => value.slice(0, 10))
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}
