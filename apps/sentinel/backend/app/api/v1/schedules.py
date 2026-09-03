"""
Scheduled DQA Runs — CRUD endpoints for managing automated DQA schedules.
Schedules store cron expressions and can be triggered manually via run-now.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import DQARun, DQASchedule, ProjectMember

router = APIRouter()


def _require_project_access(db: Session, project_id, user) -> None:
    """Fix #02: raise 404 if user has no access to the project (avoids confirming existence)."""
    if project_id is None:
        return
    role = getattr(user, "role", "")
    if role in ("admin", "super_admin"):
        return
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user.id,
    ).first()
    if not member:
        raise HTTPException(404, "Project not found")


def _out(s: DQASchedule) -> dict:
    return {
        "id":               str(s.id),
        "project_id":       str(s.project_id)  if s.project_id  else None,
        "dataset_id":       str(s.dataset_id)  if s.dataset_id  else None,
        "name":             s.name,
        "cron_expression":  s.cron_expression,
        "timezone":         s.timezone or "UTC",
        "is_active":        s.is_active,
        "notify_email":     s.notify_email,
        "last_run_at":      s.last_run_at.isoformat()  if s.last_run_at  else None,
        "next_run_at":      s.next_run_at.isoformat()  if s.next_run_at  else None,
        "last_run_status":  s.last_run_status,
        "run_count":        s.run_count or 0,
        "created_at":       s.created_at.isoformat()   if s.created_at   else None,
        # Pipeline fields
        "source_type":               getattr(s, "source_type",               "manual"),
        "source_config":             getattr(s, "source_config",             None),
        "auto_correct_enabled":      getattr(s, "auto_correct_enabled",      False),
        "correction_confidence_pct": getattr(s, "correction_confidence_pct", 80),
        "output_folder_suffix":      getattr(s, "output_folder_suffix",      "corrected"),
        "gate_fail_emails":          getattr(s, "gate_fail_emails",          None),
        "last_pipeline_result":      getattr(s, "last_pipeline_result",      None),
        # Multi-project
        "schedule_type":             getattr(s, "schedule_type",             "dqa"),
        "project_configs":           getattr(s, "project_configs",           None),
        "anomaly_confidence_pct":    getattr(s, "anomaly_confidence_pct",    70),
        "min_anomaly_count":         getattr(s, "min_anomaly_count",         1),
    }


@router.get("/")
def list_schedules(project_id: Optional[UUID] = None, offset: int = 0, limit: int = 100,
                   db: Session = Depends(get_db), user=Depends(get_current_user)):
    # F021: return standard envelope {items, total, offset, limit}
    from app.core.pagination import paginate
    q = db.query(DQASchedule)
    role = getattr(user, "role", "")
    if project_id:
        # Fix: verify the caller has access to the specified project before listing its schedules
        _require_project_access(db, project_id, user)
        q = q.filter(DQASchedule.project_id == project_id)
    elif role not in ("admin", "super_admin"):
        # Fix: non-admins listing all schedules get only their member-project schedules
        member_project_ids = db.query(ProjectMember.project_id).filter(
            ProjectMember.user_id == user.id
        )
        q = q.filter(DQASchedule.project_id.in_(member_project_ids))
    q = q.order_by(DQASchedule.created_at.desc())
    total = q.count()
    items = [_out(s) for s in q.offset(offset).limit(limit).all()]
    return paginate(items, total=total, offset=offset, limit=limit)


@router.post("/")
def create_schedule(data: dict,
                    db: Session = Depends(get_db), user=Depends(get_current_user)):
    _require_project_access(db, data.get("project_id"), user)
    s = DQASchedule(
        project_id=data.get("project_id"),
        dataset_id=data.get("dataset_id"),
        name=data["name"],
        cron_expression=data.get("cron_expression", "0 6 * * *"),
        timezone=data.get("timezone", "UTC"),
        notify_email=data.get("notify_email"),
        is_active=True,
        created_by=user.id,
    )
    # Pipeline fields
    for field in ["source_type", "source_config", "auto_correct_enabled",
                  "correction_confidence_pct", "output_folder_suffix", "gate_fail_emails"]:
        if field in data:
            try: setattr(s, field, data[field])
            except Exception: pass
    db.add(s)
    db.commit()
    db.refresh(s)
    return _out(s)


@router.patch("/{schedule_id}")
def update_schedule(schedule_id: UUID, data: dict,
                    db: Session = Depends(get_db), user=Depends(get_current_user)):
    s = db.query(DQASchedule).filter(DQASchedule.id == schedule_id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    _require_project_access(db, s.project_id, user)
    for field in ["name", "cron_expression", "timezone", "notify_email", "is_active",
                  "dataset_id", "source_type", "source_config", "auto_correct_enabled",
                  "correction_confidence_pct", "output_folder_suffix", "gate_fail_emails",
                  "schedule_type", "project_configs", "anomaly_confidence_pct", "min_anomaly_count"]:
        if field in data:
            try: setattr(s, field, data[field])
            except Exception: pass
    db.commit()
    db.refresh(s)
    return _out(s)


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: UUID,
                    db: Session = Depends(get_db), user=Depends(get_current_user)):
    s = db.query(DQASchedule).filter(DQASchedule.id == schedule_id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    _require_project_access(db, s.project_id, user)
    db.delete(s)
    db.commit()
    return {"deleted": str(schedule_id)}


@router.post("/{schedule_id}/run-now")
def run_schedule_now(schedule_id: UUID, background_tasks: BackgroundTasks,
                     db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Immediately trigger a run for this schedule.
    Uses the full pipeline (detection + correction + output) when a source
    is configured, otherwise falls back to a simple DQA-only run.
    """
    s = db.query(DQASchedule).filter(DQASchedule.id == schedule_id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    _require_project_access(db, s.project_id, user)

    source_type = getattr(s, "source_type", "manual") or "manual"

    project_configs = getattr(s, "project_configs", None)
    schedule_type   = getattr(s, "schedule_type", "dqa") or "dqa"

    if project_configs or source_type != "manual" or schedule_type in ("anomaly", "both"):
        # Multi-project or anomaly pipeline
        import asyncio
        from app.engines.pipeline.schedule_pipeline import run_multi_project_pipeline

        async def _pipeline_wrapper():
            await run_multi_project_pipeline(str(s.id))

        def _run_pipeline():
            asyncio.run(_pipeline_wrapper())

        s.last_run_status = "running"
        db.commit()
        background_tasks.add_task(_run_pipeline)
        return {
            "message":       "Pipeline triggered",
            "schedule_id":   str(s.id),
            "schedule_type": schedule_type,
            "projects":      len(project_configs or []),
            "mode":          "multi_project_pipeline",
        }

    # Manual mode — simple DQA run against configured dataset
    from app.api.v1.runs import _execute_dqa
    if not s.dataset_id:
        raise HTTPException(400, "Schedule has no dataset configured — edit the schedule and select a dataset")

    run = DQARun(
        dataset_id=s.dataset_id,
        project_id=s.project_id,
        triggered_by=user.id,
        status="queued",
    )
    db.add(run)
    db.flush()
    s.last_run_at     = datetime.utcnow()
    s.run_count       = (s.run_count or 0) + 1
    s.last_run_status = "queued"
    db.commit()
    db.refresh(run)

    background_tasks.add_task(_execute_dqa, str(run.id))
    return {"message": "DQA run triggered", "run_id": str(run.id), "mode": "dqa_only"}
