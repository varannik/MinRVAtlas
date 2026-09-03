"""Add created_by to correction_suggestions (Fix #10 self-approval guard)

Revision ID: 20260524_0002
Revises: 20240101_0001_baseline
Create Date: 2026-05-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260524_0002"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS — safe to re-run on a DB where the column already exists
    op.execute("""
        ALTER TABLE correction_suggestions
        ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_correction_suggestions_created_by
        ON correction_suggestions (created_by)
    """)


def downgrade() -> None:
    op.drop_index("ix_correction_suggestions_created_by", table_name="correction_suggestions")
    op.drop_column("correction_suggestions", "created_by")
