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
