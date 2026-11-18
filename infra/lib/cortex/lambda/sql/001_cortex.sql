-- Cortex knowledge schema. Statements are separated by lines holding only "---"
-- and are safe to run again. Run by the cortex-schema custom resource.
--
-- Tenant isolation: every table holding tenant data has row-level security,
-- ENABLED and FORCED (so the table owner is held to it too). Tools set
-- app.tenant_id and app.project_ids per transaction from the caller block the
-- gateway wrote; with neither set, a session sees only shared rows.

CREATE EXTENSION IF NOT EXISTS vector
---
CREATE SCHEMA IF NOT EXISTS cortex
---
CREATE OR REPLACE FUNCTION cortex.current_tenant() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '') $$
---
CREATE OR REPLACE FUNCTION cortex.current_projects() RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.project_ids', true), ''), ','), '{}'::text[])
$$
---
-- Registry and methodology requirements: reference data shared by every tenant.
CREATE TABLE IF NOT EXISTS cortex.requirements (
  requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry       text NOT NULL,
  methodology    text NOT NULL,
  edition        text NOT NULL,
  clause_ref     text NOT NULL,
  title          text NOT NULL,
  body           text NOT NULL,
  parameters     jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_doc_id  uuid,
  source_page    int,
  valid_from     date NOT NULL,
  valid_to       date,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  approved_by    text,
  approved_at    timestamptz,
  UNIQUE (registry, methodology, edition, clause_ref)
)
---
-- Every document Cortex knows, with the scope it was filed under.
CREATE TABLE IF NOT EXISTS cortex.documents (
  doc_id       uuid PRIMARY KEY,
  scope        text NOT NULL CHECK (scope IN ('shared', 'tenant', 'project')),
  tenant_id    text,
  project_id   text,
  s3_key       text NOT NULL UNIQUE,
  sha256       text,
  title        text,
  registry     text,
  methodology  text,
  edition      text,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'indexed', 'approved', 'rejected', 'superseded')),
  uploaded_by  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_scope_owner CHECK (
    (scope = 'shared'  AND tenant_id IS NULL     AND project_id IS NULL) OR
    (scope = 'tenant'  AND tenant_id IS NOT NULL AND project_id IS NULL) OR
    (scope = 'project' AND tenant_id IS NOT NULL AND project_id IS NOT NULL)
  )
)
---
CREATE INDEX IF NOT EXISTS documents_owner ON cortex.documents (tenant_id, project_id)
---
-- Project facts (location, methodology, meter list, answers). Every fact names its source.
CREATE TABLE IF NOT EXISTS cortex.project_facts (
  tenant_id   text NOT NULL,
  project_id  text NOT NULL,
  fact_key    text NOT NULL,
  value       jsonb NOT NULL,
  source      jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, fact_key)
)
---
-- Decisions on drafts, links and corrections. Append-only.
CREATE TABLE IF NOT EXISTS cortex.approvals (
  approval_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  project_id      text,
  subject_type    text NOT NULL,
  subject_id      text NOT NULL,
  version_sha256  text NOT NULL,
  decision        text NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
  decided_by      text NOT NULL,
  role            text NOT NULL,
  comment         text,
  decided_at      timestamptz NOT NULL DEFAULT now()
)
---
ALTER TABLE cortex.documents ENABLE ROW LEVEL SECURITY
---
ALTER TABLE cortex.documents FORCE ROW LEVEL SECURITY
---
ALTER TABLE cortex.project_facts ENABLE ROW LEVEL SECURITY
---
ALTER TABLE cortex.project_facts FORCE ROW LEVEL SECURITY
---
ALTER TABLE cortex.approvals ENABLE ROW LEVEL SECURITY
---
ALTER TABLE cortex.approvals FORCE ROW LEVEL SECURITY
---
DROP POLICY IF EXISTS documents_read ON cortex.documents
---
CREATE POLICY documents_read ON cortex.documents FOR SELECT USING (
  scope = 'shared'
  OR (tenant_id = cortex.current_tenant()
      AND (scope = 'tenant' OR project_id = ANY (cortex.current_projects())))
)
---
DROP POLICY IF EXISTS documents_insert ON cortex.documents
---
CREATE POLICY documents_insert ON cortex.documents FOR INSERT WITH CHECK (
  tenant_id = cortex.current_tenant()
  AND (scope = 'tenant' OR project_id = ANY (cortex.current_projects()))
)
---
DROP POLICY IF EXISTS documents_update ON cortex.documents
---
CREATE POLICY documents_update ON cortex.documents FOR UPDATE
USING (tenant_id = cortex.current_tenant() AND (scope = 'tenant' OR project_id = ANY (cortex.current_projects())))
WITH CHECK (tenant_id = cortex.current_tenant() AND (scope = 'tenant' OR project_id = ANY (cortex.current_projects())))
---
DROP POLICY IF EXISTS project_facts_access ON cortex.project_facts
---
CREATE POLICY project_facts_access ON cortex.project_facts FOR ALL
USING (tenant_id = cortex.current_tenant() AND project_id = ANY (cortex.current_projects()))
WITH CHECK (tenant_id = cortex.current_tenant() AND project_id = ANY (cortex.current_projects()))
---
DROP POLICY IF EXISTS approvals_read ON cortex.approvals
---
CREATE POLICY approvals_read ON cortex.approvals FOR SELECT USING (
  tenant_id = cortex.current_tenant()
  AND (project_id IS NULL OR project_id = ANY (cortex.current_projects()))
)
---
DROP POLICY IF EXISTS approvals_insert ON cortex.approvals
---
CREATE POLICY approvals_insert ON cortex.approvals FOR INSERT WITH CHECK (
  tenant_id = cortex.current_tenant()
  AND (project_id IS NULL OR project_id = ANY (cortex.current_projects()))
)
---
-- Bedrock Knowledge Bases vector store (layout required by Bedrock).
CREATE SCHEMA IF NOT EXISTS bedrock_integration
---
CREATE TABLE IF NOT EXISTS bedrock_integration.bedrock_kb (
  id               uuid PRIMARY KEY,
  embedding        vector(1024),
  chunks           text,
  metadata         json,
  custom_metadata  jsonb
)
---
CREATE INDEX IF NOT EXISTS bedrock_kb_embedding ON bedrock_integration.bedrock_kb
  USING hnsw (embedding vector_cosine_ops) WITH (ef_construction = 256)
---
-- Needed for hybrid (keyword + vector) search, so clause ids like R-Q3JN-0 are found exactly.
CREATE INDEX IF NOT EXISTS bedrock_kb_chunks_text ON bedrock_integration.bedrock_kb
  USING gin (to_tsvector('simple', chunks))
---
-- Scope, tenant and project filters run on this column.
CREATE INDEX IF NOT EXISTS bedrock_kb_custom_metadata ON bedrock_integration.bedrock_kb
  USING gin (custom_metadata)
---
GRANT USAGE ON SCHEMA bedrock_integration TO bedrock_kb
---
GRANT SELECT, INSERT, UPDATE, DELETE ON bedrock_integration.bedrock_kb TO bedrock_kb
---
GRANT USAGE ON SCHEMA cortex TO cortex_app
---
GRANT EXECUTE ON FUNCTION cortex.current_tenant(), cortex.current_projects() TO cortex_app
---
GRANT SELECT ON cortex.requirements TO cortex_app
---
GRANT SELECT, INSERT, UPDATE ON cortex.documents, cortex.project_facts TO cortex_app
---
-- Approvals are append-only for the app.
GRANT SELECT, INSERT ON cortex.approvals TO cortex_app
---
REVOKE UPDATE, DELETE ON cortex.approvals FROM cortex_app
