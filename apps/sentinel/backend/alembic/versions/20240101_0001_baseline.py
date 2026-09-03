"""Baseline — marks existing startup.py schema as managed by Alembic.

Revision ID: 0001_baseline
Revises:
Create Date: 2024-01-01 00:00:00.000000 UTC

This migration is intentionally empty (no-op upgrade/downgrade).

All tables were previously created by app/core/startup.py via idempotent
CREATE TABLE IF NOT EXISTS statements.  Adding Alembic now means:

  1. Run `alembic stamp 0001_baseline` once on existing deployments to record
     this revision in the alembic_version table without re-running DDL.
  2. Future schema changes go in new revisions — startup.py retains the
     safety-net CREATE TABLE IF NOT EXISTS calls for cold starts.

Tables covered by this baseline (created by startup.py):
  users, password_reset_tokens, mfa_backup_codes, revoked_tokens,
  projects, datasets, dqa_runs, dqa_violations, violation_comments,
  violation_credit_impacts, dqa_rules, dqa_schedules, audit_log,
  correction_rules, correction_suggestions, api_keys, notifications,
  user_notification_preferences, knowledge_base_entries, anomaly_thresholds,
  anomaly_runs, ml_feedback, ml_models, schedules, webhooks,
  submission_windows, submission_packages, calibration_entries,
  retention_policies, vv_registries, vv_protocols, vv_checkpoints,
  vv_documents, vv_reports, vv_document_comments, vv_audit_log,
  vv_requirements, protocol_update_log
"""
from typing import Sequence, Union

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Intentional no-op — tables already exist from startup.py migrations.
    # New revisions added after this baseline will contain real DDL.
    pass


def downgrade() -> None:
    # Dropping the full schema is a manual DBA operation, not automated here.
    pass
