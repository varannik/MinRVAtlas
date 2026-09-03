"""vv_report_anchor: blockchain anchor fields on vv_reports

Revision ID: 20260528_0010
Revises: 20260528_0009
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa

revision = '20260528_0010'
down_revision = '20260528_0009'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('vv_reports', sa.Column('anchor_tx_hash',    sa.String(100),  nullable=True))
    op.add_column('vv_reports', sa.Column('anchor_block',      sa.BigInteger(), nullable=True))
    op.add_column('vv_reports', sa.Column('anchor_anchored_at',sa.DateTime(timezone=True), nullable=True))
    op.add_column('vv_reports', sa.Column('anchor_report_hash',sa.String(64),   nullable=True))
    op.add_column('vv_reports', sa.Column('anchor_chain',      sa.String(40),   nullable=True))


def downgrade():
    for col in ('anchor_chain','anchor_report_hash','anchor_anchored_at','anchor_block','anchor_tx_hash'):
        op.drop_column('vv_reports', col)
