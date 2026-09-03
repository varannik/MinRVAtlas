"""Phase 6 — registry submission framework: vv_registry_submissions table

Revision ID: 20260530_0016
Revises: 20260530_0015
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260530_0016'
down_revision = '20260530_0015'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'vv_registry_submissions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vv_projects.id'), nullable=False),
        sa.Column('decision_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vv_decisions.id'), nullable=True),
        sa.Column('submission_number', sa.String(30), nullable=False),
        sa.Column('registry_slug', sa.String(50), nullable=False),
        sa.Column('status', sa.String(30), nullable=False, server_default='draft'),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('submitted_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('submitted_by_name', sa.String(300), nullable=True),
        sa.Column('registry_ref_number', sa.String(100), nullable=True),
        sa.Column('registry_response', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('estimated_review_days', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_vv_registry_submissions_project_id', 'vv_registry_submissions', ['project_id'])


def downgrade():
    op.drop_index('ix_vv_registry_submissions_project_id', table_name='vv_registry_submissions')
    op.drop_table('vv_registry_submissions')
