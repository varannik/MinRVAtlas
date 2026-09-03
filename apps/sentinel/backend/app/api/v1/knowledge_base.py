"""
Knowledge Base API
CRUD for operational knowledge base entries used by the GenAI recommendation engine.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import KnowledgeBaseEntry

router = APIRouter()


def _out(e: KnowledgeBaseEntry):
    return {
        "id":          str(e.id),
        "domain":      e.domain,
        "parameter":   e.parameter,
        "category":    e.category,
        "title":       e.title,
        "description": e.description,
        "action":      e.action,
        "severity":    e.severity,
        "priority":    e.priority,
        "tags":        e.tags or [],
        "source":      e.source,
        "is_active":   e.is_active,
        "created_at":  e.created_at.isoformat() if e.created_at else None,
        "updated_at":  e.updated_at.isoformat() if e.updated_at else None,
    }


@router.get("/")
def list_entries(
    domain: Optional[str] = None,
    parameter: Optional[str] = None,
    category: Optional[str] = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    q = db.query(KnowledgeBaseEntry)
    if domain:     q = q.filter(KnowledgeBaseEntry.domain == domain)
    if parameter:  q = q.filter(KnowledgeBaseEntry.parameter == parameter)
    if category:   q = q.filter(KnowledgeBaseEntry.category == category)
    if active_only: q = q.filter(KnowledgeBaseEntry.is_active == True)
    return [_out(e) for e in q.order_by(KnowledgeBaseEntry.domain, KnowledgeBaseEntry.category).all()]


@router.post("/")
def create_entry(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not data.get("title","").strip():
        raise HTTPException(400, "title is required")
    if not data.get("domain","").strip():
        raise HTTPException(400, "domain is required")
    if not data.get("description","").strip():
        raise HTTPException(400, "description is required")
    entry = KnowledgeBaseEntry(
        domain      = data["domain"].strip(),
        parameter   = data.get("parameter","").strip() or None,
        category    = data.get("category","general").strip(),
        title       = data["title"].strip(),
        description = data["description"].strip(),
        action      = data.get("action","").strip() or None,
        severity    = data.get("severity","medium"),
        priority    = data.get("priority","24h"),
        tags        = data.get("tags",[]),
        source      = data.get("source","").strip() or None,
        is_active   = data.get("is_active", True),
        created_by  = user.id,
    )
    db.add(entry); db.commit(); db.refresh(entry)
    return _out(entry)


@router.patch("/{entry_id}")
def update_entry(entry_id: UUID, data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    entry = db.query(KnowledgeBaseEntry).filter(KnowledgeBaseEntry.id == entry_id).first()
    if not entry: raise HTTPException(404, "Entry not found")
    for field in ["domain","parameter","category","title","description","action","severity","priority","tags","source","is_active"]:
        if field in data:
            val = data[field]
            if field == "parameter" and val == "": val = None
            setattr(entry, field, val)
    db.commit(); db.refresh(entry)
    return _out(entry)


@router.delete("/{entry_id}")
def delete_entry(entry_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    entry = db.query(KnowledgeBaseEntry).filter(KnowledgeBaseEntry.id == entry_id).first()
    if not entry: raise HTTPException(404, "Entry not found")
    db.delete(entry); db.commit()
    return {"deleted": str(entry_id)}


@router.get("/meta/domains")
def list_domains(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return distinct domains + entry counts."""
    from sqlalchemy import func
    rows = db.query(KnowledgeBaseEntry.domain, func.count(KnowledgeBaseEntry.id))\
             .filter(KnowledgeBaseEntry.is_active == True)\
             .group_by(KnowledgeBaseEntry.domain).all()
    return [{"domain": r[0], "count": r[1]} for r in rows]
