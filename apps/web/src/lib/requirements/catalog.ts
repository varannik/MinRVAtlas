/**
 * Registry values the journey's checks decide with: a limit, a deadline, a
 * period, a fee. Each has a built-in value (what the checks used before values
 * were stored, with where it came from) and the question Cortex asks the
 * registry's documents to propose it. A person approves a proposal for one
 * registry, methodology and edition; until then the built-in value applies.
 *
 * The rule that matters: these decide outcomes, so they are data a person
 * approved, with the clause and page they came from, never a model's answer.
 */

export type RequirementUnit = "years" | "months" | "days" | "business days" | "bar" | "percent" | "CORCs" | "EUR";

export interface RequirementDef {
  /** Stable id, used by the checks (cortex.ts) and in storage. */
  id: string;
  registry: string;
  /** Knowledge-base methodology slug (as in the Cortex tenancy table), or absent for every methodology of the registry. */
  methodology?: string;
  label: string;
  unit: RequirementUnit;
  builtIn: number;
  /** Where the built-in value was read. */
  builtInSource: string;
  /** What Cortex asks the documents. */
  question: string;
  /** The search, in the words a rules document would use. */
  search: string;
  /** The journey check(s) it decides (journey.yaml `check`). */
  usedBy: string[];
}

const GSC = "puro-geologically-stored-carbon";

export const REQUIREMENTS: readonly RequirementDef[] = [
  {
    id: "puro.crediting_period_years",
    registry: "puro",
    methodology: GSC,
    label: "Crediting period",
    unit: "years",
    builtIn: 15,
    builtInSource: "GSC 2024 v5, 2.2.2",
    question: "How many years does a production facility's crediting period last?",
    search: "crediting period years first monitoring period renewal",
    usedBy: ["crediting-start"],
  },
  {
    id: "puro.bubble_point_margin_bar",
    registry: "puro",
    methodology: GSC,
    label: "Margin above the bubble point",
    unit: "bar",
    builtIn: 5,
    builtInSource: "GSC 2024 v5, 3.2.6",
    question: "By how many bar must the injection pressure stay above the bubble-point pressure of the dissolved CO2?",
    search: "bubble point pressure margin bar dissolved CO2 injection monitoring",
    usedBy: ["bubble-point"],
  },
  {
    id: "puro.reversal_notice_days",
    registry: "puro",
    methodology: GSC,
    label: "Time to report a reversal",
    unit: "days",
    builtIn: 5,
    builtInSource: "GSC 2024 v5, reversal reporting",
    question: "Within how many days must the supplier report a reversal (a release of stored CO2) to Puro?",
    search: "reversal notify Puro within days leakage event report",
    usedBy: ["reversal-notice"],
  },
  {
    id: "puro.validation_window_years",
    registry: "puro",
    label: "Facility audit after the Commitment Date",
    unit: "years",
    builtIn: 3,
    builtInSource: "General Rules 4.4, 2.2.3",
    question: "Within how many years of the Commitment Date must the Production Facility Audit take place?",
    search: "Commitment Date production facility audit within years",
    usedBy: ["validation-window"],
  },
  {
    id: "puro.geological_validation_window_years",
    registry: "puro",
    methodology: GSC,
    label: "Facility audit after the Commitment Date (geological storage)",
    unit: "years",
    builtIn: 5,
    builtInSource: "Certification Procedures 1.2, 5.3.9",
    question: "For geological storage, within how many years of the Commitment Date must the Production Facility Audit take place?",
    search: "geological storage Commitment Date facility audit five years",
    usedBy: ["validation-window"],
  },
  {
    id: "puro.first_period_max_months",
    registry: "puro",
    label: "Longest first monitoring period",
    unit: "months",
    builtIn: 18,
    builtInSource: "General Rules 4.4, 2.4.2",
    question: "How many months may the first monitoring period last at most?",
    search: "first monitoring period maximum months output audit",
    usedBy: ["period-length"],
  },
  {
    id: "puro.period_max_months",
    registry: "puro",
    label: "Longest later monitoring period",
    unit: "months",
    builtIn: 12,
    builtInSource: "General Rules 4.4 (an output report at least every 12 months)",
    question: "How many months may a monitoring period after the first last at most (how often must an output report be submitted)?",
    search: "output report at least every months monitoring period length",
    usedBy: ["period-length"],
  },
  {
    id: "puro.other_scheme_failure_years",
    registry: "puro",
    label: "Look-back for a failed audit under another scheme",
    unit: "years",
    builtIn: 3,
    builtInSource: "Certification Procedures 1.2, 9.8.21",
    question: "For how many years does a failed audit under another carbon scheme exclude a facility from Puro?",
    search: "failed audit other scheme exclusion years eligibility",
    usedBy: ["other-schemes"],
  },
  {
    id: "isometric.fossil_limit_percent",
    registry: "isometric",
    label: "Fossil share that needs a justification",
    unit: "percent",
    builtIn: 5,
    builtInSource: "BioCCS 1.5, R-YJJC-0",
    question: "Above what percentage of fossil carbon in the feedstock must the project justify it in the PDD?",
    search: "fossil fraction percent feedstock justification biogenic",
    usedBy: ["fossil-share"],
  },
  {
    id: "isometric.public_comment_days",
    registry: "isometric",
    label: "Public comment period",
    unit: "days",
    builtIn: 10,
    builtInSource: "Isometric Standard 2.2",
    question: "How many days does the public comment period on a project last at minimum?",
    search: "public comment period days project design document",
    usedBy: ["public-comment"],
  },
  {
    id: "isometric.crediting_lookback_years",
    registry: "isometric",
    label: "How far back the crediting period may start",
    unit: "years",
    builtIn: 5,
    builtInSource: "Isometric Standard 2.2",
    question: "At most how many years before the first registry submission may the crediting period start?",
    search: "crediting period start years before submission",
    usedBy: ["crediting-start"],
  },
  {
    id: "isometric.buffer_percent",
    registry: "isometric",
    label: "Buffer share of each issuance",
    unit: "percent",
    builtIn: 1,
    builtInSource: "Isometric Standard 2.2",
    question: "What percentage of each issuance goes to the buffer pool for this storage type?",
    search: "buffer pool percentage issuance reversal risk",
    usedBy: ["buffer", "issued-count"],
  },
  {
    id: "isometric.bubble_point_margin_bar",
    registry: "isometric",
    label: "Margin above the bubble point",
    unit: "bar",
    builtIn: 5,
    builtInSource: "In-situ Mineralization module 1.2",
    question: "By how many bar must the injection pressure stay above the bubble-point pressure?",
    search: "bubble point pressure margin bar injection",
    usedBy: ["bubble-point"],
  },
];

export const REQUIREMENT_BY_ID: Readonly<Record<string, RequirementDef>> = Object.fromEntries(
  REQUIREMENTS.map((requirement) => [requirement.id, requirement]),
);

/** A project's place: the values approved for it are the ones for this registry, methodology and edition. */
export interface RequirementScope {
  registry: string;
  methodology: string;
  edition: string;
}

/** The values that apply to a project's registry and methodology. */
export function requirementsFor(scope: Pick<RequirementScope, "registry" | "methodology">): RequirementDef[] {
  return REQUIREMENTS.filter(
    (requirement) => requirement.registry === scope.registry && (!requirement.methodology || requirement.methodology === scope.methodology),
  );
}

/** Approved values by id; a check asks for one and gets the built-in value when none is approved. */
export type ApprovedValues = Readonly<Record<string, number>>;

export function requirementValue(id: string, approved?: ApprovedValues): number {
  const value = approved?.[id];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const known = REQUIREMENT_BY_ID[id];
  if (!known) throw new Error(`Unknown requirement ${id}`);
  return known.builtIn;
}

export function formatRequirement(value: number, unit: RequirementUnit): string {
  const number = value.toLocaleString("en-GB");
  switch (unit) {
    case "percent":
      return `${number}%`;
    case "EUR":
      return `€${number}`;
    default:
      return `${number} ${unit}`;
  }
}
