"""vv_rfis: Request for Information workflow table

Revision ID: 20260528_0008
Revises: 20260528_0007
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '20260528_0008'
down_revision = '20260528_0007'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'vv_rfis',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', UUID(as_uuid=True), sa.ForeignKey('vv_projects.id'), nullable=False),
        sa.Column('checkpoint_id', sa.String(50), nullable=True),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('body', sa.Text, nullable=False),
        sa.Column('severity', sa.String(20), server_default='medium'),
        sa.Column('status', sa.String(30), server_default='open'),
        sa.Column('raised_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('raised_by_name', sa.String(300)),
        sa.Column('raised_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('assigned_to_name', sa.String(300)),
        sa.Column('response', sa.Text),
        sa.Column('responded_by_name', sa.String(300)),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by_name', sa.String(300)),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index('ix_vv_rfis_project_id', 'vv_rfis', ['project_id'])
    op.create_index('ix_vv_rfis_status', 'vv_rfis', ['status'])


def downgrade():
    op.drop_index('ix_vv_rfis_status', 'vv_rfis')
    op.drop_index('ix_vv_rfis_project_id', 'vv_rfis')
    op.drop_table('vv_rfis')
