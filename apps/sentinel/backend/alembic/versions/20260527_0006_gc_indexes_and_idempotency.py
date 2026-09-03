"""Add GC indexes on revoked_tokens and run_progress_events,
plus partial unique constraint on dqa_violations for idempotency.

Revision ID: 20260527_0006
Revises: 20260527_0005
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa

revision = "20260527_0006"
down_revision = "20260527_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Speed up the nightly GC DELETE on revoked_tokens
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_revoked_tokens_expires_at
        ON revoked_tokens (expires_at)
    """)

    # Speed up the nightly GC DELETE on run_progress_events
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_run_progress_events_created_at
        ON run_progress_events (created_at)
    """)

    # Partial unique index to prevent duplicate violations per (run, rule, field).
    # Applies only when affected_field IS NOT NULL to allow multiple field-less
    # violations (e.g. schema-level violations) per rule in the same run.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uix_dqa_violations_run_rule_field
        ON dqa_violations (run_id, rule_id, affected_field)
        WHERE affected_field IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_revoked_tokens_expires_at")
    op.execute("DROP INDEX IF EXISTS ix_run_progress_events_created_at")
    op.execute("DROP INDEX IF EXISTS uix_dqa_violations_run_rule_field")
