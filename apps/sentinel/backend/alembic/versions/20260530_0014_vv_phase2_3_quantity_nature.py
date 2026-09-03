"""Phase 2+3 — credit quantity + additionality/permanence columns on vv_projects

Revision ID: 20260530_0014
Revises: 20260530_0013
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260530_0014'
down_revision = '20260530_0013'
branch_labels = None
depends_on = None


def upgrade():
    for col in (
        'credit_quantity_result',
        'additionality_result',
        'permanence_result',
    ):
        op.add_column(
            'vv_projects',
            sa.Column(col, postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        )
    for col in (
        'credit_quantity_run_at',
        'additionality_run_at',
        'permanence_run_at',
    ):
        op.add_column(
            'vv_projects',
            sa.Column(col, sa.DateTime(timezone=True), nullable=True),
        )


def downgrade():
    for col in (
        'permanence_run_at', 'permanence_result',
        'additionality_run_at', 'additionality_result',
        'credit_quantity_run_at', 'credit_quantity_result',
    ):
        op.drop_column('vv_projects', col)
