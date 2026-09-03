"""
Instrument Calibration Log — track per-sensor calibration records
and flag overdue instruments during DQA runs.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import InstrumentCalibration

router = APIRouter()


def _out(c: InstrumentCalibration) -> dict:
    now = datetime.now(timezone.utc)
    due = c.next_calibration_at
    if due and due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    overdue = due < now if due else False
    days_until = (due - now).days if due else None
    return {
        "id":                  str(c.id),
        "project_id":          str(c.project_id),
        "instrument_id":       c.instrument_id,
        "instrument_name":     c.instrument_name,
        "location":            c.location,
        "last_calibrated_at":  c.last_calibrated_at.isoformat() if c.last_calibrated_at else None,
        "next_calibration_at": c.next_calibration_at.isoformat() if c.next_calibration_at else None,
        "calibration_cert":    c.calibration_cert,
        "notes":               c.notes,
        "overdue":             overdue,
        "days_until_due":      days_until,
        "created_at":          c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/")
def list_calibrations(
    project_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    records = (
        db.query(InstrumentCalibration)
        .filter(InstrumentCalibration.project_id == project_id)
        .order_by(InstrumentCalibration.next_calibration_at.asc())
        .all()
    )
    items = [_out(c) for c in records]
    overdue_count = sum(1 for i in items if i["overdue"])
    return {"calibrations": items, "overdue_count": overdue_count, "total": len(items)}


@router.post("/")
def create_calibration(
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    rec = InstrumentCalibration(
        project_id=data["project_id"],
        instrument_id=data.get("instrument_id", ""),
        instrument_name=data["instrument_name"],
        location=data.get("location", ""),
        last_calibrated_at=data.get("last_calibrated_at"),
        next_calibration_at=data.get("next_calibration_at"),
        calibration_cert=data.get("calibration_cert", ""),
        notes=data.get("notes", ""),
        created_by=user.id,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return _out(rec)


@router.patch("/{cal_id}")
def update_calibration(
    cal_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    rec = db.query(InstrumentCalibration).filter(InstrumentCalibration.id == cal_id).first()
    if not rec:
        raise HTTPException(404, "Calibration record not found")
    for field in ("instrument_name", "location", "last_calibrated_at",
                  "next_calibration_at", "calibration_cert", "notes", "instrument_id"):
        if field in data:
            setattr(rec, field, data[field])
    db.commit()
    return _out(rec)


@router.delete("/{cal_id}")
def delete_calibration(
    cal_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    rec = db.query(InstrumentCalibration).filter(InstrumentCalibration.id == cal_id).first()
    if not rec:
        raise HTTPException(404, "Calibration record not found")
    db.delete(rec)
    db.commit()
    return {"ok": True}


@router.get("/overdue")
def overdue_calibrations(
    project_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return calibrations that are past their due date — used in DQA run flagging."""
    now = datetime.now(timezone.utc)
    records = (
        db.query(InstrumentCalibration)
        .filter(
            InstrumentCalibration.project_id == project_id,
            InstrumentCalibration.next_calibration_at < now,
        )
        .all()
    )
    return {"overdue": [_out(c) for c in records], "count": len(records)}
