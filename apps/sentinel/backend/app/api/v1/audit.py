from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import paginate
from app.core.security import get_current_user
from app.models import AuditLog

router = APIRouter()

@router.get("/")
def list_audit(event_type: Optional[str] = None, entity_id: Optional[UUID] = None,
               offset: int = 0, limit: int = 100,
               db: Session = Depends(get_db), user=Depends(get_current_user)):
    # F021: return standard envelope {items, total, offset, limit}
    q = db.query(AuditLog)
    # Non-admins can only view audit events they themselves generated
    role = getattr(user, "role", "")
    if role not in ("admin", "super_admin"):
        q = q.filter(AuditLog.actor_id == user.id)
    if event_type: q = q.filter(AuditLog.event_type == event_type)
    if entity_id: q = q.filter(AuditLog.entity_id == entity_id)
    q = q.order_by(AuditLog.created_at.desc())
    total = q.count()
    results = q.offset(offset).limit(limit).all()
    items = [
        {"id": str(r.id), "event_type": r.event_type, "entity_type": r.entity_type,
         "entity_id": str(r.entity_id) if r.entity_id else None,
         "actor_id": str(r.actor_id) if r.actor_id else None,
         "actor_role": r.actor_role, "event_metadata": r.event_metadata,
         "after_state": r.after_state,
         "created_at": r.created_at.isoformat()} for r in results
    ]
    return paginate(items, total=total, offset=offset, limit=limit)
