export type ProjectStatus =
  | "draft"
  | "validation"
  | "monitoring"
  | "verification"
  | "issued";

export type Registry =
  | "Verra VCS"
  | "Gold Standard"
  | "Puro.earth"
  | "Isometric";

export type ItemKind = "document" | "dataset" | "sensor-stream" | "attestation";

export type ItemState = "complete" | "pending" | "missing" | "rejected";

export type SubmissionStatus =
  | "assembling"
  | "submitted"
  | "in-verification"
  | "issued"
  | "rejected";

export interface Tenant {
  id: string;
  name: string;
  short: string;
  plan: string;
  seats: number;
  accent: string;
}

/** Evidence the registry already holds for a requirement, when read live. */
export interface SpecEvidence {
  id: string;
  sourceId?: string;
  validFrom: string | null;
  validTo: string;
  note?: string;
  kind?: "submission" | "datapoint" | "registry-document";
  filename?: string;
  fetchable?: boolean;
  fetchNote?: string;
  quantity?: string;
  /** Public registry URL only — never a Certify private signed URL. */
  href?: string;
}

/** A single thing a registry expects to receive with a submission. */
export interface SpecItem {
  id: string;
  label: string;
  kind: ItemKind;
  detail: string;
  /** Clause in the registry rulebook or methodology that demands it. */
  reference: string;
  mandatory: boolean;
  /** How often the registry expects it, where the registry states a cadence. */
  cadence?: string;
  /** Present only when the requirement came from a live registry read. */
  evidence?: SpecEvidence[];
}

export interface SpecGroup {
  id: string;
  code: string;
  title: string;
  accent: string;
  items: SpecItem[];
}

/**
 * The full requirement set for one project's submission, assembled from the
 * registry rulebook plus the applied methodology. Shaped so it can be replaced
 * by a live registry API response without touching the UI.
 */
export interface RequirementSpec {
  registry: Registry;
  methodology: string;
  specVersion: string;
  sources: string[];
  groups: SpecGroup[];
}

export interface RequirementItem extends SpecItem {
  slotId: string;
  groupId: string;
  groupCode: string;
  groupTitle: string;
  accent: string;
  state: ItemState;
  volume: string;
  updatedDaysAgo: number;
}

export interface BatchGroup {
  id: string;
  code: string;
  title: string;
  accent: string;
  items: RequirementItem[];
}

export interface SubmissionBatch {
  id: string;
  projectId: string;
  sequence: number;
  hash: string;
  parentHash: string | null;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  volume: number;
  status: SubmissionStatus;
  anchoredAt: string | null;
  specVersion: string;
  groups: BatchGroup[];
  /** Flat view in the same order as `groups`, for lattice and list rendering. */
  items: RequirementItem[];
  completion: number;
  blockers: number;
  outstanding: number;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lng: number;
  status: ProjectStatus;
  registry: Registry;
  methodology: string;
  /** Key into the methodology requirement modules. */
  methodologyKey: string;
  afolu: boolean;
  developer: string;
  hectares: number;
  creditsIssued: number;
  annualForecast: number;
  vintage: number;
  sensors: number;
  lastSyncMinutes: number;
  bufferPct: number;
  creditingStart: number;
  creditingYears: number;
}
