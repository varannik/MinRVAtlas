"""
API Key Management — create / list / revoke named API keys for ingest webhooks.
Keys are stored as HMAC-SHA256 (pepper = settings.SECRET_KEY); only the prefix
is stored for display. Rotating SECRET_KEY invalidates all existing keys.
"""
import hashlib
import hmac
import secrets
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models import ApiKey

router = APIRouter()


def _hash_key(raw_key: str) -> str:
    # Fix #05: HMAC-SHA256 with server-side pepper prevents GPU rainbow-table
    # attacks on the stored hashes even if the DB is exfiltrated.
    # NOTE: changing SECRET_KEY invalidates all existing keys — rotate them.
    return hmac.new(
        settings.SECRET_KEY.encode(),
        raw_key.encode(),
        hashlib.sha256,
    ).hexdigest()


def _out(k: ApiKey, show_full: bool = False, raw_key: str = "") -> dict:
    return {
        "id": str(k.id),
        "name": k.name,
        "prefix": k.key_prefix,
        "project_id": str(k.project_id) if k.project_id else None,
        "is_active": k.is_active,
        "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
        "created_at": k.created_at.isoformat() if k.created_at else None,
        **({"key": raw_key} if show_full else {}),
    }


@router.get("/")
def list_api_keys(project_id: Optional[UUID] = None, offset: int = 0, limit: int = 100,
                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    # F021: return standard envelope {items, total, offset, limit}
    from app.core.pagination import paginate
    q = db.query(ApiKey).filter(ApiKey.is_active == True)
    # Fix: non-admins may only see their own keys (prevents cross-tenant key enumeration)
    role = getattr(user, "role", "")
    if role not in ("admin", "super_admin"):
        q = q.filter(ApiKey.created_by == user.id)
    if project_id:
        q = q.filter(ApiKey.project_id == project_id)
    q = q.order_by(ApiKey.created_at.desc())
    total = q.count()
    items = [_out(k) for k in q.offset(offset).limit(limit).all()]
    return paginate(items, total=total, offset=offset, limit=limit)


@router.post("/")
def create_api_key(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Generate a new API key. The full key is returned only once — store it securely."""
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(400, "name is required")

    # Generate a secure random key: ds_ prefix + 32 random hex chars
    raw_key = "ds_" + secrets.token_hex(24)
    prefix = raw_key[:12]  # "ds_" + 9 chars

    k = ApiKey(
        name=name,
        key_prefix=prefix,
        key_hash=_hash_key(raw_key),
        project_id=data.get("project_id"),
        created_by=user.id,
        is_active=True,
    )
    db.add(k)
    db.commit()
    db.refresh(k)
    return _out(k, show_full=True, raw_key=raw_key)


@router.delete("/{key_id}")
def revoke_api_key(key_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    # Fix #01: filter by owner so users cannot revoke other users' keys.
    # Admins may revoke any key; regular users only their own.
    role = getattr(user, "role", "")
    q = db.query(ApiKey).filter(ApiKey.id == key_id)
    if role not in ("admin", "super_admin"):
        q = q.filter(ApiKey.created_by == user.id)
    k = q.first()
    if not k:
        # Return 404 regardless — don't confirm existence of other users' keys
        raise HTTPException(404, "Key not found")
    k.is_active = False
    db.commit()
    return {"revoked": str(key_id)}


# ── Auth helper used by ingest router ────────────────────────────────────────
def verify_api_key(raw_key: str, db: Session) -> Optional[ApiKey]:
    """Verify an API key from the Authorization header. Returns the key record or None."""
    from datetime import datetime
    key_hash = _hash_key(raw_key)
    k = db.query(ApiKey).filter(ApiKey.key_hash == key_hash, ApiKey.is_active == True).first()
    if k:
        k.last_used_at = datetime.utcnow()
        try:
            db.commit()
        except Exception:
            pass
    return k
