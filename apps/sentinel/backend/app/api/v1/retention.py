"""
Data Retention Policy — configure auto-archival of old runs and violations.
GET  /api/v1/retention/{project_id}         — get current policy
PUT  /api/v1/retention/{project_id}         — update policy
POST /api/v1/retention/{project_id}/apply   — apply retention (archive old data)
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.models import RetentionPolicy

router = APIRouter()


def _policy_out(p: RetentionPolicy) -> dict:
    return {
        "id":                     str(p.id),
        "project_id":             str(p.project_id),
        "run_retention_days":     p.run_retention_days,
        "violation_retention_days": p.violation_retention_days,
        "auto_archive_enabled":   p.auto_archive_enabled,
        "updated_at":             p.updated_at.isoformat() if p.updated_at else None,
    }


@router.get("/{project_id}")
def get_policy(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    pol = db.query(RetentionPolicy).filter(RetentionPolicy.project_id == project_id).first()
    if not pol:
        # Return default policy
        return {
            "id": None,
            "project_id": str(project_id),
            "run_retention_days":     730,   # 2 years
            "violation_retention_days": 1825, # 5 years
            "auto_archive_enabled":   False,
            "updated_at": None,
        }
    return _policy_out(pol)


@router.put("/{project_id}")
def update_policy(
    project_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin", "analyst")),
):
    pol = db.query(RetentionPolicy).filter(RetentionPolicy.project_id == project_id).first()
    if not pol:
        pol = RetentionPolicy(project_id=project_id, created_by=user.id)
        db.add(pol)
    for field in ("run_retention_days", "violation_retention_days", "auto_archive_enabled"):
        if field in data:
            setattr(pol, field, data[field])
    pol.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(pol)
    return _policy_out(pol)


@router.post("/{project_id}/apply")
def apply_retention(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin")),
):
    """
    Archive runs and violations older than the configured retention period.
    'Archive' means setting status='archived' (soft delete).
    """
    pol = db.query(RetentionPolicy).filter(RetentionPolicy.project_id == project_id).first()
    run_days  = pol.run_retention_days if pol else 730
    viol_days = pol.violation_retention_days if pol else 1825

    now = datetime.now(timezone.utc)
    run_cutoff  = now - timedelta(days=run_days)
    viol_cutoff = now - timedelta(days=viol_days)

    from sqlalchemy import text
    try:
        # Archive old runs (we set status = 'archived')
        result_runs = db.execute(
            text("""
                UPDATE dqa_runs SET status = 'archived'
                WHERE project_id = :pid
                  AND triggered_at < :cutoff
                  AND status = 'completed'
            """),
            {"pid": str(project_id), "cutoff": run_cutoff},
        )
        archived_runs = result_runs.rowcount

        # Archive old violations
        result_viols = db.execute(
            text("""
                UPDATE dqa_violations SET status = 'archived'
                WHERE dataset_id IN (
                    SELECT id FROM datasets WHERE project_id = :pid
                )
                AND created_at < :cutoff
                AND status = 'resolved'
            """),
            {"pid": str(project_id), "cutoff": viol_cutoff},
        )
        archived_violations = result_viols.rowcount
        db.commit()

        return {
            "ok": True,
            "archived_runs":       archived_runs,
            "archived_violations": archived_violations,
            "run_cutoff":          run_cutoff.isoformat(),
            "viol_cutoff":         viol_cutoff.isoformat(),
        }
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, f"Retention apply failed: {str(exc)}")
