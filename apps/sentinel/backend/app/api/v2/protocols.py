"""
Protocol Registry API — v2
Living Protocol Registry: full CRUD, checkpoint management,
PDF AI ingestion, web monitor trigger, and update-log approval workflow.
"""
import datetime
import logging
import uuid
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import (
    VVCheckpointDef,
    VVProtocol,
    VVProtocolUpdateLog,
    VVRegistry,
)

router = APIRouter()
logger = logging.getLogger("datasentinel.protocols")


# ─────────────────────────────── helpers ────────────────────────────────────

def _require_admin(user):
    if user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Admin role required")


def _registry_out(reg: VVRegistry, db: Session) -> dict:
    protocol_count = db.query(func.count(VVProtocol.id)).filter(
        VVProtocol.registry_id == reg.id, VVProtocol.status == "active"
    ).scalar() or 0
    return {
        "id": str(reg.id),
        "name": reg.name,
        "slug": reg.slug,
        "logo_emoji": reg.logo_emoji,
        "description": reg.description,
        "website_url": reg.website_url,
        "protocol_count": protocol_count,
        "created_at": reg.created_at.isoformat() if reg.created_at else None,
    }


def _protocol_out(proto: VVProtocol, db: Session, include_checkpoints: bool = False) -> dict:
    cp_count = db.query(func.count(VVCheckpointDef.id)).filter(
        VVCheckpointDef.protocol_id == proto.id,
        VVCheckpointDef.deprecated_in_version.is_(None)
    ).scalar() or 0
    critical_count = db.query(func.count(VVCheckpointDef.id)).filter(
        VVCheckpointDef.protocol_id == proto.id,
        VVCheckpointDef.critical == True,
        VVCheckpointDef.deprecated_in_version.is_(None)
    ).scalar() or 0
    pending_updates = db.query(func.count(VVProtocolUpdateLog.id)).filter(
        VVProtocolUpdateLog.protocol_id == proto.id,
        VVProtocolUpdateLog.status == "pending"
    ).scalar() or 0

    out = {
        "id": str(proto.id),
        "registry_id": str(proto.registry_id),
        "code": proto.code,
        "name": proto.name,
        "description": proto.description,
        "version": proto.version,
        "status": proto.status,
        "source_url": proto.source_url,
        "checkpoint_count": cp_count,
        "critical_checkpoint_count": critical_count,
        "pending_updates": pending_updates,
        "last_verified_at": proto.last_verified_at.isoformat() if proto.last_verified_at else None,
        "verified_by": proto.verified_by,
        "created_at": proto.created_at.isoformat() if proto.created_at else None,
        "updated_at": proto.updated_at.isoformat() if proto.updated_at else None,
    }
    if include_checkpoints:
        checkpoints = db.query(VVCheckpointDef).filter(
            VVCheckpointDef.protocol_id == proto.id,
            VVCheckpointDef.deprecated_in_version.is_(None)
        ).order_by(VVCheckpointDef.sort_order).all()
        out["checkpoints"] = [_checkpoint_out(cp) for cp in checkpoints]
    return out


def _checkpoint_out(cp: VVCheckpointDef) -> dict:
    return {
        "id": str(cp.id),
        "protocol_id": str(cp.protocol_id),
        "checkpoint_id": cp.checkpoint_id,
        "category": cp.category,
        "name": cp.name,
        "requirement": cp.requirement,
        "critical": cp.critical,
        "document_types": cp.document_types,
        "evidence_types": cp.evidence_types,
        "sort_order": cp.sort_order,
        "added_in_version": cp.added_in_version,
        "deprecated_in_version": cp.deprecated_in_version,
    }


def _log_out(entry: VVProtocolUpdateLog) -> dict:
    return {
        "id": str(entry.id),
        "protocol_id": str(entry.protocol_id),
        "proposed_by": entry.proposed_by,
        "change_type": entry.change_type,
        "checkpoint_id_affected": entry.checkpoint_id_affected,
        "old_value": entry.old_value,
        "new_value": entry.new_value,
        "status": entry.status,
        "reviewed_by": entry.reviewed_by,
        "reviewed_at": entry.reviewed_at.isoformat() if entry.reviewed_at else None,
        "notes": entry.notes,
        "source": entry.source,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


# ─────────────────────────── Registry endpoints ──────────────────────────────

@router.get("/registries")
def list_registries(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """List all registries with protocol counts."""
    registries = db.query(VVRegistry).order_by(VVRegistry.name).all()
    return [_registry_out(r, db) for r in registries]


@router.get("/registries/{registry_id}")
def get_registry(registry_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    reg = db.query(VVRegistry).filter(VVRegistry.id == uuid.UUID(registry_id)).first()
    if not reg:
        raise HTTPException(404, "Registry not found")
    return _registry_out(reg, db)


# ─────────────────────────── Protocol endpoints ──────────────────────────────

@router.get("/protocols")
def list_protocols(
    registry_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="active | deprecated | draft"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """List protocols, optionally filtered by registry or status."""
    q = db.query(VVProtocol)
    if registry_id:
        q = q.filter(VVProtocol.registry_id == uuid.UUID(registry_id))
    if status:
        q = q.filter(VVProtocol.status == status)
    else:
        q = q.filter(VVProtocol.status != "deprecated")
    protocols = q.order_by(VVProtocol.registry_id, VVProtocol.code).all()
    return [_protocol_out(p, db) for p in protocols]


@router.get("/protocols/{protocol_id}")
def get_protocol(
    protocol_id: str,
    include_checkpoints: bool = Query(True),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Get a single protocol with optional checkpoints."""
    proto = db.query(VVProtocol).filter(VVProtocol.id == uuid.UUID(protocol_id)).first()
    if not proto:
        raise HTTPException(404, "Protocol not found")
    return _protocol_out(proto, db, include_checkpoints=include_checkpoints)


class ProtocolCreate(BaseModel):
    registry_id: str
    code: str
    name: str
    description: Optional[str] = None
    version: str = "1.0"
    source_url: Optional[str] = None


@router.post("/protocols", status_code=201)
def create_protocol(
    payload: ProtocolCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Create a new protocol (admin only)."""
    _require_admin(user)
    proto = VVProtocol(
        id=uuid.uuid4(),
        registry_id=uuid.UUID(payload.registry_id),
        code=payload.code,
        name=payload.name,
        description=payload.description,
        version=payload.version,
        status="draft",
        source_url=payload.source_url,
    )
    db.add(proto)
    db.commit()
    db.refresh(proto)
    return _protocol_out(proto, db)


class ProtocolUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    source_url: Optional[str] = None
    status: Optional[str] = None


@router.patch("/protocols/{protocol_id}")
def update_protocol(
    protocol_id: str,
    payload: ProtocolUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Update protocol metadata (admin only)."""
    _require_admin(user)
    proto = db.query(VVProtocol).filter(VVProtocol.id == uuid.UUID(protocol_id)).first()
    if not proto:
        raise HTTPException(404, "Protocol not found")
    for field, val in payload.model_dump(exclude_none=True).items():
        setattr(proto, field, val)
    proto.updated_at = datetime.datetime.utcnow()
    db.commit()
    return _protocol_out(proto, db)


@router.post("/protocols/{protocol_id}/publish-version")
def publish_version(
    protocol_id: str,
    new_version: str = Query(..., description="New version string e.g. '2.1'"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Bump protocol version — marks all pending updates as applied."""
    _require_admin(user)
    proto = db.query(VVProtocol).filter(VVProtocol.id == uuid.UUID(protocol_id)).first()
    if not proto:
        raise HTTPException(404, "Protocol not found")

    old_version = proto.version
    proto.version = new_version
    proto.updated_at = datetime.datetime.utcnow()
    proto.last_verified_at = datetime.datetime.utcnow()
    proto.verified_by = user.email

    # Log the version bump
    log_entry = VVProtocolUpdateLog(
        id=uuid.uuid4(),
        protocol_id=proto.id,
        proposed_by=user.email,
        change_type="version_bump",
        old_value={"version": old_version},
        new_value={"version": new_version},
        status="approved",
        reviewed_by=user.email,
        reviewed_at=datetime.datetime.utcnow(),
        notes=f"Version bumped from {old_version} to {new_version}",
        source="admin_action",
    )
    db.add(log_entry)
    db.commit()
    return {"protocol_id": protocol_id, "old_version": old_version, "new_version": new_version}


# ─────────────────────────── Checkpoint endpoints ────────────────────────────

@router.get("/protocols/{protocol_id}/checkpoints")
def list_checkpoints(
    protocol_id: str,
    include_deprecated: bool = Query(False),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """List checkpoints for a protocol."""
    q = db.query(VVCheckpointDef).filter(VVCheckpointDef.protocol_id == uuid.UUID(protocol_id))
    if not include_deprecated:
        q = q.filter(VVCheckpointDef.deprecated_in_version.is_(None))
    checkpoints = q.order_by(VVCheckpointDef.sort_order).all()
    return [_checkpoint_out(cp) for cp in checkpoints]


class CheckpointCreate(BaseModel):
    checkpoint_id: str
    category: str
    name: str
    requirement: str
    critical: bool = True
    evidence_types: Optional[list] = None
    document_types: Optional[list] = None
    sort_order: int = 0


@router.post("/protocols/{protocol_id}/checkpoints", status_code=201)
def add_checkpoint(
    protocol_id: str,
    payload: CheckpointCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Add a new checkpoint to a protocol (admin only)."""
    _require_admin(user)
    proto = db.query(VVProtocol).filter(VVProtocol.id == uuid.UUID(protocol_id)).first()
    if not proto:
        raise HTTPException(404, "Protocol not found")

    cp = VVCheckpointDef(
        id=uuid.uuid4(),
        protocol_id=proto.id,
        checkpoint_id=payload.checkpoint_id,
        category=payload.category,
        name=payload.name,
        requirement=payload.requirement,
        critical=payload.critical,
        evidence_types=payload.evidence_types,
        document_types=payload.document_types,
        sort_order=payload.sort_order,
        added_in_version=proto.version,
    )
    db.add(cp)

    # Log the addition
    log_entry = VVProtocolUpdateLog(
        id=uuid.uuid4(),
        protocol_id=proto.id,
        proposed_by=user.email,
        change_type="add_checkpoint",
        checkpoint_id_affected=payload.checkpoint_id,
        old_value=None,
        new_value=payload.model_dump(),
        status="approved",
        reviewed_by=user.email,
        reviewed_at=datetime.datetime.utcnow(),
        source="admin_action",
    )
    db.add(log_entry)
    db.commit()
    db.refresh(cp)
    return _checkpoint_out(cp)


class CheckpointUpdate(BaseModel):
    name: Optional[str] = None
    requirement: Optional[str] = None
    critical: Optional[bool] = None
    category: Optional[str] = None
    evidence_types: Optional[list] = None


@router.patch("/protocols/{protocol_id}/checkpoints/{checkpoint_id}")
def update_checkpoint(
    protocol_id: str,
    checkpoint_id: str,
    payload: CheckpointUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Update checkpoint definition (admin only). Creates audit log entry."""
    _require_admin(user)
    cp = db.query(VVCheckpointDef).filter(
        VVCheckpointDef.id == uuid.UUID(checkpoint_id),
        VVCheckpointDef.protocol_id == uuid.UUID(protocol_id)
    ).first()
    if not cp:
        raise HTTPException(404, "Checkpoint not found")

    old_val = _checkpoint_out(cp)
    for field, val in payload.model_dump(exclude_none=True).items():
        setattr(cp, field, val)
    cp.updated_at = datetime.datetime.utcnow()

    log_entry = VVProtocolUpdateLog(
        id=uuid.uuid4(),
        protocol_id=cp.protocol_id,
        proposed_by=user.email,
        change_type="update_checkpoint",
        checkpoint_id_affected=cp.checkpoint_id,
        old_value=old_val,
        new_value=payload.model_dump(exclude_none=True),
        status="approved",
        reviewed_by=user.email,
        reviewed_at=datetime.datetime.utcnow(),
        source="admin_action",
    )
    db.add(log_entry)
    db.commit()
    return _checkpoint_out(cp)


@router.delete("/protocols/{protocol_id}/checkpoints/{checkpoint_id}")
def deprecate_checkpoint(
    protocol_id: str,
    checkpoint_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Deprecate (soft-delete) a checkpoint (admin only)."""
    _require_admin(user)
    cp = db.query(VVCheckpointDef).filter(
        VVCheckpointDef.id == uuid.UUID(checkpoint_id),
        VVCheckpointDef.protocol_id == uuid.UUID(protocol_id)
    ).first()
    if not cp:
        raise HTTPException(404, "Checkpoint not found")

    proto = db.query(VVProtocol).filter(VVProtocol.id == cp.protocol_id).first()
    cp.deprecated_in_version = proto.version if proto else "deprecated"

    log_entry = VVProtocolUpdateLog(
        id=uuid.uuid4(),
        protocol_id=cp.protocol_id,
        proposed_by=user.email,
        change_type="remove_checkpoint",
        checkpoint_id_affected=cp.checkpoint_id,
        old_value=_checkpoint_out(cp),
        new_value=None,
        status="approved",
        reviewed_by=user.email,
        reviewed_at=datetime.datetime.utcnow(),
        source="admin_action",
    )
    db.add(log_entry)
    db.commit()
    return {"status": "deprecated", "checkpoint_id": cp.checkpoint_id}


# ─────────────────────── AI PDF Ingestion endpoint ───────────────────────────

@router.post("/protocols/{protocol_id}/ingest-pdf")
async def ingest_pdf(
    protocol_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """
    Upload a protocol PDF and AI-extract checkpoint changes.
    Creates pending proposals in the update log for admin review.
    Admin only.
    """
    _require_admin(user)
    proto = db.query(VVProtocol).filter(VVProtocol.id == uuid.UUID(protocol_id)).first()
    if not proto:
        raise HTTPException(404, "Protocol not found")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 50 * 1024 * 1024:  # 50 MB cap
        raise HTTPException(400, "PDF exceeds 50 MB limit")

    existing_checkpoints = db.query(VVCheckpointDef).filter(
        VVCheckpointDef.protocol_id == proto.id,
        VVCheckpointDef.deprecated_in_version.is_(None)
    ).all()

    from app.engines.vv.pdf_ingestion import ingest_pdf as _ingest_pdf
    result = await _ingest_pdf(
        pdf_bytes=pdf_bytes,
        filename=file.filename,
        protocol_id=str(proto.id),
        protocol_code=proto.code,
        protocol_name=proto.name,
        existing_checkpoints=existing_checkpoints,
        proposed_by=user.email,
        db=db,
    )
    return result


# ──────────────────────── Web Monitor endpoint ───────────────────────────────

@router.post("/protocols/{protocol_id}/check-website")
async def check_website(
    protocol_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """
    Manually trigger website content check for a single protocol.
    Creates pending update log entry if changes are detected.
    Admin only.
    """
    _require_admin(user)
    proto = db.query(VVProtocol).filter(VVProtocol.id == uuid.UUID(protocol_id)).first()
    if not proto:
        raise HTTPException(404, "Protocol not found")
    if not proto.source_url:
        raise HTTPException(400, "Protocol has no source URL configured")

    from app.engines.vv.protocol_monitor import check_protocol_website
    result = await check_protocol_website(proto, db)
    return result


@router.post("/monitor/run")
async def run_monitor_all(
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Manually trigger website monitor for all active protocols (admin only)."""
    _require_admin(user)
    from app.core.scheduler import trigger_protocol_monitor_now
    result = await trigger_protocol_monitor_now()
    return result


# ──────────────────────── Update Log endpoints ───────────────────────────────

@router.get("/update-log")
def list_update_log(
    protocol_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="pending | approved | rejected"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """List update log entries with optional filters."""
    q = db.query(VVProtocolUpdateLog)
    if protocol_id:
        q = q.filter(VVProtocolUpdateLog.protocol_id == uuid.UUID(protocol_id))
    if status:
        q = q.filter(VVProtocolUpdateLog.status == status)
    total = q.count()
    entries = q.order_by(VVProtocolUpdateLog.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "entries": [_log_out(e) for e in entries],
    }


class ReviewPayload(BaseModel):
    notes: Optional[str] = None


@router.post("/update-log/{entry_id}/approve")
def approve_update(
    entry_id: str,
    payload: ReviewPayload = ReviewPayload(),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """
    Approve a pending update proposal and apply the change to the protocol.
    Admin only.
    """
    _require_admin(user)
    entry = db.query(VVProtocolUpdateLog).filter(
        VVProtocolUpdateLog.id == uuid.UUID(entry_id)
    ).first()
    if not entry:
        raise HTTPException(404, "Update log entry not found")
    if entry.status != "pending":
        raise HTTPException(400, f"Entry is already {entry.status}")

    entry.status = "approved"
    entry.reviewed_by = user.email
    entry.reviewed_at = datetime.datetime.utcnow()
    if payload.notes:
        entry.notes = (entry.notes or "") + f"\nReviewer: {payload.notes}"

    # Apply the change
    _apply_approved_change(entry, db)
    db.commit()
    return _log_out(entry)


@router.post("/update-log/{entry_id}/reject")
def reject_update(
    entry_id: str,
    payload: ReviewPayload = ReviewPayload(),
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Reject a pending update proposal (admin only)."""
    _require_admin(user)
    entry = db.query(VVProtocolUpdateLog).filter(
        VVProtocolUpdateLog.id == uuid.UUID(entry_id)
    ).first()
    if not entry:
        raise HTTPException(404, "Update log entry not found")
    if entry.status != "pending":
        raise HTTPException(400, f"Entry is already {entry.status}")

    entry.status = "rejected"
    entry.reviewed_by = user.email
    entry.reviewed_at = datetime.datetime.utcnow()
    if payload.notes:
        entry.notes = (entry.notes or "") + f"\nRejection reason: {payload.notes}"
    db.commit()
    return _log_out(entry)


@router.delete("/update-log/{entry_id}")
def delete_update_log_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    """Permanently delete an update log entry (admin only)."""
    _require_admin(user)
    entry = db.query(VVProtocolUpdateLog).filter(
        VVProtocolUpdateLog.id == uuid.UUID(entry_id)
    ).first()
    if not entry:
        raise HTTPException(404, "Update log entry not found")
    db.delete(entry)
    db.commit()
    return {"deleted": entry_id}


def _apply_approved_change(entry: VVProtocolUpdateLog, db: Session):
    """Apply an approved change to the actual protocol/checkpoint data."""
    try:
        proto = db.query(VVProtocol).filter(VVProtocol.id == entry.protocol_id).first()
        if not proto:
            return

        if entry.change_type == "add_checkpoint":
            new_val = entry.new_value or {}
            # Only insert if doesn't already exist
            existing = db.query(VVCheckpointDef).filter(
                VVCheckpointDef.protocol_id == proto.id,
                VVCheckpointDef.checkpoint_id == entry.checkpoint_id_affected
            ).first()
            if not existing:
                cp = VVCheckpointDef(
                    id=uuid.uuid4(),
                    protocol_id=proto.id,
                    checkpoint_id=new_val.get("id") or entry.checkpoint_id_affected,
                    category=new_val.get("category", "General"),
                    name=new_val.get("name", "New Checkpoint"),
                    requirement=new_val.get("requirement", ""),
                    critical=new_val.get("critical", True),
                    evidence_types=new_val.get("evidence_types", []),
                    added_in_version=proto.version,
                )
                db.add(cp)

        elif entry.change_type == "update_checkpoint":
            cp = db.query(VVCheckpointDef).filter(
                VVCheckpointDef.protocol_id == proto.id,
                VVCheckpointDef.checkpoint_id == entry.checkpoint_id_affected
            ).first()
            if cp and entry.new_value:
                new_val = entry.new_value
                for field in ("name", "requirement", "critical", "category", "evidence_types"):
                    if field in new_val:
                        setattr(cp, field, new_val[field])
                cp.updated_at = datetime.datetime.utcnow()

        elif entry.change_type == "remove_checkpoint":
            cp = db.query(VVCheckpointDef).filter(
                VVCheckpointDef.protocol_id == proto.id,
                VVCheckpointDef.checkpoint_id == entry.checkpoint_id_affected
            ).first()
            if cp:
                cp.deprecated_in_version = proto.version

        elif entry.change_type == "metadata_update":
            # Website hash update — already applied during monitoring
            pass

    except Exception as e:
        logger.error(f"Failed to apply change {entry.id}: {e}")


# ─────────────────────────── Statistics endpoint ─────────────────────────────

@router.get("/stats")
def protocol_stats(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Summary statistics for the protocol registry."""
    total_registries = db.query(func.count(VVRegistry.id)).scalar() or 0
    total_protocols = db.query(func.count(VVProtocol.id)).filter(
        VVProtocol.status != "deprecated"
    ).scalar() or 0
    total_checkpoints = db.query(func.count(VVCheckpointDef.id)).filter(
        VVCheckpointDef.deprecated_in_version.is_(None)
    ).scalar() or 0
    pending_updates = db.query(func.count(VVProtocolUpdateLog.id)).filter(
        VVProtocolUpdateLog.status == "pending"
    ).scalar() or 0
    total_updates = db.query(func.count(VVProtocolUpdateLog.id)).scalar() or 0

    return {
        "total_registries": total_registries,
        "total_protocols": total_protocols,
        "total_checkpoints": total_checkpoints,
        "pending_updates": pending_updates,
        "total_update_log_entries": total_updates,
    }
