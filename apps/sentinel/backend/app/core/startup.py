import logging

from sqlalchemy.orm import Session

logger = logging.getLogger("datasentinel.startup")
from app.core.database import SessionLocal


def run_migrations():
    """Apply any pending schema migrations safely."""
    for attempt in range(5):
        try:
            db: Session = SessionLocal()
            # ── Run init.sql to create base tables ──────────────────────────
            import os

            from sqlalchemy import text

            from app.core.database import engine
            init_sql_path = os.path.join(os.path.dirname(__file__), "../../migrations/init.sql")
            init_sql_path = os.path.normpath(init_sql_path)
            logger.info(f"Looking for init.sql at: {init_sql_path} (exists={os.path.exists(init_sql_path)})")
            if os.path.exists(init_sql_path):
                with open(init_sql_path, "r") as f:
                    init_sql = f.read()
                try:
                    # Use raw psycopg2 connection — supports multiple statements in one execute()
                    raw_conn = engine.raw_connection()
                    cursor = raw_conn.cursor()
                    cursor.execute(init_sql)
                    raw_conn.commit()
                    cursor.close()
                    raw_conn.close()
                    logger.info("init.sql executed successfully — base tables created")
                except Exception as e:
                    logger.warning(f"init.sql error (tables may already exist): {e}")

            # Create V&V tables if not exist
            vv_tables = [
                '''CREATE TABLE IF NOT EXISTS registries (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL, slug VARCHAR(50) UNIQUE, logo_url VARCHAR(500), website VARCHAR(500), description TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW())''',
                '''CREATE TABLE IF NOT EXISTS methodologies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), registry_id UUID REFERENCES registries(id), name VARCHAR(200) NOT NULL, code VARCHAR(100), version VARCHAR(20), description TEXT, checkpoints JSONB DEFAULT '[]', is_active BOOLEAN DEFAULT TRUE)''',
                '''CREATE TABLE IF NOT EXISTS vv_projects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(300) NOT NULL, description TEXT, registry_id UUID, methodology_id UUID, project_developer VARCHAR(300), location VARCHAR(300), vintage_year INTEGER, status VARCHAR(50) DEFAULT 'submitted', assigned_verifier UUID, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ)''',
                '''CREATE TABLE IF NOT EXISTS vv_documents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID REFERENCES vv_projects(id) ON DELETE CASCADE, name VARCHAR(500), file_type VARCHAR(50), document_type VARCHAR(100), storage_path VARCHAR(1000), file_size INTEGER, status VARCHAR(50) DEFAULT 'uploaded', extracted_data JSONB DEFAULT '{}', extraction_summary TEXT, row_count INTEGER, column_count INTEGER, uploaded_by UUID REFERENCES users(id), uploaded_at TIMESTAMPTZ DEFAULT NOW(), processed_at TIMESTAMPTZ)''',
                '''CREATE TABLE IF NOT EXISTS vv_checkpoints (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID REFERENCES vv_projects(id) ON DELETE CASCADE, checkpoint_id VARCHAR(50), category VARCHAR(100), name VARCHAR(300), description TEXT, requirement TEXT, status VARCHAR(50) DEFAULT 'pending', ai_finding TEXT, ai_confidence FLOAT, ai_evidence JSONB DEFAULT '[]', verifier_status VARCHAR(50), verifier_note TEXT, reviewed_by UUID, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())''',
                '''CREATE TABLE IF NOT EXISTS anomaly_detection_runs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
                    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
                    result JSONB NOT NULL,
                    domain VARCHAR(50) DEFAULT 'ccs',
                    model_params JSONB DEFAULT '{}'::jsonb,
                    analysed_keys JSONB DEFAULT '[]'::jsonb,
                    current_step INTEGER DEFAULT 2,
                    created_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )''',
                '''CREATE TABLE IF NOT EXISTS knowledge_base (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    domain VARCHAR(50) NOT NULL,
                    parameter VARCHAR(200),
                    category VARCHAR(100) NOT NULL,
                    title VARCHAR(300) NOT NULL,
                    description TEXT NOT NULL,
                    action TEXT,
                    severity VARCHAR(20) DEFAULT \'medium\',
                    priority VARCHAR(20) DEFAULT \'24h\',
                    tags JSONB DEFAULT \'[]\'::jsonb,
                    source VARCHAR(200),
                    is_active BOOLEAN DEFAULT TRUE,
                    created_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )''',
                '''CREATE TABLE IF NOT EXISTS vv_reports (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID REFERENCES vv_projects(id) ON DELETE CASCADE, report_type VARCHAR(50), status VARCHAR(50), overall_outcome VARCHAR(50), credit_estimate FLOAT, credit_unit VARCHAR(50), summary TEXT, findings JSONB DEFAULT '[]', recommendations JSONB DEFAULT '[]', conditions JSONB DEFAULT '[]', generated_by UUID REFERENCES users(id), generated_at TIMESTAMPTZ DEFAULT NOW(), finalized_at TIMESTAMPTZ, report_data JSONB DEFAULT '{}')''',
            ]
            for vv_sql in vv_tables:
                try:
                    db.execute(text(vv_sql))
                    db.commit()
                except Exception as vv_exc:
                    db.rollback()
                    if "already exists" not in str(vv_exc).lower():
                        logger.error("VV table creation failed: %s", vv_exc)

            migrations = [
                "ALTER TABLE correction_suggestions ADD COLUMN IF NOT EXISTS override_reason TEXT;",
                "ALTER TABLE approved_corrections ADD COLUMN IF NOT EXISTS override_reason TEXT;",
                "ALTER TABLE approved_corrections ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;",
                "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS parent_dataset_id UUID REFERENCES datasets(id);",
                "ALTER TABLE datasets ADD COLUMN IF NOT EXISTS pass_number INTEGER DEFAULT 0;",
                # Notifications table
                """CREATE TABLE IF NOT EXISTS notifications (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    title VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    event_type VARCHAR(100) NOT NULL,
                    entity_id UUID,
                    entity_type VARCHAR(50),
                    is_read BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # API Keys table
                """CREATE TABLE IF NOT EXISTS api_keys (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    key_prefix VARCHAR(12) NOT NULL,
                    key_hash VARCHAR(255) NOT NULL,
                    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
                    created_by UUID REFERENCES users(id),
                    last_used_at TIMESTAMPTZ,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # Project members table
                """CREATE TABLE IF NOT EXISTS project_members (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role VARCHAR(50) DEFAULT 'analyst',
                    added_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(project_id, user_id)
                );""",
                # Scheduled DQA runs table
                """CREATE TABLE IF NOT EXISTS dqa_schedules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
                    dataset_id UUID REFERENCES datasets(id) ON DELETE SET NULL,
                    name VARCHAR(255) NOT NULL,
                    cron_expression VARCHAR(100) NOT NULL DEFAULT '0 6 * * *',
                    timezone VARCHAR(100) DEFAULT 'UTC',
                    is_active BOOLEAN DEFAULT TRUE,
                    notify_email VARCHAR(500),
                    last_run_at TIMESTAMPTZ,
                    next_run_at TIMESTAMPTZ,
                    last_run_status VARCHAR(50),
                    run_count INTEGER DEFAULT 0,
                    created_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # Phase 3: Violation comments (assignment + collaboration)
                """CREATE TABLE IF NOT EXISTS violation_comments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    violation_id UUID NOT NULL REFERENCES dqa_violations(id) ON DELETE CASCADE,
                    user_id UUID REFERENCES users(id),
                    message TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # Phase 3: Instrument calibration log
                """CREATE TABLE IF NOT EXISTS instrument_calibrations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
                    instrument_id VARCHAR(100),
                    instrument_name VARCHAR(255) NOT NULL,
                    location VARCHAR(255),
                    last_calibrated_at TIMESTAMPTZ,
                    next_calibration_at TIMESTAMPTZ,
                    calibration_cert VARCHAR(500),
                    notes TEXT,
                    created_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # Phase 3: Submission windows (deadline tracker)
                """CREATE TABLE IF NOT EXISTS submission_windows (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    deadline_at TIMESTAMPTZ,
                    status VARCHAR(50) DEFAULT 'upcoming',
                    created_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # Phase 3: Data retention policies
                """CREATE TABLE IF NOT EXISTS retention_policies (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
                    run_retention_days INTEGER DEFAULT 730,
                    violation_retention_days INTEGER DEFAULT 1825,
                    auto_archive_enabled BOOLEAN DEFAULT FALSE,
                    created_by UUID REFERENCES users(id),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # Phase 3: Ingest batch deduplication
                """CREATE TABLE IF NOT EXISTS ingest_batches (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
                    project_id UUID REFERENCES projects(id),
                    dataset_id UUID REFERENCES datasets(id),
                    received_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # Phase 3: Violation assignment + SLA columns
                "ALTER TABLE dqa_violations ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);",
                "ALTER TABLE dqa_violations ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;",
                "ALTER TABLE dqa_violations ADD COLUMN IF NOT EXISTS sla_hours INTEGER;",
                # Phase 3: 4-eyes correction approval columns
                "ALTER TABLE approved_corrections ADD COLUMN IF NOT EXISTS four_eyes_status VARCHAR(50) DEFAULT 'approved';",
                "ALTER TABLE approved_corrections ADD COLUMN IF NOT EXISTS second_approved_by UUID REFERENCES users(id);",
                "ALTER TABLE approved_corrections ADD COLUMN IF NOT EXISTS second_approved_at TIMESTAMPTZ;",
                # V5: MFA columns on users
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(255);",
                # V5: Password reset tokens
                """CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token VARCHAR(255) UNIQUE NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    used BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # F006: JWT revocation denylist
                """CREATE TABLE IF NOT EXISTS revoked_tokens (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    jti VARCHAR(255) UNIQUE NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    revoked_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                "CREATE INDEX IF NOT EXISTS ix_revoked_tokens_jti ON revoked_tokens(jti);",
                # Living Protocol Registry — Phase 1
                """CREATE TABLE IF NOT EXISTS vv_registries (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(100) NOT NULL,
                    slug VARCHAR(50) UNIQUE NOT NULL,
                    website_url VARCHAR(500),
                    logo_emoji VARCHAR(10),
                    description TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS vv_protocols (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    registry_id UUID NOT NULL REFERENCES vv_registries(id) ON DELETE CASCADE,
                    code VARCHAR(50) NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    description TEXT,
                    version VARCHAR(20) NOT NULL DEFAULT '1.0',
                    status VARCHAR(20) NOT NULL DEFAULT 'active',
                    source_url VARCHAR(500),
                    last_verified_at TIMESTAMPTZ,
                    verified_by VARCHAR(100),
                    website_content_hash VARCHAR(64),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS vv_checkpoint_defs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    protocol_id UUID NOT NULL REFERENCES vv_protocols(id) ON DELETE CASCADE,
                    checkpoint_id VARCHAR(50) NOT NULL,
                    category VARCHAR(100) NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    requirement TEXT NOT NULL,
                    critical BOOLEAN DEFAULT TRUE,
                    document_types JSONB,
                    evidence_types JSONB,
                    sort_order INTEGER DEFAULT 0,
                    added_in_version VARCHAR(20) DEFAULT '1.0',
                    deprecated_in_version VARCHAR(20),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS vv_protocol_update_log (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    protocol_id UUID NOT NULL REFERENCES vv_protocols(id) ON DELETE CASCADE,
                    proposed_by VARCHAR(100) NOT NULL,
                    change_type VARCHAR(50) NOT NULL,
                    checkpoint_id_affected VARCHAR(50),
                    old_value JSONB,
                    new_value JSONB,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    reviewed_by VARCHAR(100),
                    reviewed_at TIMESTAMPTZ,
                    notes TEXT,
                    source VARCHAR(500),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # Dedup vv_protocols — keep oldest per (registry_id, code)
                """DELETE FROM vv_checkpoint_defs WHERE protocol_id IN (
                    SELECT id FROM vv_protocols WHERE id NOT IN (
                        SELECT DISTINCT ON (registry_id, code) id
                        FROM vv_protocols ORDER BY registry_id, code, created_at ASC
                    )
                );""",
                """DELETE FROM vv_protocols WHERE id NOT IN (
                    SELECT DISTINCT ON (registry_id, code) id
                    FROM vv_protocols ORDER BY registry_id, code, created_at ASC
                );""",
                # ── V6: Document management enhancements (11 new features) ────
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS expiry_date DATE;",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'draft';",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS review_notes TEXT;",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS reviewed_by_name VARCHAR(300);",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS signed_off_by VARCHAR(200);",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS signed_off_at TIMESTAMPTZ;",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS deleted_by_name VARCHAR(300);",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS validation_result JSONB;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS submission_deadline DATE;",
                """CREATE TABLE IF NOT EXISTS vv_audit_log (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID REFERENCES vv_projects(id) ON DELETE CASCADE,
                    document_id UUID REFERENCES vv_documents(id) ON DELETE SET NULL,
                    actor_id UUID REFERENCES users(id),
                    actor_name VARCHAR(300),
                    action VARCHAR(100) NOT NULL,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS vv_document_comments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    document_id UUID NOT NULL REFERENCES vv_documents(id) ON DELETE CASCADE,
                    project_id UUID REFERENCES vv_projects(id) ON DELETE CASCADE,
                    author_id UUID REFERENCES users(id),
                    author_name VARCHAR(300),
                    body TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS vv_notification_preferences (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                    email VARCHAR(300),
                    on_document_uploaded BOOLEAN DEFAULT TRUE,
                    on_expiry_warning BOOLEAN DEFAULT TRUE,
                    on_status_change BOOLEAN DEFAULT TRUE,
                    on_consistency_check BOOLEAN DEFAULT TRUE,
                    on_validation_complete BOOLEAN DEFAULT FALSE,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                # F024 — performance indexes on high-frequency FK columns
                "CREATE INDEX IF NOT EXISTS ix_dqa_runs_dataset_id   ON dqa_runs(dataset_id);",
                "CREATE INDEX IF NOT EXISTS ix_dqa_runs_project_id   ON dqa_runs(project_id);",
                "CREATE INDEX IF NOT EXISTS ix_dqa_violations_run_id  ON dqa_violations(run_id);",
                "CREATE INDEX IF NOT EXISTS ix_dqa_violations_ds_id   ON dqa_violations(dataset_id);",
                "CREATE INDEX IF NOT EXISTS ix_correction_sug_viol_id ON correction_suggestions(violation_id);",
                "CREATE INDEX IF NOT EXISTS ix_correction_sug_ds_id   ON correction_suggestions(dataset_id);",
                "CREATE INDEX IF NOT EXISTS ix_approved_corr_ds_id    ON approved_corrections(dataset_id);",
                "CREATE INDEX IF NOT EXISTS ix_violation_comments_vid ON violation_comments(violation_id);",
                # Safety net for Alembic migration 0003 — data_coverage on dqa_runs
                "ALTER TABLE dqa_runs ADD COLUMN IF NOT EXISTS data_coverage FLOAT;",
                # Safety net for Alembic migration 0004 — theme on users
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'dark';",
                # Safety net for Alembic migration 0002 — created_by on correction_suggestions
                "ALTER TABLE correction_suggestions ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;",
                "CREATE INDEX IF NOT EXISTS ix_correction_suggestions_created_by ON correction_suggestions (created_by);",
                # Task-26: cross-worker SSE progress events (persisted so Celery worker → API worker)
                """CREATE TABLE IF NOT EXISTS run_progress_events (
                    id BIGSERIAL PRIMARY KEY,
                    run_id UUID NOT NULL,
                    step VARCHAR(100) NOT NULL,
                    pct INTEGER NOT NULL,
                    detail TEXT DEFAULT '',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                "CREATE INDEX IF NOT EXISTS ix_run_progress_events_run_id ON run_progress_events (run_id, id);",
                # Task-28: data source connectors
                """CREATE TABLE IF NOT EXISTS data_connectors (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    connector_type VARCHAR(50) NOT NULL,
                    config JSONB NOT NULL DEFAULT '{}',
                    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
                    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    last_tested_at TIMESTAMPTZ,
                    last_test_status VARCHAR(50),
                    last_test_error TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                "CREATE INDEX IF NOT EXISTS ix_data_connectors_project_id ON data_connectors (project_id);",
                # Task-30: organisations (tenant isolation foundation)
                """CREATE TABLE IF NOT EXISTS organisations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    slug VARCHAR(100) UNIQUE,
                    plan VARCHAR(50) DEFAULT 'starter',
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20) DEFAULT 'dqa';",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS project_configs JSONB;",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS anomaly_confidence_pct INTEGER DEFAULT 70;",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS min_anomaly_count INTEGER DEFAULT 1;",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'manual';",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS source_config JSONB;",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS auto_correct_enabled BOOLEAN DEFAULT FALSE;",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS correction_confidence_pct INTEGER DEFAULT 80;",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS output_folder_suffix VARCHAR(100) DEFAULT 'corrected';",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS gate_fail_emails TEXT;",
                "ALTER TABLE dqa_schedules ADD COLUMN IF NOT EXISTS last_pipeline_result JSONB;",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_access JSONB;",
                # Rule Studio — effectiveness stats + pair metadata on correction_rules
                "ALTER TABLE correction_rules ADD COLUMN IF NOT EXISTS description TEXT;",
                "ALTER TABLE correction_rules ADD COLUMN IF NOT EXISTS auto_apply_threshold INTEGER DEFAULT 80;",
                "ALTER TABLE correction_rules ADD COLUMN IF NOT EXISTS auto_apply_severity_max VARCHAR(20) DEFAULT 'medium';",
                "ALTER TABLE correction_rules ADD COLUMN IF NOT EXISTS pair_type VARCHAR(20) DEFAULT 'standard';",
                "ALTER TABLE correction_rules ADD COLUMN IF NOT EXISTS violation_count INTEGER DEFAULT 0;",
                "ALTER TABLE correction_rules ADD COLUMN IF NOT EXISTS auto_applied_count INTEGER DEFAULT 0;",
                "ALTER TABLE correction_rules ADD COLUMN IF NOT EXISTS rejected_count INTEGER DEFAULT 0;",
                "ALTER TABLE correction_rules ADD COLUMN IF NOT EXISTS last_test_result JSONB;",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE SET NULL;",
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE SET NULL;",
                "CREATE INDEX IF NOT EXISTS ix_users_org_id ON users (org_id);",
                "CREATE INDEX IF NOT EXISTS ix_projects_org_id ON projects (org_id);",
                # Task-31: webhook delivery tracking with retry support
                """CREATE TABLE IF NOT EXISTS webhook_deliveries (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
                    run_id UUID REFERENCES dqa_runs(id) ON DELETE SET NULL,
                    webhook_type VARCHAR(50) NOT NULL,
                    webhook_url TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    status VARCHAR(50) DEFAULT 'pending',
                    http_status INTEGER,
                    response_body TEXT,
                    last_error TEXT,
                    retry_count INTEGER DEFAULT 0,
                    next_retry_at TIMESTAMPTZ,
                    delivered_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                "CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_status ON webhook_deliveries (status, next_retry_at);",
                "CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_project ON webhook_deliveries (project_id);",
                # ── V&V deferred columns — must be in startup.py because alembic is NOT run
                # automatically; without these the deferred SELECT fails on first access and
                # leaves the psycopg2 connection in 'InFailedSqlTransaction' state.
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS last_consistency_result JSONB;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS last_consistency_run_at TIMESTAMPTZ;",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS doc_version INTEGER DEFAULT 1;",
                "ALTER TABLE vv_documents ADD COLUMN IF NOT EXISTS version_history JSONB DEFAULT '[]';",
                "ALTER TABLE vv_reports ADD COLUMN IF NOT EXISTS anchor_tx_hash VARCHAR(100);",
                "ALTER TABLE vv_reports ADD COLUMN IF NOT EXISTS anchor_block BIGINT;",
                "ALTER TABLE vv_reports ADD COLUMN IF NOT EXISTS anchor_anchored_at TIMESTAMPTZ;",
                "ALTER TABLE vv_reports ADD COLUMN IF NOT EXISTS anchor_report_hash VARCHAR(64);",
                "ALTER TABLE vv_reports ADD COLUMN IF NOT EXISTS anchor_chain VARCHAR(40);",
                # ── RFI workflow table (alembic 0008) ─────────────────────────
                """CREATE TABLE IF NOT EXISTS vv_rfis (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID NOT NULL REFERENCES vv_projects(id) ON DELETE CASCADE,
                    checkpoint_id VARCHAR(50),
                    title VARCHAR(300) NOT NULL,
                    body TEXT NOT NULL,
                    severity VARCHAR(20) DEFAULT 'medium',
                    status VARCHAR(30) DEFAULT 'open',
                    raised_by UUID REFERENCES users(id),
                    raised_by_name VARCHAR(300),
                    raised_at TIMESTAMPTZ DEFAULT NOW(),
                    assigned_to_name VARCHAR(300),
                    response TEXT,
                    responded_by_name VARCHAR(300),
                    responded_at TIMESTAMPTZ,
                    resolved_by_name VARCHAR(300),
                    resolved_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ
                );""",
                "CREATE INDEX IF NOT EXISTS ix_vv_rfis_project_id ON vv_rfis (project_id);",
                "CREATE INDEX IF NOT EXISTS ix_vv_rfis_status ON vv_rfis (status);",
                # ── Registry sync table ───────────────────────────────────────
                """CREATE TABLE IF NOT EXISTS vv_registry_sync (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID NOT NULL REFERENCES vv_projects(id) ON DELETE CASCADE,
                    registry_slug VARCHAR(50) NOT NULL,
                    external_project_id VARCHAR(200),
                    sync_status VARCHAR(30) DEFAULT 'ok',
                    last_synced_at TIMESTAMPTZ,
                    registry_data JSONB DEFAULT '{}',
                    discrepancies JSONB DEFAULT '[]',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                );""",
                "CREATE INDEX IF NOT EXISTS ix_vv_registry_sync_project_id ON vv_registry_sync (project_id);",
                # Fix: remove all PURO-CCS-ACE2 references — rename to PURO-CCS-GSC everywhere.
                # If both rows exist (seeded at different times), delete the old ACE2 row.
                # If only ACE2 exists (pre-rename DB), rename it in place.
                """UPDATE vv_protocols
                   SET code = 'PURO-CCS-GSC'
                   WHERE code = 'PURO-CCS-ACE2'
                   AND NOT EXISTS (
                       SELECT 1 FROM vv_protocols WHERE code = 'PURO-CCS-GSC'
                   );""",
                """DELETE FROM vv_protocols
                   WHERE code = 'PURO-CCS-ACE2';""",
                # Migrate any projects that still reference the old code in their description
                """UPDATE vv_projects
                   SET description = REPLACE(description, 'PURO-CCS-ACE2', 'PURO-CCS-GSC')
                   WHERE description LIKE '%PURO-CCS-ACE2%';""",
                # Fix checkpoint descriptions that still mention ACE2
                """UPDATE vv_protocols
                   SET description = 'Geological CO2 removal via capture, transport, and permanent mineralisation into suitable underground geological formations (Puro.Earth Geologically Stored Carbon methodology)'
                   WHERE code = 'PURO-CCS-GSC'
                   AND description LIKE '%ACE2%';""",
                """UPDATE vv_checkpoint_defs
                   SET name = 'GSC Monitoring Plan',
                       requirement = 'Puro.Earth GSC methodology-specific monitoring plan covering injection rates, pressure monitoring, and mineralisation verification.'
                   WHERE checkpoint_id = 'PURO-CCS-E-02'
                   AND name LIKE '%ACE2%';""",
                """UPDATE vv_checkpoint_defs
                   SET requirement = 'Quantification uncertainty assessment for CO2 measurement, reporting, and verification per Puro.Earth Geologically Stored Carbon (GSC) methodology.'
                   WHERE checkpoint_id = 'PURO-CCS-E-04'
                   AND requirement LIKE '%ACE2%';""",
                # ── alembic 0012: AI analysis persistence ─────────────────────
                # These run in startup.py because alembic upgrade can fail silently
                # (|| echo WARNING in Dockerfile CMD) when startup.py already created
                # vv_registry_sync, causing alembic to abort the whole chain.
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS last_analysis_result JSONB;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS last_analysis_run_at TIMESTAMPTZ;",
                # ── alembic 0013: Phase 1 — finding_severity, vv_cars, vv_decisions ──
                "ALTER TABLE vv_checkpoints ADD COLUMN IF NOT EXISTS finding_severity VARCHAR(20) DEFAULT 'none';",
                """CREATE TABLE IF NOT EXISTS vv_cars (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID NOT NULL REFERENCES vv_projects(id) ON DELETE CASCADE,
                    checkpoint_code VARCHAR(50),
                    car_number VARCHAR(20) NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    title VARCHAR(300) NOT NULL,
                    description TEXT NOT NULL,
                    status VARCHAR(30) NOT NULL DEFAULT 'open',
                    raised_by UUID,
                    raised_by_name VARCHAR(300),
                    raised_at TIMESTAMPTZ DEFAULT NOW(),
                    response TEXT,
                    responded_by_name VARCHAR(300),
                    responded_at TIMESTAMPTZ,
                    closed_by_name VARCHAR(300),
                    closed_at TIMESTAMPTZ,
                    closure_note TEXT,
                    updated_at TIMESTAMPTZ
                );""",
                "CREATE INDEX IF NOT EXISTS ix_vv_cars_project_id ON vv_cars (project_id);",
                """CREATE TABLE IF NOT EXISTS vv_decisions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID NOT NULL REFERENCES vv_projects(id) ON DELETE CASCADE,
                    decision VARCHAR(30) NOT NULL,
                    findings_summary TEXT,
                    conditions JSONB DEFAULT '[]',
                    open_cars_at_decision INTEGER DEFAULT 0,
                    decided_by UUID,
                    decided_by_name VARCHAR(300),
                    decided_at TIMESTAMPTZ DEFAULT NOW(),
                    superseded_at TIMESTAMPTZ,
                    updated_at TIMESTAMPTZ
                );""",
                "CREATE INDEX IF NOT EXISTS ix_vv_decisions_project_id ON vv_decisions (project_id);",
                # ── alembic 0014: Phase 2-3 — credit quantity, additionality, permanence ──
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS credit_quantity_result JSONB;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS credit_quantity_run_at TIMESTAMPTZ;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS additionality_result JSONB;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS additionality_run_at TIMESTAMPTZ;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS permanence_result JSONB;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS permanence_run_at TIMESTAMPTZ;",
                # ── alembic 0015: Phase 4 — countersign columns on vv_decisions ──
                "ALTER TABLE vv_decisions ADD COLUMN IF NOT EXISTS second_reviewer_id UUID;",
                "ALTER TABLE vv_decisions ADD COLUMN IF NOT EXISTS second_reviewer_name VARCHAR(300);",
                "ALTER TABLE vv_decisions ADD COLUMN IF NOT EXISTS second_reviewer_note TEXT;",
                "ALTER TABLE vv_decisions ADD COLUMN IF NOT EXISTS countersigned_at TIMESTAMPTZ;",
                "ALTER TABLE vv_decisions ADD COLUMN IF NOT EXISTS signature_hash VARCHAR(64);",
                # ── alembic 0016: Phase 6 — vv_registry_submissions ───────────
                """CREATE TABLE IF NOT EXISTS vv_registry_submissions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    project_id UUID NOT NULL REFERENCES vv_projects(id) ON DELETE CASCADE,
                    decision_id UUID REFERENCES vv_decisions(id),
                    submission_number VARCHAR(30) NOT NULL,
                    registry_slug VARCHAR(50) NOT NULL,
                    status VARCHAR(30) NOT NULL DEFAULT 'draft',
                    payload JSONB DEFAULT '{}',
                    submitted_at TIMESTAMPTZ,
                    submitted_by UUID,
                    submitted_by_name VARCHAR(300),
                    registry_ref_number VARCHAR(100),
                    registry_response JSONB,
                    estimated_review_days INTEGER,
                    notes TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                );""",
                "CREATE INDEX IF NOT EXISTS ix_vv_registry_submissions_project_id ON vv_registry_submissions (project_id);",

                # ── Reviewer Platform — Sprint 1 DDL ─────────────────────────
                """CREATE TABLE IF NOT EXISTS registry_connectors (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(200) NOT NULL,
                    slug VARCHAR(50) NOT NULL UNIQUE,
                    base_url VARCHAR(500) NOT NULL,
                    api_version VARCHAR(20) DEFAULT 'v1',
                    auth_type VARCHAR(30) DEFAULT 'api_key',
                    api_key TEXT,
                    client_id VARCHAR(200),
                    client_secret TEXT,
                    webhook_secret VARCHAR(200),
                    webhook_url VARCHAR(500),
                    supported_events JSONB DEFAULT '[]',
                    is_active BOOLEAN DEFAULT TRUE,
                    sandbox_mode BOOLEAN DEFAULT FALSE,
                    notes TEXT,
                    created_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_assignments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    registry_slug VARCHAR(50) NOT NULL,
                    registry_assignment_ref VARCHAR(200),
                    registry_project_ref VARCHAR(200),
                    project_name VARCHAR(500) NOT NULL,
                    company_name VARCHAR(300),
                    company_id VARCHAR(200),
                    methodology_code VARCHAR(100),
                    methodology_version VARCHAR(50),
                    credit_type VARCHAR(100),
                    vintage_year INTEGER,
                    country VARCHAR(100),
                    credit_quantity_claimed INTEGER,
                    assigned_to UUID REFERENCES users(id),
                    assigned_at TIMESTAMPTZ,
                    deadline TIMESTAMPTZ,
                    assurance_level VARCHAR(30) DEFAULT 'reasonable',
                    status VARCHAR(30) DEFAULT 'pending',
                    decline_reason TEXT,
                    document_package_ref VARCHAR(500),
                    document_package_received_at TIMESTAMPTZ,
                    accepted_at TIMESTAMPTZ,
                    completed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ,
                    raw_payload JSONB DEFAULT '{}'
                );""",
                "ALTER TABLE reviewer_assignments ADD COLUMN IF NOT EXISTS vv_project_id UUID REFERENCES vv_projects(id);",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS features_enabled JSONB;",
                "ALTER TABLE vv_projects ADD COLUMN IF NOT EXISTS reviewer_assignment_id UUID;",
                "CREATE INDEX IF NOT EXISTS ix_reviewer_assignments_assigned_to ON reviewer_assignments (assigned_to);",
                "CREATE INDEX IF NOT EXISTS ix_reviewer_assignments_status ON reviewer_assignments (status);",
                """CREATE TABLE IF NOT EXISTS reviewer_coi_declarations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    reviewer_id UUID NOT NULL REFERENCES users(id),
                    no_financial_interest BOOLEAN NOT NULL,
                    no_prior_engagement BOOLEAN NOT NULL,
                    no_personal_relationship BOOLEAN NOT NULL,
                    no_competitive_interest BOOLEAN NOT NULL,
                    additional_disclosures TEXT,
                    declaration_text TEXT,
                    signature_hash VARCHAR(64),
                    declared_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_teams (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    reviewer_id UUID NOT NULL REFERENCES users(id),
                    role VARCHAR(30) DEFAULT 'technical',
                    disciplines JSONB DEFAULT '[]',
                    joined_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_verification_plans (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL UNIQUE REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    assurance_level VARCHAR(30) DEFAULT 'reasonable',
                    methodology_version VARCHAR(50),
                    risk_level VARCHAR(20) DEFAULT 'medium',
                    risk_assessment_notes TEXT,
                    materiality_threshold_pct INTEGER DEFAULT 5,
                    in_scope_checkpoints JSONB DEFAULT '[]',
                    out_of_scope_reasons JSONB DEFAULT '{}',
                    site_visit_required BOOLEAN DEFAULT FALSE,
                    site_visit_type VARCHAR(20),
                    planned_site_visit_dates JSONB DEFAULT '[]',
                    milestone_dates JSONB DEFAULT '{}',
                    plan_document_path VARCHAR(1000),
                    ai_draft_used BOOLEAN DEFAULT FALSE,
                    approved_by UUID REFERENCES users(id),
                    approved_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_pre_screens (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    completeness_result JSONB DEFAULT '{}',
                    plausibility_result JSONB DEFAULT '{}',
                    authenticity_result JSONB DEFAULT '{}',
                    ai_summary TEXT,
                    risk_priority_map JSONB DEFAULT '{}',
                    run_at TIMESTAMPTZ DEFAULT NOW(),
                    run_by UUID REFERENCES users(id)
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_checkpoint_evidence (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    checkpoint_code VARCHAR(100) NOT NULL,
                    document_name VARCHAR(500),
                    document_registry_ref VARCHAR(200),
                    document_section TEXT,
                    extracted_excerpt TEXT,
                    reviewer_note TEXT,
                    linked_by UUID REFERENCES users(id),
                    linked_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_checkpoint_assessments (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    checkpoint_code VARCHAR(100) NOT NULL,
                    checkpoint_label VARCHAR(500),
                    status VARCHAR(30) DEFAULT 'pending',
                    reviewer_judgment TEXT,
                    ai_pre_assessment JSONB DEFAULT '{}',
                    ai_pre_assessment_used BOOLEAN DEFAULT FALSE,
                    assessed_by UUID REFERENCES users(id),
                    assessed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_site_visits (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    visit_type VARCHAR(20) DEFAULT 'remote',
                    visit_date TIMESTAMPTZ,
                    duration_hours INTEGER,
                    location VARCHAR(300),
                    participants JSONB DEFAULT '[]',
                    agenda TEXT,
                    observations TEXT,
                    action_items JSONB DEFAULT '[]',
                    attachments JSONB DEFAULT '[]',
                    logged_by UUID REFERENCES users(id),
                    logged_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_interviews (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    interview_date TIMESTAMPTZ,
                    interview_type VARCHAR(20) DEFAULT 'remote',
                    interviewees JSONB DEFAULT '[]',
                    topics JSONB DEFAULT '[]',
                    key_points TEXT,
                    follow_up_items JSONB DEFAULT '[]',
                    logged_by UUID REFERENCES users(id),
                    logged_at TIMESTAMPTZ DEFAULT NOW()
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_cars (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    car_number VARCHAR(30) NOT NULL,
                    checkpoint_code VARCHAR(100),
                    severity VARCHAR(30) NOT NULL,
                    finding_description TEXT NOT NULL,
                    requirement_reference VARCHAR(500),
                    ai_draft_used BOOLEAN DEFAULT FALSE,
                    registry_car_ref VARCHAR(200),
                    registry_submitted_at TIMESTAMPTZ,
                    status VARCHAR(30) DEFAULT 'draft',
                    company_response TEXT,
                    response_documents JSONB DEFAULT '[]',
                    response_received_at TIMESTAMPTZ,
                    ai_response_assessment JSONB DEFAULT '{}',
                    reviewer_determination VARCHAR(20),
                    determination_note TEXT,
                    escalated_severity VARCHAR(30),
                    closed_by UUID REFERENCES users(id),
                    closed_at TIMESTAMPTZ,
                    issued_by UUID REFERENCES users(id),
                    issued_by_name VARCHAR(300),
                    issued_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                );""",
                "CREATE INDEX IF NOT EXISTS ix_reviewer_cars_assignment_id ON reviewer_cars (assignment_id);",
                "CREATE INDEX IF NOT EXISTS ix_reviewer_cars_status ON reviewer_cars (status);",
                """CREATE TABLE IF NOT EXISTS reviewer_verification_statements (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    assignment_id UUID NOT NULL UNIQUE REFERENCES reviewer_assignments(id) ON DELETE CASCADE,
                    assurance_level VARCHAR(30),
                    overall_conclusion VARCHAR(50),
                    conditions JSONB DEFAULT '[]',
                    credit_quantity_claimed INTEGER,
                    credit_quantity_reviewer_estimate INTEGER,
                    material_difference_pct INTEGER,
                    credit_quantity_narrative TEXT,
                    additionality_conclusion VARCHAR(30),
                    additionality_narrative TEXT,
                    permanence_conclusion VARCHAR(30),
                    permanence_narrative TEXT,
                    statement_text TEXT,
                    document_path VARCHAR(1000),
                    ai_draft_used BOOLEAN DEFAULT FALSE,
                    signed_by UUID REFERENCES users(id),
                    signed_by_name VARCHAR(300),
                    signed_at TIMESTAMPTZ,
                    countersigned_by UUID REFERENCES users(id),
                    countersigned_by_name VARCHAR(300),
                    countersigned_at TIMESTAMPTZ,
                    signature_hash VARCHAR(64),
                    submitted_to_registry_at TIMESTAMPTZ,
                    submitted_by UUID REFERENCES users(id),
                    registry_ref_number VARCHAR(200),
                    registry_decision VARCHAR(50),
                    registry_decision_at TIMESTAMPTZ,
                    registry_response_payload JSONB DEFAULT '{}',
                    public_disclosure_required BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ
                );""",
                """CREATE TABLE IF NOT EXISTS reviewer_integration_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    registry_slug VARCHAR(50),
                    direction VARCHAR(10) NOT NULL,
                    event_type VARCHAR(100) NOT NULL,
                    assignment_id UUID,
                    payload JSONB DEFAULT '{}',
                    status VARCHAR(20) DEFAULT 'pending',
                    error_message TEXT,
                    retry_count INTEGER DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    delivered_at TIMESTAMPTZ
                );""",
                "CREATE INDEX IF NOT EXISTS ix_reviewer_integration_events_created ON reviewer_integration_events (created_at DESC);",
                # ── alembic 20260619_0001: ignore_hard_gates on dqa_runs ──────
                "ALTER TABLE dqa_runs ADD COLUMN IF NOT EXISTS ignore_hard_gates BOOLEAN DEFAULT FALSE;",
            ]
            for migration_sql in migrations:
                try:
                    db.execute(text(migration_sql))
                    db.commit()
                except Exception as mig_exc:
                    db.rollback()
                    msg = str(mig_exc).lower()
                    # "already exists" is expected and safe — these are additive migrations
                    if any(x in msg for x in ("already exists", "duplicate column", "does not exist")):
                        logger.debug("Migration skipped (already applied): %.120s", migration_sql[:120])
                    else:
                        # Log as error but don't crash — other migrations may still be needed
                        logger.error("MIGRATION FAILED: %s | SQL: %.120s", mig_exc, migration_sql[:120])
            db.close()
            logger.info("Migrations applied successfully")
            # Seed protocol registry after migrations
            seed_protocol_registry()
            return
        except Exception as e:
            logger.warning(f"Migration attempt {attempt+1} failed: {e}")
            try: db.close()
            except: pass
            import time; time.sleep(1)


def create_default_admin():
    """F038: Delegated to app.core.seeds to keep startup.py focused on migrations."""
    from app.core.seeds import create_default_admin as _create
    _create()


def seed_protocol_registry():
    """
    Idempotent seed of all 4 registries and 16 protocols into vv_registries /
    vv_protocols / vv_checkpoint_defs. Safe to run on every startup — skips
    rows that already exist based on slug / code.

    Uses ORM models (not raw SQL) to avoid UUID/JSONB type-casting issues.
    Uses a PostgreSQL advisory lock so only one gunicorn worker seeds at a time.
    """
    from sqlalchemy import text as _text

    from app.models import VVCheckpointDef, VVProtocol, VVRegistry

    REGISTRIES = [
        {"slug": "puro_earth",    "name": "Puro.Earth",    "logo_emoji": "🌱",
         "website_url": "https://puro.earth",
         "description": "Leading registry for engineered carbon removal — CCS, biochar, DAC, and enhanced weathering"},
        {"slug": "isometric",     "name": "Isometric",     "logo_emoji": "⬡",
         "website_url": "https://registry.isometric.com",
         "description": "Science-based carbon removal verification with rigorous quantification standards"},
        {"slug": "gold_standard", "name": "Gold Standard", "logo_emoji": "⭐",
         "website_url": "https://www.goldstandard.org",
         "description": "UN-endorsed carbon standard focused on sustainable development co-benefits"},
        {"slug": "verra",         "name": "Verra (VCS)",   "logo_emoji": "🔷",
         "website_url": "https://verra.org",
         "description": "Verified Carbon Standard — world's largest voluntary carbon crediting programme"},
    ]

    # Each protocol: (registry_slug, code, name, description, version, source_url, checkpoints[])
    # checkpoints: list of dicts with id, category, name, requirement, critical, evidence_types
    PROTOCOLS = [
        # ── PURO.EARTH ──────────────────────────────────────────────────────
        ("puro_earth", "PURO-CCS-GSC", "Carbon Capture & Storage (CCS)",
         "Geological CO2 removal via capture, transport, and permanent mineralisation into suitable underground geological formations (Puro.Earth Geologically Stored Carbon methodology)",
         "2.1", "https://puro.earth/methodology/carbon-capture-storage",
         [
            {"id":"PURO-CCS-A-01","category":"Administrative","name":"CO2 Offtake Agreement","requirement":"Executed contractual agreement between CO2 Removal Supplier and operators covering volumes, pricing, and delivery terms.","evidence_types":["co2_offtake_agreement","contractual_terms"],"critical":True},
            {"id":"PURO-CCS-A-02","category":"Administrative","name":"Company Registration","requirement":"Valid trade registry extract or certificate of incorporation for the CO2 Removal Supplier entity.","evidence_types":["company_registration","certificate_of_incorporation"],"critical":True},
            {"id":"PURO-CCS-A-03","category":"Administrative","name":"Regulatory Approvals","requirement":"Valid No-Objection Certificates (NOC) from relevant national authorities (FNRC, FEA, or equivalent) for CO2 injection operations.","evidence_types":["noc_regulatory","regulatory_approval"],"critical":True},
            {"id":"PURO-CCS-B-01","category":"Additionality","name":"Additionality Assessment","requirement":"Comprehensive additionality assessment demonstrating the project would not occur without carbon finance (financial, regulatory, and barrier analysis).","evidence_types":["additionality_assessment"],"critical":True},
            {"id":"PURO-CCS-B-02","category":"Additionality","name":"Baseline & Cost Analysis","requirement":"Pilot project cost analysis demonstrating financial non-viability without carbon revenue. Baseline scenario documented.","evidence_types":["cost_analysis","baseline_documentation"],"critical":False},
            {"id":"PURO-CCS-C-01","category":"Environmental & Social Safeguards","name":"Stakeholder Engagement","requirement":"Documented stakeholder engagement process including affected communities, public consultation, and feedback resolution.","evidence_types":["stakeholder_engagement","stakeholder_report"],"critical":True},
            {"id":"PURO-CCS-C-02","category":"Environmental & Social Safeguards","name":"ESS Framework","requirement":"Comprehensive ESS framework aligned with IFC Performance Standards. HR policy, on-site parameters, and HSE management system documented.","evidence_types":["ess_framework","hr_policy","hse_management"],"critical":True},
            {"id":"PURO-CCS-C-03","category":"Environmental & Social Safeguards","name":"Risk Assessment","requirement":"Uncertainty and risk register for the CO2 removal activity including geological, operational, and financial risks with mitigation measures.","evidence_types":["risk_register","risk_assessment"],"critical":True},
            {"id":"PURO-CCS-C-04","category":"Environmental & Social Safeguards","name":"Chemical Management Plan","requirement":"Chemical management plan including MSDS for all chemicals used and emergency preparedness procedures.","evidence_types":["chemical_management","msds","emergency_preparedness"],"critical":False},
            {"id":"PURO-CCS-C-05","category":"Environmental & Social Safeguards","name":"Impact Assessments","requirement":"Environmental Impact Assessment (EIA) and Social Impact Assessment (SIA) completed for the project location.","evidence_types":["eia_sia","environmental_impact","social_impact"],"critical":True},
            {"id":"PURO-CCS-D-01","category":"Storage Site","name":"Storage Site Overview","requirement":"Storage site characterisation including satellite imagery, geological survey, and site suitability assessment for permanent CO2 mineralisation.","evidence_types":["storage_site_overview","logistic_chain","site_characterisation"],"critical":True},
            {"id":"PURO-CCS-D-02","category":"Storage Site","name":"Regulatory NOCs","requirement":"No-Objection Certificates from FNRC and FEA or equivalent national bodies.","evidence_types":["noc_fnrc_fea","fnrc_noc","fea_noc"],"critical":True},
            {"id":"PURO-CCS-D-03","category":"Storage Site","name":"Reservoir Modelling","requirement":"Reservoir modelling report demonstrating injection capacity, injectivity, and long-term CO2 trapping mechanisms.","evidence_types":["reservoir_modelling","reservoir_report"],"critical":True},
            {"id":"PURO-CCS-D-04","category":"Storage Site","name":"Legal Framework","requirement":"Legal framework documenting storage rights, liability assignment, and regulatory compliance for long-term CO2 storage.","evidence_types":["legal_framework","storage_rights"],"critical":True},
            {"id":"PURO-CCS-E-01","category":"Monitoring Plan","name":"Capture & Transport Monitoring","requirement":"Monitoring plan for CO2 capture process and transportation pipeline including flow meters, pressure sensors, and leak detection.","evidence_types":["capture_transport_monitoring","monitoring_plan"],"critical":True},
            {"id":"PURO-CCS-E-02","category":"Monitoring Plan","name":"GSC Monitoring Plan","requirement":"Puro.Earth GSC methodology-specific monitoring plan covering injection rates, pressure monitoring, and mineralisation verification.","evidence_types":["gsc_monitoring_plan","monitoring_plan"],"critical":True},
            {"id":"PURO-CCS-E-03","category":"Monitoring Plan","name":"Data Systems Overview","requirement":"Overview of digital systems for data collection, storage, and reporting. Digitalization scope documented.","evidence_types":["data_systems","digitalization_scope"],"critical":False},
            {"id":"PURO-CCS-E-04","category":"Monitoring Plan","name":"Uncertainty Quantification","requirement":"Quantification uncertainty assessment for CO2 measurement, reporting, and verification per Puro.Earth Geologically Stored Carbon (GSC) methodology.","evidence_types":["uncertainty_quantification","uncertainty_assessment"],"critical":True},
            {"id":"PURO-CCS-F-01","category":"Leakage","name":"GHG Emission Displacement","requirement":"GHG emission displacement form quantifying all leakage sources: energy use, transportation, and process emissions. Net removal calculated.","evidence_types":["leakage_determination","ghg_displacement","emission_displacement"],"critical":True},
            {"id":"PURO-CCS-F-02","category":"Leakage","name":"Energy Procurement & Scope 2","requirement":"Energy procurement guidance demonstrating renewable or low-carbon energy sourcing. Scope 2 emissions calculated using market-based method.","evidence_types":["energy_procurement","scope2_emissions"],"critical":False},
            {"id":"PURO-CCS-G-01","category":"Life Cycle Assessment","name":"LCA Spreadsheet","requirement":"Life cycle assessment calculation model (XLSM/XLSX) covering all system boundaries, emission factors, and net removal calculation.","evidence_types":["lca_spreadsheet","lca_model"],"critical":True},
            {"id":"PURO-CCS-G-02","category":"Life Cycle Assessment","name":"LCA Report","requirement":"Third-party verified LCA report demonstrating net lifecycle CO2 removal, system boundaries, and compliance with ISO 14064.","evidence_types":["lca_report"],"critical":True},
            {"id":"PURO-CCS-H-01","category":"Project Description","name":"Project Description","requirement":"Complete project description covering technology, scale, location, team, implementation timeline, and co-benefits.","evidence_types":["project_description"],"critical":True},
         ]),
        ("puro_earth", "PURO-BIOCHAR-V2", "Biochar Carbon Removal",
         "Pyrolysis-based biochar production from waste biomass with permanent carbon sequestration",
         "2.0", "https://puro.earth/methodology/biochar",
         [
            {"id":"PURO-B-E-01","category":"Eligibility","name":"Feedstock Eligibility","requirement":"Feedstock must be waste biomass (agricultural residues, forestry waste). No purpose-grown biomass unless additionality proven.","evidence_types":["feedstock_declaration","supplier_documentation"],"critical":True},
            {"id":"PURO-B-E-02","category":"Eligibility","name":"Technology Eligibility","requirement":"Pyrolysis or gasification at ≥350°C. Biochar must meet EBC or IBI certification.","evidence_types":["process_documentation","certification"],"critical":True},
            {"id":"PURO-B-M-01","category":"Monitoring","name":"Production Volume","requirement":"Total biochar production (tonnes) documented per batch with timestamps, temperatures, and residence times.","evidence_types":["production_logs","monitoring_data"],"critical":True},
            {"id":"PURO-B-M-02","category":"Monitoring","name":"Temperature Logs","requirement":"Continuous temperature monitoring during pyrolysis. Peak temperature ≥700°C for H:Corg <0.4 (Class 2).","evidence_types":["temperature_time_series"],"critical":True},
            {"id":"PURO-B-Q-01","category":"Quality","name":"H:Corg Ratio","requirement":"H:Corg ≤0.7 (Class 1) or ≤0.4 (Class 2). Verified by accredited third-party lab.","evidence_types":["lab_report"],"critical":True},
            {"id":"PURO-B-Q-02","category":"Quality","name":"Carbon Content (TOC)","requirement":"Total organic carbon ≥10%, verified by accredited lab.","evidence_types":["lab_report"],"critical":True},
            {"id":"PURO-B-Q-03","category":"Quality","name":"Contaminant Testing","requirement":"PAH ≤6 mg/kg (EBC Premium). Heavy metals within EBC limits.","evidence_types":["lab_report"],"critical":True},
            {"id":"PURO-B-C-01","category":"Credit Calculation","name":"Net Carbon Removal","requirement":"Net removal = Biochar C × stability factor − process emissions − transport emissions.","evidence_types":["calculation_worksheet"],"critical":True},
            {"id":"PURO-B-D-01","category":"Documentation","name":"Chain of Custody","requirement":"Documented chain of custody from feedstock origin to biochar application site.","evidence_types":["chain_of_custody"],"critical":True},
            {"id":"PURO-B-D-02","category":"Documentation","name":"Application Records","requirement":"Evidence biochar permanently applied to soil or used in construction.","evidence_types":["application_records"],"critical":True},
         ]),
        ("puro_earth", "PURO-DAC-V1", "Direct Air Capture (DAC)",
         "Atmospheric CO2 capture using engineered systems with geological or mineralisation storage",
         "1.0", "https://puro.earth/methodology/direct-air-capture",
         [
            {"id":"PURO-DAC-A-01","category":"Technology","name":"Technology Eligibility","requirement":"DAC technology must achieve >90% CO2 capture efficiency from atmospheric air. Must use solid sorbent, liquid solvent, or electrochemical approach.","evidence_types":["technology_description","efficiency_data"],"critical":True},
            {"id":"PURO-DAC-A-02","category":"Technology","name":"Energy Source Verification","requirement":"Net-zero or renewable energy supply for DAC operations. Hourly matching preferred; minimum annual matching with additionality.","evidence_types":["energy_procurement","ppa_agreement","rec_certificates"],"critical":True},
            {"id":"PURO-DAC-B-01","category":"Measurement","name":"CO2 Capture Quantification","requirement":"Direct mass balance measurement of CO2 captured. Calibrated instrumentation with <2% measurement uncertainty.","evidence_types":["measurement_data","calibration_certificates"],"critical":True},
            {"id":"PURO-DAC-B-02","category":"Measurement","name":"Purity Verification","requirement":"Captured CO2 purity ≥99.5% verified by gas chromatography before compression/storage.","evidence_types":["gc_analysis","purity_certificates"],"critical":True},
            {"id":"PURO-DAC-C-01","category":"Storage","name":"Permanent Storage Evidence","requirement":"Geological storage or in-situ mineralisation evidence demonstrating >1000-year permanence.","evidence_types":["storage_agreement","mineralisation_reports","geological_survey"],"critical":True},
            {"id":"PURO-DAC-C-02","category":"Storage","name":"Monitoring & Verification Plan","requirement":"Post-injection monitoring plan for storage integrity including seismic, pressure, and tracer monitoring.","evidence_types":["monitoring_plan","mrv_protocol"],"critical":True},
            {"id":"PURO-DAC-D-01","category":"Life Cycle Assessment","name":"Full-System LCA","requirement":"ISO 14064-compliant LCA covering sorbent production, energy system, compression, transportation, and injection.","evidence_types":["lca_report","lca_spreadsheet"],"critical":True},
            {"id":"PURO-DAC-D-02","category":"Life Cycle Assessment","name":"Net Negativity Proof","requirement":"Net carbon removal after all process emissions ≥50% of gross capture. Third-party verified.","evidence_types":["lca_report","third_party_verification"],"critical":True},
            {"id":"PURO-DAC-E-01","category":"Additionality","name":"Financial Additionality","requirement":"Project economics demonstrate non-viability without carbon revenue at current technology maturity.","evidence_types":["financial_model","irr_analysis"],"critical":True},
         ]),
        ("puro_earth", "PURO-EW-V1", "Enhanced Weathering",
         "Terrestrial enhanced weathering using silicate rock application for permanent carbon removal",
         "1.1", "https://puro.earth/methodology/enhanced-weathering",
         [
            {"id":"PURO-EW-A-01","category":"Rock & Feedstock","name":"Rock Type Eligibility","requirement":"Feedstock must be olivine, basalt, or other silicate-rich minerals with high cation content. Serpentine prohibited due to asbestos risk.","evidence_types":["rock_analysis","mineralogy_report"],"critical":True},
            {"id":"PURO-EW-A-02","category":"Rock & Feedstock","name":"Grinding & Application","requirement":"Rock must be ground to <2mm particle size for optimal weathering rates. Application rate documented (t/ha).","evidence_types":["particle_size_distribution","application_records"],"critical":True},
            {"id":"PURO-EW-B-01","category":"Measurement","name":"Soil & Runoff Monitoring","requirement":"Pre- and post-application soil pH, alkalinity, and cation exchange capacity measurements. Runoff water alkalinity monitored.","evidence_types":["soil_sampling","water_analysis","lab_reports"],"critical":True},
            {"id":"PURO-EW-B-02","category":"Measurement","name":"Carbon Removal Quantification","requirement":"CDR quantified using mass balance model: mineral dissolution rates × application mass × carbon equivalence factor.","evidence_types":["calculation_model","field_measurements"],"critical":True},
            {"id":"PURO-EW-C-01","category":"Environmental Safeguards","name":"Heavy Metal Assessment","requirement":"Basalt/olivine heavy metal content verified. Soil heavy metal loading stays within EU/national regulatory limits.","evidence_types":["heavy_metal_analysis","regulatory_compliance"],"critical":True},
            {"id":"PURO-EW-C-02","category":"Environmental Safeguards","name":"Ecosystem Impact Assessment","requirement":"Aquatic and terrestrial ecosystem impact assessment. pH buffer capacity of receiving waterbodies verified.","evidence_types":["ecosystem_assessment","water_quality_monitoring"],"critical":True},
            {"id":"PURO-EW-D-01","category":"Life Cycle Assessment","name":"Mining & Transport LCA","requirement":"Full lifecycle emissions from quarrying, grinding, transport, and application subtracted from gross CDR.","evidence_types":["lca_report","transport_emissions"],"critical":True},
            {"id":"PURO-EW-E-01","category":"Permanence","name":"Permanence Assessment","requirement":"Demonstration that weathering products (bicarbonates) will persist in soils/ocean for >100 years.","evidence_types":["permanence_model","geochemical_analysis"],"critical":True},
         ]),
        # ── ISOMETRIC ───────────────────────────────────────────────────────
        ("isometric", "ISO-BIOCHAR-V1.2", "Biochar Permanence Protocol",
         "Science-based biochar carbon removal verification with full-system measurement and permanence accounting",
         "1.2", "https://registry.isometric.com/protocols/biochar",
         [
            {"id":"ISO-BC-M-01","category":"Measurement","name":"Quantification Methodology","requirement":"Carbon removal using Isometric's approved quantification methodology v1.2+. All inputs must meet Tier 3 measurement (direct measurement preferred over emission factors).","evidence_types":["calculation_worksheet","measurement_protocols"],"critical":True},
            {"id":"ISO-BC-M-02","category":"Measurement","name":"Uncertainty Analysis","requirement":"Combined measurement uncertainty ≤5% at 95% confidence interval using ISO GUM methodology.","evidence_types":["uncertainty_analysis","measurement_uncertainty_report"],"critical":True},
            {"id":"ISO-BC-M-03","category":"Measurement","name":"Feedstock Carbon Content","requirement":"Biomass feedstock total carbon content measured by elemental analysis (CHNS analyser). Minimum 3 representative samples per feedstock batch.","evidence_types":["elemental_analysis","lab_certificates"],"critical":True},
            {"id":"ISO-BC-P-01","category":"Permanence","name":"Permanence Assessment","requirement":"Mean residence time (MRT) >100 years demonstrated via H:Corg proxy (≤0.4) or direct MRT measurement. Safety factor applied per Isometric permanence table.","evidence_types":["lab_report","permanence_calculation","mrt_data"],"critical":True},
            {"id":"ISO-BC-P-02","category":"Permanence","name":"Application Environment","requirement":"Biochar application environment documented. Soil pH, temperature, and moisture conditions must be compatible with claimed MRT.","evidence_types":["application_records","soil_conditions","climate_data"],"critical":True},
            {"id":"ISO-BC-L-01","category":"Leakage","name":"Activity Leakage","requirement":"Feedstock diversion leakage assessed. If feedstock had alternative use, counterfactual emissions credited against project CDR.","evidence_types":["leakage_assessment","feedstock_supply_chain"],"critical":True},
            {"id":"ISO-BC-L-02","category":"Leakage","name":"Market Leakage","requirement":"Market-level leakage from biomass price effects assessed where feedstock sourcing area >1,000 km2.","evidence_types":["market_analysis","leakage_assessment"],"critical":False},
            {"id":"ISO-BC-D-01","category":"Documentation","name":"MRV Protocol","requirement":"Detailed MRV protocol submitted and pre-approved by Isometric before project commencement.","evidence_types":["mrv_protocol"],"critical":True},
            {"id":"ISO-BC-D-02","category":"Documentation","name":"Chain of Custody","requirement":"Full chain of custody from feedstock origin to biochar application. Batch-level traceability required.","evidence_types":["chain_of_custody","batch_records"],"critical":True},
            {"id":"ISO-BC-D-03","category":"Documentation","name":"Third-Party Verification","requirement":"Independent third-party verification by Isometric-approved auditor before issuance of credits.","evidence_types":["verification_report","auditor_accreditation"],"critical":True},
         ]),
        ("isometric", "ISO-BICRS-V1", "Biomass Carbon Removal and Storage (BiCRS)",
         "Biomass-based carbon removal combining bioenergy with geological or mineralisation CO2 storage",
         "1.0", "https://registry.isometric.com/protocols/bicrs",
         [
            {"id":"ISO-BICRS-A-01","category":"Technology","name":"Technology Pathway","requirement":"BECCS, biochar-to-deep-saline, or direct biomass injection. Technology pathway pre-approved by Isometric.","evidence_types":["technology_description","pathway_approval"],"critical":True},
            {"id":"ISO-BICRS-A-02","category":"Technology","name":"Biomass Sustainability","requirement":"Biomass sourced from sustainable forestry or agricultural waste per FSC/PEFC or equivalent. No primary forest conversion.","evidence_types":["sustainability_certificate","fsc_certificate","supply_chain"],"critical":True},
            {"id":"ISO-BICRS-B-01","category":"Measurement","name":"Biomass Carbon Stock","requirement":"Initial carbon content of biomass feedstock measured by elemental analysis. Carbon stock of biomass quantified from dry weight.","evidence_types":["elemental_analysis","dry_weight_measurements"],"critical":True},
            {"id":"ISO-BICRS-B-02","category":"Measurement","name":"CO2 Capture Efficiency","requirement":"Fraction of biomass carbon captured and stored (vs. emitted or lost) measured and verified.","evidence_types":["capture_efficiency_data","mass_balance"],"critical":True},
            {"id":"ISO-BICRS-C-01","category":"Storage","name":"Geological Storage Integrity","requirement":"CO2 storage formation characterised. Injection well integrity certificates. Annual pressure monitoring.","evidence_types":["geological_report","well_integrity","pressure_monitoring"],"critical":True},
            {"id":"ISO-BICRS-D-01","category":"Life Cycle Assessment","name":"System-Wide LCA","requirement":"Full LCA from forest/field to storage including land use change, harvest, transport, processing, energy, and storage.","evidence_types":["lca_report","system_boundary_diagram"],"critical":True},
            {"id":"ISO-BICRS-D-02","category":"Life Cycle Assessment","name":"Net Negativity","requirement":"Net CDR after all system emissions ≥30% of gross biomass carbon. Third-party LCA verification required.","evidence_types":["lca_report","third_party_verification"],"critical":True},
         ]),
        ("isometric", "ISO-REFOR-V1", "Reforestation",
         "High-durability reforestation with rigorous permanence accounting and 100-year monitoring",
         "1.0", "https://registry.isometric.com/protocols/reforestation",
         [
            {"id":"ISO-REF-A-01","category":"Additionality","name":"Additionality Demonstration","requirement":"Land was deforested or degraded. Natural regeneration counterfactual evaluated.","evidence_types":["land_history","satellite_imagery","counterfactual_analysis"],"critical":True},
            {"id":"ISO-REF-B-01","category":"Measurement","name":"Above-Ground Biomass","requirement":"Above-ground biomass measured using allometric equations validated for species and region. Minimum 95% confidence interval.","evidence_types":["field_measurements","allometric_equations","species_data"],"critical":True},
            {"id":"ISO-REF-B-02","category":"Measurement","name":"Below-Ground Carbon","requirement":"Root biomass and soil carbon measured using IPCC Tier 2 or better methods.","evidence_types":["soil_measurements","root_to_shoot_ratios"],"critical":True},
            {"id":"ISO-REF-C-01","category":"Permanence","name":"100-Year Monitoring Plan","requirement":"Legal and financial mechanisms ensuring 100-year forest protection. Third-party monitoring every 5 years.","evidence_types":["legal_protection","monitoring_plan","financial_mechanism"],"critical":True},
            {"id":"ISO-REF-C-02","category":"Permanence","name":"Reversal Buffer","requirement":"Minimum 20% of credits held in Isometric buffer pool against fire, disease, or conversion risk.","evidence_types":["buffer_contribution","risk_assessment"],"critical":True},
            {"id":"ISO-REF-D-01","category":"Biodiversity","name":"Native Species Requirement","requirement":"≥80% native species. Monoculture plantations of exotic species not eligible.","evidence_types":["species_list","planting_records"],"critical":True},
         ]),
        ("isometric", "ISO-BIOCCS-V1", "Biogenic Carbon Capture and Storage (Bio-CCS)",
         "Point-source capture of biogenic CO2 from industrial processes with geological storage",
         "1.0", "https://registry.isometric.com/protocols/bio-ccs",
         [
            {"id":"ISO-BIOCCS-A-01","category":"Eligibility","name":"Biogenic CO2 Source","requirement":"CO2 must be biogenic (from biomass combustion, fermentation, or pulp/paper). Fossil-fuel CO2 excluded.","evidence_types":["isotope_analysis","source_documentation"],"critical":True},
            {"id":"ISO-BIOCCS-B-01","category":"Measurement","name":"Capture Rate Measurement","requirement":"CO2 capture rate measured by continuous flow metering with Tier 3 uncertainty (<2%).","evidence_types":["flow_meter_data","calibration_records"],"critical":True},
            {"id":"ISO-BIOCCS-C-01","category":"Storage","name":"Storage Formation Qualification","requirement":"Storage formation risk class A or B per DNV-RP-J203. Seismic characterisation completed.","evidence_types":["geological_survey","dnv_assessment"],"critical":True},
            {"id":"ISO-BIOCCS-D-01","category":"Life Cycle Assessment","name":"Process LCA","requirement":"LCA from biogenic source to permanent storage. Net CDR ≥80% of captured CO2.","evidence_types":["lca_report"],"critical":True},
         ]),
        ("isometric", "ISO-WAE-V1", "Wastewater Alkalinity Enhancement",
         "Ocean-bound alkalinity addition via wastewater treatment to enhance marine CO2 uptake",
         "1.0", "https://registry.isometric.com/protocols/wastewater-alkalinity",
         [
            {"id":"ISO-WAE-A-01","category":"Technology","name":"Alkalinity Addition Method","requirement":"Lime, sodium carbonate, or equivalent alkalinity agent added to wastewater before ocean discharge. Chemical purity >98%.","evidence_types":["process_description","chemical_certificates"],"critical":True},
            {"id":"ISO-WAE-B-01","category":"Measurement","name":"Alkalinity Measurement","requirement":"Influent and effluent alkalinity measured using Gran titration method. Minimum 3 measurements per day.","evidence_types":["lab_measurements","titration_data"],"critical":True},
            {"id":"ISO-WAE-B-02","category":"Measurement","name":"CO2 Drawdown Calculation","requirement":"Atmospheric CO2 drawdown calculated from alkalinity increase using Revelle factor and ocean chemistry model.","evidence_types":["calculation_model","ocean_chemistry_data"],"critical":True},
            {"id":"ISO-WAE-C-01","category":"Environmental","name":"Marine Ecosystem Assessment","requirement":"Impact assessment on local marine ecosystem. pH increase at discharge point <0.2 units.","evidence_types":["marine_assessment","ph_monitoring"],"critical":True},
            {"id":"ISO-WAE-D-01","category":"Permanence","name":"Ocean Permanence","requirement":"Demonstration CDR persists as dissolved inorganic carbon in ocean for >100 years using CMIP6 ocean model.","evidence_types":["ocean_model_results","permanence_calculation"],"critical":True},
         ]),
        ("isometric", "ISO-SUBBIOMASS-V1", "Subsurface Biomass Carbon Removal and Storage",
         "Direct injection of shredded biomass into geological formations for permanent carbon sequestration",
         "1.0", "https://registry.isometric.com/protocols/subsurface-biomass",
         [
            {"id":"ISO-SUB-A-01","category":"Technology","name":"Biomass Preparation","requirement":"Biomass prepared to specification for subsurface injection. Particle size, moisture, and microbial stability verified.","evidence_types":["preparation_records","technical_specifications"],"critical":True},
            {"id":"ISO-SUB-A-02","category":"Technology","name":"Injection Well Design","requirement":"Well design approved by geological engineer. Injection zone >800m depth with confining caprock.","evidence_types":["well_design","geological_report","depth_confirmation"],"critical":True},
            {"id":"ISO-SUB-B-01","category":"Measurement","name":"Biomass Carbon Quantification","requirement":"Total biomass carbon injected measured by dry weight × carbon fraction. Carbon fraction from elemental analysis.","evidence_types":["injection_logs","elemental_analysis","mass_balance"],"critical":True},
            {"id":"ISO-SUB-C-01","category":"Permanence","name":"Geological Integrity","requirement":"Formation evaluated for CO2/CH4 generation risk. Geochemical modelling of biomass degradation pathway.","evidence_types":["geochemical_model","formation_assessment"],"critical":True},
            {"id":"ISO-SUB-D-01","category":"Monitoring","name":"Post-Injection Monitoring","requirement":"Gas monitoring at surface and caprock level for CH4 leakage. Annual pressure surveys.","evidence_types":["monitoring_data","pressure_surveys","gas_analysis"],"critical":True},
         ]),
        ("isometric", "ISO-EW-V1", "Enhanced Weathering / Open System Ex-Situ Mineralization",
         "Silicate rock application to agricultural soils for enhanced CO2 drawdown via chemical weathering",
         "1.0", "https://registry.isometric.com/protocols/enhanced-weathering",
         [
            {"id":"ISO-EW-A-01","category":"Rock Characterisation","name":"Mineralogy Analysis","requirement":"XRF and XRD analysis of rock feedstock. Reactive silicate content ≥40%. Heavy metal screening mandatory.","evidence_types":["xrf_analysis","xrd_analysis","mineralogy_report"],"critical":True},
            {"id":"ISO-EW-B-01","category":"Measurement","name":"Field Carbon Removal","requirement":"CDR quantified by soil inorganic carbon increase + runoff alkalinity increase. Sampling at 0-30cm and 30-60cm depth.","evidence_types":["soil_inorganic_carbon","water_alkalinity","field_measurements"],"critical":True},
            {"id":"ISO-EW-B-02","category":"Measurement","name":"Uncertainty Budget","requirement":"Combined CDR uncertainty ≤20% (enhanced weathering acknowledged as inherently uncertain). Monte Carlo analysis.","evidence_types":["uncertainty_analysis","monte_carlo_model"],"critical":True},
            {"id":"ISO-EW-C-01","category":"Environmental","name":"Heavy Metal Risk Assessment","requirement":"Soil and food chain heavy metal loading assessed. Ni, Cr, Mn within WHO/EU food safety limits.","evidence_types":["soil_analysis","food_chain_assessment"],"critical":True},
            {"id":"ISO-EW-D-01","category":"Life Cycle Assessment","name":"Mining & Application LCA","requirement":"LCA from quarry to field. Transport emissions, grinding energy, and application equipment all included.","evidence_types":["lca_report","transport_data"],"critical":True},
         ]),
        ("isometric", "ISO-ESM-V1", "Electrolytic Seawater Mineralization",
         "Electrochemical ocean alkalinity enhancement to remove CO2 from seawater at scale",
         "1.0", "https://registry.isometric.com/protocols/electrolytic-seawater",
         [
            {"id":"ISO-ESM-A-01","category":"Technology","name":"Electrolyser Specification","requirement":"Electrolysis system achieving seawater pH >9 with energy consumption <500 kWh per tonne CO2 removed.","evidence_types":["technical_specifications","energy_consumption_data"],"critical":True},
            {"id":"ISO-ESM-A-02","category":"Technology","name":"Renewable Energy Supply","requirement":"100% renewable energy for electrolysis demonstrated by hourly matched RECs or dedicated renewable supply.","evidence_types":["energy_certificates","ppa_agreement"],"critical":True},
            {"id":"ISO-ESM-B-01","category":"Measurement","name":"Ocean Chemistry Monitoring","requirement":"Continuous pH, alkalinity, and dissolved inorganic carbon monitoring at intake and discharge. Isometric-approved sensor specification.","evidence_types":["sensor_data","calibration_records","monitoring_report"],"critical":True},
            {"id":"ISO-ESM-B-02","category":"Measurement","name":"CO2 Drawdown Quantification","requirement":"CDR = (effluent alkalinity − influent alkalinity) × flow rate × Revelle factor × uncertainty discount.","evidence_types":["calculation_model","flow_data","alkalinity_data"],"critical":True},
            {"id":"ISO-ESM-C-01","category":"Environmental","name":"Marine Ecosystem Impact","requirement":"Chlorine and other by-products monitored and diluted below marine safety thresholds. Ecological survey annually.","evidence_types":["chemical_monitoring","ecological_survey"],"critical":True},
            {"id":"ISO-ESM-D-01","category":"Permanence","name":"Long-Term Ocean CO2 Permanence","requirement":"Ocean circulation model demonstrating 100-year CO2 permanence in deepwater alkalinity pools.","evidence_types":["ocean_model","permanence_report"],"critical":True},
         ]),
        # ── GOLD STANDARD ───────────────────────────────────────────────────
        ("gold_standard", "GS-ICS-V3", "Improved Cookstoves",
         "Clean cooking intervention reducing biomass combustion emissions with SDG co-benefits",
         "3.0", "https://www.goldstandard.org/resources/methodologies",
         [
            {"id":"GS-ICS-B-01","category":"Baseline","name":"Baseline Scenario","requirement":"Business-as-usual fuel type (firewood, charcoal, dung), consumption per household, and stove efficiency documented via KPT surveys.","evidence_types":["baseline_study","kpt_survey","household_data"],"critical":True},
            {"id":"GS-ICS-A-01","category":"Additionality","name":"Additionality Assessment","requirement":"Financial, technological, and social barriers to clean cooking adoption without carbon finance. Gold Standard additionality test passed.","evidence_types":["additionality_assessment","barrier_analysis"],"critical":True},
            {"id":"GS-ICS-S-01","category":"Safeguards","name":"Stakeholder Consultation","requirement":"FPIC (Free, Prior and Informed Consent) process documented. Local community engagement ≥3 consultations before project start.","evidence_types":["stakeholder_report","fpic_documentation","consultation_records"],"critical":True},
            {"id":"GS-ICS-M-01","category":"Monitoring","name":"Monitoring Report","requirement":"Annual monitoring: stove counts, usage surveys (KPT), fuel consumption measurements. Random sampling ≥10% of beneficiary households.","evidence_types":["monitoring_report","kpt_survey","usage_data"],"critical":True},
            {"id":"GS-ICS-M-02","category":"Monitoring","name":"Stove Testing","requirement":"Cookstove performance tested per ISO 19867 (Water Boiling Test and Controlled Cooking Test) or equivalent.","evidence_types":["stove_test_results","iso_19867_data"],"critical":True},
            {"id":"GS-ICS-C-01","category":"Co-Benefits","name":"SDG Co-Benefits","requirement":"SDG 3 (health), SDG 7 (clean energy), SDG 13 (climate) contribution documented with measurable KPIs per GS Impact Standards.","evidence_types":["co_benefits_report","sdg_indicators"],"critical":False},
            {"id":"GS-ICS-C-02","category":"Co-Benefits","name":"Gender Impact Assessment","requirement":"Gender-disaggregated data on time saved, health impact, and economic benefit per GS Gender Equality requirements.","evidence_types":["gender_assessment","disaggregated_data"],"critical":False},
            {"id":"GS-ICS-Q-01","category":"Credit Calculation","name":"Emission Reduction Calculation","requirement":"ERs = (baseline emissions − project emissions − leakage) per Gold Standard TPDDTEC methodology.","evidence_types":["calculation_worksheet","emission_factors"],"critical":True},
         ]),
        ("gold_standard", "GS-REDD-V1", "REDD+ Forest Conservation",
         "Reducing emissions from deforestation and forest degradation with community co-benefits",
         "1.0", "https://www.goldstandard.org/resources/methodologies",
         [
            {"id":"GS-REDD-A-01","category":"Additionality","name":"Deforestation Threat Evidence","requirement":"Evidence of credible deforestation threat without project intervention. Historical deforestation rate ≥1%/year or documented drivers.","evidence_types":["satellite_imagery","deforestation_analysis","threat_assessment"],"critical":True},
            {"id":"GS-REDD-B-01","category":"Baseline","name":"Reference Emission Level","requirement":"Jurisdictional or project-level reference emission level (REL) established per VCS/GS REDD+ methodology. FAO land use data used.","evidence_types":["rel_documentation","land_use_data","deforestation_model"],"critical":True},
            {"id":"GS-REDD-C-01","category":"Measurement","name":"Carbon Stock Measurement","requirement":"Above-ground biomass measured using field plots (allometric equations) and/or LiDAR. Below-ground and soil carbon included.","evidence_types":["field_measurement","remote_sensing","carbon_maps"],"critical":True},
            {"id":"GS-REDD-D-01","category":"Safeguards","name":"FPIC & Community Rights","requirement":"FPIC documented for all indigenous and local communities. Benefit-sharing arrangement agreed.","evidence_types":["fpic_documentation","benefit_sharing","community_agreements"],"critical":True},
            {"id":"GS-REDD-E-01","category":"Permanence","name":"Buffer Pool Contribution","requirement":"Minimum 10% credits contributed to GS buffer pool. Non-permanence risk rating <30%.","evidence_types":["risk_assessment","buffer_contribution"],"critical":True},
         ]),
        ("gold_standard", "GS-RE-V1", "Solar & Wind Clean Energy",
         "Grid-connected renewable energy displacing fossil generation with measurable emission reductions",
         "1.0", "https://www.goldstandard.org/resources/methodologies",
         [
            {"id":"GS-RE-A-01","category":"Additionality","name":"Grid Emission Factor","requirement":"Project connected to grid with emission factor ≥0.2 tCO2e/MWh. Additionality demonstrated against grid mix.","evidence_types":["grid_emission_factor","additionality_test"],"critical":True},
            {"id":"GS-RE-B-01","category":"Measurement","name":"Generation Metering","requirement":"Revenue-grade meters (IEC 62053-22 Class 0.2S) installed and certified. Monthly meter readings required.","evidence_types":["meter_certificates","meter_readings","calibration_records"],"critical":True},
            {"id":"GS-RE-B-02","category":"Measurement","name":"Displacement Calculation","requirement":"Emission reduction = net generation × grid emission factor (combined margin). Capped at 80% capacity factor.","evidence_types":["calculation_worksheet","grid_factor_source"],"critical":True},
            {"id":"GS-RE-C-01","category":"Co-Benefits","name":"Local Energy Access","requirement":"Documented improvement in local energy access. Community consultation completed.","evidence_types":["energy_access_data","community_consultation"],"critical":False},
            {"id":"GS-RE-D-01","category":"Monitoring","name":"Annual Monitoring Report","requirement":"Annual monitoring including generation data, grid connection status, equipment condition, and any curtailment.","evidence_types":["monitoring_report","generation_logs"],"critical":True},
         ]),
        ("gold_standard", "GS-WATER-V1", "Safe Water Access",
         "Clean water provision reducing boiling emissions and improving health outcomes",
         "1.0", "https://www.goldstandard.org/resources/methodologies",
         [
            {"id":"GS-W-A-01","category":"Baseline","name":"Baseline Water Treatment","requirement":"Evidence households previously boiled water using wood/charcoal/kerosene. Baseline fuel consumption survey completed.","evidence_types":["baseline_survey","fuel_consumption_data"],"critical":True},
            {"id":"GS-W-B-01","category":"Technology","name":"Water Treatment Technology","requirement":"Treatment technology approved (reverse osmosis, UV, chlorination). WHO drinking water standards achieved.","evidence_types":["technology_specifications","water_quality_tests"],"critical":True},
            {"id":"GS-W-C-01","category":"Monitoring","name":"Usage Monitoring","requirement":"Water dispensing volumes monitored by flow meter. Minimum monthly readings. Household surveys annually.","evidence_types":["flow_meter_data","household_surveys"],"critical":True},
            {"id":"GS-W-D-01","category":"Co-Benefits","name":"Health Impact","requirement":"Reduction in waterborne illness documented. SDG 3 and SDG 6 indicators tracked and reported.","evidence_types":["health_survey","sdg_indicators"],"critical":False},
         ]),
        # ── VERRA ───────────────────────────────────────────────────────────
        ("verra", "VM0044-V2", "Biochar Methodology VM0044",
         "Verra Verified Carbon Standard biochar methodology for high-permanence biochar carbon removal",
         "2.0", "https://verra.org/methodologies/vm0044",
         [
            {"id":"VM44-E-01","category":"Eligibility","name":"Methodology Applicability","requirement":"Project meets VM0044 applicability conditions. Feedstock from waste stream. Biochar must remain in field or built environment.","evidence_types":["methodology_compliance","feedstock_documentation"],"critical":True},
            {"id":"VM44-E-02","category":"Eligibility","name":"Technology Eligibility","requirement":"Pyrolysis or gasification unit achieving ≥450°C. Production process documented per VM0044 Annex 1.","evidence_types":["technology_description","process_documentation"],"critical":True},
            {"id":"VM44-B-01","category":"Baseline","name":"Baseline Carbon Stock","requirement":"Baseline carbon stock of feedstock calculated using VM0044 equations. Counterfactual decay pathway assessed.","evidence_types":["baseline_calculation","decay_model"],"critical":True},
            {"id":"VM44-M-01","category":"Monitoring","name":"Production Monitoring Plan","requirement":"VM0044-compliant monitoring plan covering production quantities, temperatures, quality, and application records.","evidence_types":["monitoring_plan","production_logs"],"critical":True},
            {"id":"VM44-M-02","category":"Monitoring","name":"Soil Application Records","requirement":"GPS-tagged application records. Application rate ≤15 t biochar/ha/year unless agronomic justification provided.","evidence_types":["application_records","gps_data"],"critical":True},
            {"id":"VM44-Q-01","category":"Quality","name":"Biochar Quality Analysis","requirement":"H:Corg <0.7, TOC ≥10%, PAH <16 mg/kg, heavy metals within VCS limits. Minimum one lab test per 100 tonnes.","evidence_types":["lab_report","quality_certificates"],"critical":True},
            {"id":"VM44-Q-02","category":"Quality","name":"Stability Class Assignment","requirement":"Biochar classified as VM0044 Class 1 (H:Corg ≤0.4) or Class 2 (H:Corg ≤0.7). Credit tonnage scaled by class.","evidence_types":["lab_report","class_determination"],"critical":True},
            {"id":"VM44-L-01","category":"Leakage","name":"Leakage Assessment","requirement":"Feedstock diversion, fertiliser substitution, and production process leakage assessed per VM0044 Section 8.","evidence_types":["leakage_assessment","fertiliser_data"],"critical":True},
         ]),
        ("verra", "VM0007-REDD-V2", "REDD+ Avoided Deforestation (VM0007)",
         "Avoiding unplanned deforestation and forest degradation under the REDD+ framework",
         "2.0", "https://verra.org/methodologies/vm0007",
         [
            {"id":"VM07-A-01","category":"Additionality","name":"Unplanned Deforestation Evidence","requirement":"Credible threat of unplanned deforestation. Drivers analysis: agricultural expansion, logging, charcoal production, or infrastructure.","evidence_types":["threat_assessment","drivers_analysis","satellite_imagery"],"critical":True},
            {"id":"VM07-B-01","category":"Baseline","name":"Reference Region","requirement":"Reference region for baseline emission estimation defined per VM0007 rules. Historical deforestation rate in reference region calculated.","evidence_types":["reference_region_map","deforestation_data","gis_analysis"],"critical":True},
            {"id":"VM07-C-01","category":"Measurement","name":"Activity Data","requirement":"Annual deforestation and degradation activity data from remote sensing (Landsat or better). Map accuracy ≥90% (Olofsson approach).","evidence_types":["remote_sensing_data","accuracy_assessment","land_cover_maps"],"critical":True},
            {"id":"VM07-C-02","category":"Measurement","name":"Emission Factors","requirement":"Emission factors for each forest stratum. Tier 2 (IPCC 2006) or better. Above-ground and below-ground biomass.","evidence_types":["emission_factors","biomass_data","stratum_map"],"critical":True},
            {"id":"VM07-D-01","category":"Safeguards","name":"Social & Environmental Safeguards","requirement":"CCBA Gold level or equivalent social and environmental safeguards. FPIC for all communities.","evidence_types":["ccba_assessment","fpic_documentation","community_agreements"],"critical":True},
            {"id":"VM07-E-01","category":"Permanence","name":"Non-Permanence Risk Assessment","requirement":"VERRA non-permanence risk tool score <40. Buffer pool contribution determined by risk score.","evidence_types":["risk_assessment","buffer_calculation"],"critical":True},
            {"id":"VM07-F-01","category":"Leakage","name":"Leakage Belt & Market Leakage","requirement":"Leakage belt defined (minimum 50km buffer). Activity shifting leakage and market leakage assessed.","evidence_types":["leakage_assessment","leakage_belt_map"],"critical":True},
         ]),
        ("verra", "VM0012-IFM-V1", "Improved Forest Management (VM0012)",
         "Increasing carbon stocks through improved forest management practices beyond baseline",
         "1.2", "https://verra.org/methodologies/vm0012",
         [
            {"id":"VM12-A-01","category":"Baseline","name":"Baseline Management Scenario","requirement":"Current (baseline) forest management practice documented: harvest rotation, species selection, and silvicultural system.","evidence_types":["management_plan","baseline_documentation"],"critical":True},
            {"id":"VM12-B-01","category":"Additionality","name":"Improved Management Additionality","requirement":"Project management scenario demonstrably different from baseline. Financial barriers to adoption demonstrated.","evidence_types":["additionality_assessment","management_comparison"],"critical":True},
            {"id":"VM12-C-01","category":"Measurement","name":"Forest Inventory","requirement":"Permanent sample plots established per VM0012 sampling design. Allometric equations region-validated.","evidence_types":["plot_data","inventory_report","allometric_equations"],"critical":True},
            {"id":"VM12-D-01","category":"Monitoring","name":"5-Year Monitoring","requirement":"Remeasurement of permanent sample plots every 5 years. Carbon stock change calculated.","evidence_types":["monitoring_report","plot_remeasurement"],"critical":True},
            {"id":"VM12-E-01","category":"Permanence","name":"Management Agreement","requirement":"Forest management agreement or legal protection covering project crediting period (30-100 years).","evidence_types":["management_agreement","legal_protection"],"critical":True},
         ]),
        ("verra", "VM0038-COOK-V1", "Cookstoves Methodology (VM0038)",
         "Metered and default methodology for clean cookstove projects under VCS",
         "1.0", "https://verra.org/methodologies/vm0038",
         [
            {"id":"VM38-A-01","category":"Eligibility","name":"Technology Eligibility","requirement":"Stove must achieve IWA Tier 3+ for PM2.5 and CO emissions. Biomass, LPG, biogas, or electric stoves eligible.","evidence_types":["stove_test_results","iwa_certification"],"critical":True},
            {"id":"VM38-B-01","category":"Baseline","name":"Baseline Fuel Survey","requirement":"Baseline fuel type, quantity, and source documented per KPT or default methodology.","evidence_types":["baseline_survey","fuel_consumption","kpt_data"],"critical":True},
            {"id":"VM38-C-01","category":"Monitoring","name":"Stove Usage Monitoring","requirement":"Metered: continuous data logger on stove usage. Default: kitchen performance tests ≥10% households annually.","evidence_types":["usage_data","logger_records","kpt_results"],"critical":True},
            {"id":"VM38-D-01","category":"Credit Calculation","name":"Emission Reduction Calculation","requirement":"ERs calculated per VM0038 default emission factors or project-specific measurements.","evidence_types":["calculation_worksheet","emission_factors","usage_data"],"critical":True},
         ]),
    ]

    for attempt in range(3):
        db = None
        try:
            db = SessionLocal()

            # Advisory lock — only one gunicorn worker seeds at a time (key = 424242)
            locked = db.execute(_text("SELECT pg_try_advisory_lock(424242)")).scalar()
            if not locked:
                logger.info("Protocol seed: another worker holds the lock — skipping")
                db.close()
                return

            try:
                # ── Registries ────────────────────────────────────────────────
                for reg in REGISTRIES:
                    existing = db.query(VVRegistry).filter_by(slug=reg["slug"]).first()
                    if not existing:
                        db.add(VVRegistry(**reg))
                        logger.info(f"Seeded registry: {reg['name']}")
                db.commit()

                # ── Protocols + Checkpoints ────────────────────────────────────
                for (reg_slug, code, name, description, version, source_url, checkpoints) in PROTOCOLS:
                    registry = db.query(VVRegistry).filter_by(slug=reg_slug).first()
                    if not registry:
                        logger.warning(f"Registry not found for slug '{reg_slug}' — skipping {code}")
                        continue

                    existing = db.query(VVProtocol).filter_by(
                        registry_id=registry.id, code=code
                    ).first()
                    if existing:
                        continue  # already seeded — idempotent

                    protocol = VVProtocol(
                        registry_id=registry.id,
                        code=code,
                        name=name,
                        description=description,
                        version=version,
                        status="active",
                        source_url=source_url,
                    )
                    db.add(protocol)
                    db.flush()  # assigns protocol.id without committing

                    for idx, cp in enumerate(checkpoints):
                        db.add(VVCheckpointDef(
                            protocol_id=protocol.id,
                            checkpoint_id=cp["id"],
                            category=cp["category"],
                            name=cp["name"],
                            requirement=cp["requirement"],
                            critical=cp.get("critical", True),
                            evidence_types=cp.get("evidence_types", []),
                            sort_order=idx,
                        ))

                    db.commit()  # commit each protocol + its checkpoints individually
                    logger.info(f"Seeded protocol: {code} ({len(checkpoints)} checkpoints)")

            finally:
                try:
                    db.execute(_text("SELECT pg_advisory_unlock(424242)"))
                    db.commit()
                except Exception:
                    pass

            db.close()
            return

        except Exception as e:
            logger.warning(f"Protocol seed attempt {attempt+1} failed: {e}")
            if db:
                try: db.rollback(); db.close()
                except: pass
            import time; time.sleep(1)
