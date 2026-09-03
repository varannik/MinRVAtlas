"""Add data_connectors, organisations, run_progress_events, webhook_deliveries tables

Revision ID: 20260527_0005
Revises: 20260526_0004
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa

revision = "20260527_0005"
down_revision = "20260526_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cross-worker SSE progress events
    op.execute("""
        CREATE TABLE IF NOT EXISTS run_progress_events (
            id BIGSERIAL PRIMARY KEY,
            run_id UUID NOT NULL,
            step VARCHAR(100) NOT NULL,
            pct INTEGER NOT NULL,
            detail TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_run_progress_events_run_id ON run_progress_events (run_id, id)")

    # Data source connectors
    op.execute("""
        CREATE TABLE IF NOT EXISTS data_connectors (
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
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_data_connectors_project_id ON data_connectors (project_id)")

    # Organisations (tenant isolation)
    op.execute("""
        CREATE TABLE IF NOT EXISTS organisations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(100) UNIQUE,
            plan VARCHAR(50) DEFAULT 'starter',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_org_id ON users (org_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_projects_org_id ON projects (org_id)")

    # Webhook deliveries with retry support
    op.execute("""
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
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
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_status ON webhook_deliveries (status, next_retry_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_webhook_deliveries_project ON webhook_deliveries (project_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS webhook_deliveries")
    op.execute("DROP INDEX IF EXISTS ix_projects_org_id")
    op.execute("DROP INDEX IF EXISTS ix_users_org_id")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS org_id")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS org_id")
    op.execute("DROP TABLE IF EXISTS organisations")
    op.execute("DROP TABLE IF EXISTS data_connectors")
    op.execute("DROP TABLE IF EXISTS run_progress_events")
