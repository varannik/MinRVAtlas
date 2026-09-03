"""Phase 4 — two-person rule: countersign columns on vv_decisions

Revision ID: 20260530_0015
Revises: 20260530_0014
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260530_0015'
down_revision = '20260530_0014'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('vv_decisions', sa.Column('second_reviewer_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('vv_decisions', sa.Column('second_reviewer_name', sa.String(300), nullable=True))
    op.add_column('vv_decisions', sa.Column('second_reviewer_note', sa.Text(), nullable=True))
    op.add_column('vv_decisions', sa.Column('countersigned_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('vv_decisions', sa.Column('signature_hash', sa.String(64), nullable=True))


def downgrade():
    for col in ('signature_hash', 'countersigned_at', 'second_reviewer_note', 'second_reviewer_name', 'second_reviewer_id'):
        op.drop_column('vv_decisions', col)
