"""vv_doc_versions: add doc_version + version_history to vv_documents

Revision ID: 20260528_0009
Revises: 20260528_0008
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '20260528_0009'
down_revision = '20260528_0008'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('vv_documents', sa.Column('doc_version', sa.Integer, server_default='1', nullable=False))
    op.add_column('vv_documents', sa.Column('version_history', JSONB, server_default='[]', nullable=False))


def downgrade():
    op.drop_column('vv_documents', 'version_history')
    op.drop_column('vv_documents', 'doc_version')
