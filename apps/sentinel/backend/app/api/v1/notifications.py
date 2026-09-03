"""
Notification endpoints — in-app event notifications for operators.
"""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Notification

router = APIRouter()


def _out(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "title": n.title,
        "message": n.message,
        "event_type": n.event_type,
        "entity_id": str(n.entity_id) if n.entity_id else None,
        "entity_type": n.entity_type,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("/")
def list_notifications(limit: int = 30, unread_only: bool = False,
                        db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(Notification).filter(
        (Notification.user_id == user.id) | (Notification.user_id.is_(None))
    )
    if unread_only:
        q = q.filter(Notification.is_read == False)
    items = q.order_by(Notification.created_at.desc()).limit(limit).all()
    unread_count = db.query(Notification).filter(
        ((Notification.user_id == user.id) | (Notification.user_id.is_(None))),
        Notification.is_read == False
    ).count()
    return {"notifications": [_out(n) for n in items], "unread_count": unread_count}


@router.patch("/{notification_id}/read")
def mark_read(notification_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    n = db.query(Notification).filter(Notification.id == notification_id).first()
    if n:
        n.is_read = True
        db.commit()
    return {"ok": True}


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db), user=Depends(get_current_user)):
    db.query(Notification).filter(
        (Notification.user_id == user.id) | (Notification.user_id.is_(None)),
        Notification.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.delete("/clear-all")
def clear_all_notifications(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Permanently delete all notifications for the current user."""
    deleted = db.query(Notification).filter(
        (Notification.user_id == user.id) | (Notification.user_id.is_(None))
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": deleted}


# ── Helper called from other modules ─────────────────────────────────────────
def create_notification(db: Session, title: str, message: str, event_type: str,
                         entity_id=None, entity_type: str = "", user_id=None):
    """Create a notification record. Call from run completion hooks etc."""
    try:
        n = Notification(
            user_id=user_id,
            title=title,
            message=message,
            event_type=event_type,
            entity_id=entity_id,
            entity_type=entity_type,
            is_read=False,
        )
        db.add(n)
        db.commit()
    except Exception:
        pass  # notifications are non-critical — never let them crash the caller
