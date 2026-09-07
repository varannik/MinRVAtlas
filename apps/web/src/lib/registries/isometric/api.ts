import { ACCENT } from "@/lib/brand";
import type { RegistryEnvironment } from "../types";

/**
 * Wire types for the Isometric Certify (MRV) API, v0.
 * Spec: https://api.isometric.com/mrv/v0/mrv.openapi.json
 * Docs: https://docs.isometric.com/api-reference/introduction
 */

export const MRV_BASE_URL: Record<RegistryEnvironment, string> = {
  sandbox: "https://api.sandbox.isometric.com/mrv/v0",
  production: "https://api.isometric.com/mrv/v0",
};

export const REGISTRY_BASE_URL: Record<RegistryEnvironment, string> = {
  sandbox: "https://api.sandbox.isometric.com/registry/v0",
  production: "https://api.isometric.com/registry/v0",
};

/** Relay-style pagination caps page size at 50. */
export const PAGE_SIZE = 50;

export function projectsPath(): string {
  return "/projects";
}

export function projectPath(projectId: string): string {
  return `/projects/${projectId}`;
}

export function ghgEntryTemplatesPath(projectId: string): string {
  return `/projects/${projectId}/ghg_entry_templates`;
}

export function storageLocationsPath(projectId: string): string {
  return `/projects/${projectId}/storage_locations`;
}

export function monitoringRequirementsPath(projectId: string): string {
  return `/projects/${projectId}/monitoring_requirements`;
}

export function monitoringSubmissionsPath(
  projectId: string,
  requirementId: string,
): string {
  return `/projects/${projectId}/monitoring_requirements/${requirementId}/submissions`;
}

export function monitoringSubmissionPath(
  projectId: string,
  requirementId: string,
  submissionId: string,
): string {
  return `/projects/${projectId}/monitoring_requirements/${requirementId}/submissions/${submissionId}`;
}

export function sourcesPath(): string {
  return "/sources";
}

export function sourcePath(sourceId: string): string {
  return `/sources/${sourceId}`;
}

export function datapointsPath(): string {
  return "/datapoints";
}

export function projectDocumentsPath(projectId: string): string {
  return `/projects/${projectId}/documents`;
}

export function fileUploadsPath(): string {
  return "/file-uploads";
}

export function dataUploadSubmissionsPath(): string {
  return "/data-upload-submissions";
}

export function dataUploadSubmissionPath(id: string): string {
  return `/data-upload-submissions/${id}`;
}

export function ghgStatementsPath(): string {
  return "/ghg_statements";
}

export function ghgStatementSubmitPath(statementId: string): string {
  return `/ghg_statements/${statementId}/submit`;
}

export function ghgEntriesPath(): string {
  return "/ghg_entries";
}

export function ghgEntryPath(entryId: string): string {
  return `/ghg_entries/${entryId}`;
}

export type GhgStatementStatus =
  | "draft"
  | "submitted"
  | "in_verification"
  | "verified"
  | "rejected"
  | "issued"
  | "DRAFT"
  | "AWAITING_VERIFICATION"
  | "VERIFIED"
  | "CREDITS_ISSUED"
  | "FAILED_VERIFICATION";

export interface GhgStatement {
  id: string;
  project_id?: string | null;
  reporting_period_start_at?: string | null;
  reporting_period_end_at?: string | null;
  start_on?: string | null;
  started_on?: string | null;
  start_date?: string | null;
  end_on?: string | null;
  ended_on?: string | null;
  end_date?: string | null;
  status?: string | null;
  ghg_entry_ids?: string[];
  co2e_net_removed_kg?: number | null;
}

export interface GhgEntry {
  id: string;
  ghg_statement_id?: string | null;
  started_on?: string | null;
  completed_on?: string | null;
  credit_type?: CreditType | string | null;
  co2e_net_removed_kg?: number | null;
  co2e_net_removed_without_discount_kg?: number | null;
  feedstock_type_id?: string | null;
  supplier_reference_id?: string | null;
}

export type MonitoringPhase = "pre_op" | "operation" | "post_op" | "feedstock";

export type Frequency =
  | "na"
  | "once"
  | "optional"
  | "if_needed"
  | "every_1_days"
  | "every_1_weeks"
  | "every_1_months"
  | "every_2_weeks"
  | "every_3_months"
  | "every_6_months"
  | "every_1_years"
  | "every_2_years"
  | "every_5_years"
  | "once_per_production_batch"
  | "once_per_injection_batch"
  | "continuous";

export interface ProjectMonitoringRequirement {
  id: string;
  project_id: string;
  storage_location_id: string | null;
  storage_unit_id: string | null;
  display_name: string;
  monitoring_phase: MonitoringPhase;
  frequency: Frequency | null;
  notes: string | null;
}

export interface MonitoringSubmission {
  id: string;
  source_id: string;
  valid_from: string | null;
  valid_to: string;
  supplier_reference_id: string | null;
  notes: string | null;
}

export interface PageInfo {
  has_previous_page: boolean;
  has_next_page: boolean;
  start_cursor: string | null;
  end_cursor: string | null;
}

export interface PaginatedList<T> {
  nodes: T[];
  page_info: PageInfo;
  total_count: number;
}

export type SourceType = "DOCUMENT" | "WEBSITE";

export type SourcePublicUrlInfo = {
  __typename: "SourcePublicUrlInfo";
  url: string;
};

export type SourcePrivateUrlInfo = {
  __typename: "SourcePrivateUrlInfo";
  is_accessible: boolean;
};

export type SourceUrlInfo = SourcePublicUrlInfo | SourcePrivateUrlInfo;

export interface Source {
  id: string;
  project_id: string | null;
  display_name: string | null;
  description: string | null;
  original_filename: string | null;
  type: SourceType;
  is_public: boolean;
  published_at: string | null;
  supplier_reference_id: string | null;
  url_info: SourceUrlInfo | null;
}

export type DatapointType =
  | "CONSTANT"
  | "STANDARD_PUBLISHED_VALUE"
  | "REPORTED"
  | "ASSUMPTION"
  | "DERIVED";

export interface ScalarQuantity {
  magnitude: number;
  unit: string;
  standard_deviation?: number | null;
}

export interface Datapoint {
  id: string;
  project_id: string | null;
  display_name: string;
  description: string | null;
  type: DatapointType;
  quantity: ScalarQuantity;
  source_ids: string[];
  measured_at: string | null;
  supplier_reference_id: string | null;
}

export interface ProjectDocument {
  id: string;
  project_id: string;
  display_name: string;
  url: string;
  submission_date: string;
}

export interface CertifyProject {
  id: string;
  name: string;
  country_code: string;
  description?: string | null;
  short_description?: string | null;
  risk_of_reversal?: string | null;
  created_at?: string | null;
}

export type CreditType = "REMOVAL" | "REDUCTION";

export interface GhgEntryTemplateComponentInput {
  input_key: string;
  datapoint_id: string | null;
  display_name: string;
  type?: string;
  quantity_kind?: string;
}

export interface GhgEntryTemplateComponent {
  id: string;
  display_name: string;
  description?: string | null;
  blueprint_key: string;
  inputs: GhgEntryTemplateComponentInput[];
}

export interface GhgEntryTemplateComponentGroup {
  id: string;
  key: string;
  display_name: string;
  description?: string;
  components: GhgEntryTemplateComponent[];
}

export interface GhgEntryTemplate {
  id: string;
  display_name: string;
  project_id: string;
  credit_type: CreditType | string;
  groups: GhgEntryTemplateComponentGroup[];
}

export interface StorageLocation {
  id: string;
  name: string;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  storage_method?: string;
  project_id: string;
}

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  na: "Not applicable",
  once: "Once",
  optional: "Optional",
  if_needed: "If needed",
  every_1_days: "Daily",
  every_1_weeks: "Weekly",
  every_2_weeks: "Every 2 weeks",
  every_1_months: "Monthly",
  every_3_months: "Quarterly",
  every_6_months: "Every 6 months",
  every_1_years: "Annually",
  every_2_years: "Every 2 years",
  every_5_years: "Every 5 years",
  once_per_production_batch: "Per production batch",
  once_per_injection_batch: "Per injection batch",
  continuous: "Continuous",
};

/** Frequencies the registry treats as discretionary rather than required. */
export const DISCRETIONARY_FREQUENCIES: ReadonlySet<Frequency> = new Set<Frequency>([
  "na",
  "optional",
  "if_needed",
]);

export const PHASE_META: Record<
  MonitoringPhase,
  { code: string; title: string; accent: string; order: number }
> = {
  pre_op: {
    code: "PRE",
    title: "Pre-operational monitoring",
    accent: ACCENT.tech,
    order: 0,
  },
  feedstock: {
    code: "FDS",
    title: "Feedstock monitoring",
    accent: ACCENT.land,
    order: 1,
  },
  operation: {
    code: "OPS",
    title: "Operational monitoring",
    accent: ACCENT.storage,
    order: 2,
  },
  post_op: {
    code: "PST",
    title: "Post-closure monitoring",
    accent: ACCENT.alert,
    order: 3,
  },
};
