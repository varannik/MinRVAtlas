from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.cache import cache_bust, ttl_cache
from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Dataset, DQARun, Project, ProjectMember
from app.schemas import ProjectCreate, ProjectOut

router = APIRouter()

@router.get("/", response_model=List[ProjectOut])
def list_projects(include_archived: bool = False, db: Session = Depends(get_db), user=Depends(get_current_user)):
    role = getattr(user, "role", "")
    if role in ("admin", "super_admin"):
        # F033: cache admin project list for 30 seconds (busted on create/update/delete)
        cache_key = f"projects:{'all' if include_archived else 'active'}"
        cached = ttl_cache.get(cache_key)
        if cached is not None:
            return cached
        q = db.query(Project)
        if not include_archived:
            q = q.filter(Project.is_active == True)
        result = q.order_by(Project.created_at.desc()).all()
        # CR-005: serialize ORM objects before caching — raw ORM instances cause
        # DetachedInstanceError when the DB session is closed and the cache is hit
        serialized = [ProjectOut.model_validate(p).model_dump(mode="json") for p in result]
        ttl_cache.set(cache_key, serialized, ttl=30)
        return serialized
    else:
        # Non-admins: return only projects they are a member of (no cache — user-specific)
        q = (
            db.query(Project)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .filter(ProjectMember.user_id == user.id)
        )
        if not include_archived:
            q = q.filter(Project.is_active == True)
        result = q.order_by(Project.created_at.desc()).all()
        return [ProjectOut.model_validate(p).model_dump(mode="json") for p in result]

@router.post("/", response_model=ProjectOut)
def create_project(data: ProjectCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    project = Project(**data.model_dump(), created_by=user.id)
    db.add(project); db.commit(); db.refresh(project)
    cache_bust("projects:active", "projects:all")   # F033: invalidate on write
    return project

@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    return p

@router.get("/{project_id}/summary")
def project_summary(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project: raise HTTPException(404, "Project not found")
    total_datasets = db.query(Dataset).filter(Dataset.project_id == project_id).count()
    runs = db.query(DQARun).filter(DQARun.project_id == project_id).order_by(DQARun.triggered_at.desc()).limit(5).all()
    latest_run = runs[0] if runs else None
    return {
        "project_id": str(project_id),
        "name": project.name,
        "total_datasets": total_datasets,
        "latest_readiness_score": latest_run.readiness_score if latest_run else None,
        "latest_run_status": latest_run.status if latest_run else None,
        "datasets_count": total_datasets,
        "recent_runs": [{"id": str(r.id), "status": r.status, "readiness_score": r.readiness_score,
                          "triggered_at": r.triggered_at.isoformat(), "total_violations": r.total_violations,
                          "gate_passed": r.gate_passed, "rules_executed": r.rules_executed or 0,
                          "data_coverage": r.data_coverage,
                          "dimension_scores": r.dimension_scores or {}} for r in runs]
    }

@router.patch("/{project_id}")
def update_project(project_id: UUID, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    for field in ["name", "description", "domain"]:
        if field in data: setattr(p, field, data[field])
    if "config" in data:
        # F030: config must be a dict, not an arbitrary JSON blob
        if not isinstance(data["config"], dict):
            raise HTTPException(400, "config must be a JSON object (dict)")
        # Only permit known top-level keys to prevent injection of unexpected data
        allowed_config_keys = {"gate_threshold", "rules", "notify_emails", "dimension_weights", "tags", "readiness_alert_threshold", "digest_enabled", "digest_email"}
        unknown = set(data["config"].keys()) - allowed_config_keys
        if unknown:
            raise HTTPException(400, f"Unknown config keys: {unknown}. Allowed: {allowed_config_keys}")
        p.config = data["config"]
    db.commit(); db.refresh(p)
    return {"id": str(p.id), "name": p.name, "description": p.description,
            "domain": p.domain, "config": p.config, "is_active": p.is_active,
            "created_at": p.created_at.isoformat() if p.created_at else None}

@router.delete("/{project_id}")
def archive_project(project_id: UUID, hard: bool = False, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    if hard:
        # F012: hard delete is admin-only — prevents data loss by regular users
        if user.role not in ("admin", "super_admin"):
            raise HTTPException(403, "Only admins can permanently delete projects")
        db.delete(p); db.commit()
        cache_bust("projects:active", "projects:all")
        return {"message": "Project permanently deleted"}
    p.is_active = False; db.commit()
    cache_bust("projects:active", "projects:all")
    return {"message": "Project archived"}

@router.post("/{project_id}/restore")
def restore_project(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: raise HTTPException(404, "Project not found")
    p.is_active = True; db.commit()
    cache_bust("projects:active", "projects:all")  # CR-009: bust cache so restored project appears immediately
    return {"message": "Project restored"}


