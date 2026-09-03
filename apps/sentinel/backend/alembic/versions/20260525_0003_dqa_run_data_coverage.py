"""Add data_coverage column to dqa_runs

Revision ID: 20260525_0003
Revises: 20260524_0002
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa

revision = "20260525_0003"
down_revision = "20260524_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS guards against re-running on a DB that already has the column
    op.execute("ALTER TABLE dqa_runs ADD COLUMN IF NOT EXISTS data_coverage FLOAT")


def downgrade() -> None:
    op.drop_column("dqa_runs", "data_coverage")
