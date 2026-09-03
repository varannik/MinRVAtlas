"""vv_project: add last_consistency_result and last_consistency_run_at

Revision ID: 20260528_0007
Revises: 20260527_0006_gc_indexes_and_idempotency
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '20260528_0007'
down_revision = '20260527_0006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('vv_projects', sa.Column('last_consistency_result', JSONB, nullable=True))
    op.add_column('vv_projects', sa.Column('last_consistency_run_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('vv_projects', 'last_consistency_run_at')
    op.drop_column('vv_projects', 'last_consistency_result')
