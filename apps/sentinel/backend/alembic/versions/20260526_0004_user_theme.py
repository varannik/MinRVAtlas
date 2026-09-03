"""Add theme column to users table

Revision ID: 20260526_0004
Revises: 20260525_0003
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa

revision = "20260526_0004"
down_revision = "20260525_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS guards against re-running on a DB that already has the column
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(10) DEFAULT 'dark'")


def downgrade() -> None:
    op.drop_column("users", "theme")
