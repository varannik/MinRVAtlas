"""Add ignore_hard_gates column to dqa_runs

Revision ID: 20260619_0001
Revises: 20260530_0016
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = '20260619_0001'
down_revision = '20260530_0016'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'dqa_runs',
        sa.Column('ignore_hard_gates', sa.Boolean(), nullable=True, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('dqa_runs', 'ignore_hard_gates')
