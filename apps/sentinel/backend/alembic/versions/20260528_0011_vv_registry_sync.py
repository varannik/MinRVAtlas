"""vv_registry_sync: registry sync status table

Revision ID: 20260528_0011
Revises: 20260528_0010
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '20260528_0011'
down_revision = '20260528_0010'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'vv_registry_sync',
        # id and project_id must use PostgreSQL UUID to match vv_projects.id type
        sa.Column('id',                   UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id',           UUID(as_uuid=True), sa.ForeignKey('vv_projects.id'), nullable=False),
        sa.Column('registry_slug',        sa.String(50),  nullable=False),
        sa.Column('external_project_id',  sa.String(200), nullable=True),
        sa.Column('sync_status',          sa.String(30),  server_default='ok', nullable=False),
        sa.Column('last_synced_at',       sa.DateTime(timezone=True), nullable=True),
        sa.Column('registry_data',        JSONB,          server_default='{}', nullable=False),
        sa.Column('discrepancies',        JSONB,          server_default='[]', nullable=False),
        sa.Column('created_at',           sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at',           sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_vv_registry_sync_project', 'vv_registry_sync', ['project_id'])


def downgrade():
    op.drop_index('ix_vv_registry_sync_project', table_name='vv_registry_sync')
    op.drop_table('vv_registry_sync')
