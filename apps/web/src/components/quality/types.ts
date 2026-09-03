export type SentinelProject = {
  id: string;
  name: string;
  description?: string | null;
  domain?: string;
  is_active?: boolean;
};

export type DqaRule = {
  id: string;
  project_id: string;
  rule_id: string;
  rule_name: string;
  dimension: string;
  description?: string | null;
  what_it_checks?: string | null;
  severity: string;
  is_hard_gate: boolean;
  weight: number;
  parameters: Record<string, unknown>;
  is_active: boolean;
};

export type DqaDataset = {
  id: string;
  project_id: string;
  name: string;
  status?: string;
  row_count?: number;
  column_count?: number;
  ingested_at?: string;
};

export type DqaRun = {
  id: string;
  dataset_id: string;
  project_id: string;
  status: string;
  total_violations?: number;
  gate_passed?: boolean | null;
  readiness_score?: number | null;
  triggered_at?: string;
  error_message?: string | null;
};

export type DqaViolation = {
  id: string;
  run_id: string;
  rule_id: string;
  rule_name?: string | null;
  dimension: string;
  severity: string;
  status?: string;
  affected_field?: string | null;
  record_count?: number;
};

export type VvProject = {
  id: string;
  name: string;
  status?: string;
  location?: string | null;
  project_developer?: string | null;
  vintage_year?: number | null;
  document_count?: number;
  checkpoint_stats?: { total?: number };
};

export type VvCheckpoint = {
  id: string;
  checkpoint_id: string;
  category?: string;
  name: string;
  requirement?: string;
  status?: string;
  verifier_status?: string | null;
  verifier_note?: string | null;
  finding_severity?: string;
};

export type VvDocument = {
  id: string;
  name: string;
  document_type?: string;
  status?: string;
  file_type?: string;
};

export type ProtocolRecord = {
  id: string;
  code?: string;
  name: string;
  version?: string;
  registry_id?: string;
  status?: string;
};

export type ProtocolCheckpoint = {
  id: string;
  checkpoint_id: string;
  category?: string;
  name: string;
  requirement?: string;
  critical?: boolean;
};
