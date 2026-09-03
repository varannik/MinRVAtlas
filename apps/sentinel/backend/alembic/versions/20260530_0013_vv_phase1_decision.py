"""Phase 1 — Decision backbone: finding_severity, CARs, formal decision

Revision ID: 20260530_0013
Revises: 20260530_0012
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260530_0013'
down_revision = '20260530_0012'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add finding_severity to vv_checkpoints
    op.add_column(
        'vv_checkpoints',
        sa.Column('finding_severity', sa.String(20), nullable=True, server_default='none'),
    )

    # 2. Create vv_cars
    op.create_table(
        'vv_cars',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vv_projects.id'), nullable=False),
        sa.Column('checkpoint_code', sa.String(50), nullable=True),
        sa.Column('car_number', sa.String(20), nullable=False),
        sa.Column('severity', sa.String(20), nullable=False),
        sa.Column('title', sa.String(300), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('status', sa.String(30), nullable=False, server_default='open'),
        sa.Column('raised_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('raised_by_name', sa.String(300), nullable=True),
        sa.Column('raised_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('response', sa.Text(), nullable=True),
        sa.Column('responded_by_name', sa.String(300), nullable=True),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_by_name', sa.String(300), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closure_note', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_vv_cars_project_id', 'vv_cars', ['project_id'])

    # 3. Create vv_decisions
    op.create_table(
        'vv_decisions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('vv_projects.id'), nullable=False),
        sa.Column('decision', sa.String(30), nullable=False),
        sa.Column('findings_summary', sa.Text(), nullable=True),
        sa.Column('conditions', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('open_cars_at_decision', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('decided_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('decided_by_name', sa.String(300), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('superseded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_vv_decisions_project_id', 'vv_decisions', ['project_id'])


def downgrade():
    op.drop_index('ix_vv_decisions_project_id', table_name='vv_decisions')
    op.drop_table('vv_decisions')
    op.drop_index('ix_vv_cars_project_id', table_name='vv_cars')
    op.drop_table('vv_cars')
    op.drop_column('vv_checkpoints', 'finding_severity')
