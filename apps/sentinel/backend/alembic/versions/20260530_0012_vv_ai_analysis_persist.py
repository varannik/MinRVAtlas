"""Persist AI deep-analysis result on vv_projects

Revision ID: 20260530_0012
Revises: 20260528_0011
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260530_0012'
down_revision = '20260528_0011'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'vv_projects',
        sa.Column('last_analysis_result', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        'vv_projects',
        sa.Column('last_analysis_run_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column('vv_projects', 'last_analysis_run_at')
    op.drop_column('vv_projects', 'last_analysis_result')
