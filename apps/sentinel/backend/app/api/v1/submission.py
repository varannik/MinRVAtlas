"""
Pre-Submission Compliance Checklist + Submission Window Tracker.
GET /submission/checklist/{run_id} — structured readiness gate
GET/POST /submission/windows/      — manage submission deadlines
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import ApprovedCorrection, DQARun, DQAViolation, SubmissionWindow

router = APIRouter()


# ── Compliance Checklist ──────────────────────────────────────────────────────

@router.get("/checklist/{run_id}")
def submission_checklist(
    run_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Returns a structured compliance checklist for a completed DQA run.
    Used before generating a V&V submission or credit issuance request.
    """
    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    if run.status != "completed":
        raise HTTPException(400, f"Run status is '{run.status}' — checklist only available for completed runs")

    readiness = round((run.readiness_score or 0) * 100, 1)
    gate_passed = bool(run.gate_passed)

    # Count open violations
    open_violations = db.query(DQAViolation).filter(
        DQAViolation.run_id == run_id,
        DQAViolation.status == "open",
    ).count()
    total_violations = run.total_violations or 0
    resolved_violations = total_violations - open_violations

    # Count applied corrections for this run's dataset
    applied_corrections = db.query(ApprovedCorrection).filter(
        ApprovedCorrection.dataset_id == run.dataset_id,
        ApprovedCorrection.applied_to_production == True,
    ).count()

    # Check if narrative report has been generated (stored in run's config/error_message heuristic)
    # We check for any AI narrative run — approximated by checking approved_corrections or just returning false
    # A real implementation could store a flag in the run record
    narrative_generated = False  # would check a stored flag
    vv_verified = False          # would check for linked V&V project checkpoint passage

    items = [
        {
            "id":          "gate_pass",
            "label":       "Hard Gate Passed",
            "description": "Readiness score ≥ 85% and all hard gate rules pass",
            "status":      "pass" if gate_passed else "fail",
            "detail":      f"Score: {readiness}% {'✅' if gate_passed else '❌ (threshold: 85%)'}",
            "required":    True,
        },
        {
            "id":          "violations_resolved",
            "label":       "Critical Violations Resolved",
            "description": "All critical and high-severity violations must be resolved or waived",
            "status":      "pass" if open_violations == 0 else "warning",
            "detail":      f"{open_violations} open of {total_violations} total violations",
            "required":    True,
        },
        {
            "id":          "corrections_applied",
            "label":       "Corrections Applied to Dataset",
            "description": "AI-generated corrections should be reviewed and applied",
            "status":      "pass" if applied_corrections > 0 else "info",
            "detail":      f"{applied_corrections} corrections applied to production dataset",
            "required":    False,
        },
        {
            "id":          "narrative_generated",
            "label":       "AI Narrative Report Generated",
            "description": "Generate a compliance narrative report for auditor review",
            "status":      "pass" if narrative_generated else "warning",
            "detail":      "Generate from Run DQA → AI Narrative section",
            "required":    False,
        },
        {
            "id":          "vv_verified",
            "label":       "V&V Checkpoint Verified",
            "description": "Third-party V&V review completed via the V&V Platform",
            "status":      "pass" if vv_verified else "info",
            "detail":      "Create a V&V project and complete registry checkpoints",
            "required":    False,
        },
    ]

    required_pass = all(i["status"] == "pass" for i in items if i["required"])
    overall_score = sum(1 for i in items if i["status"] == "pass") / len(items) * 100

    return {
        "run_id":          str(run_id),
        "project_id":      str(run.project_id),
        "dataset_id":      str(run.dataset_id),
        "readiness_score": readiness,
        "gate_passed":     gate_passed,
        "ready_to_submit": required_pass,
        "checklist_score": round(overall_score),
        "items":           items,
        "completed_at":    run.completed_at.isoformat() if run.completed_at else None,
    }


# ── Submission Windows ────────────────────────────────────────────────────────

def _win_out(w: SubmissionWindow) -> dict:
    now = datetime.now(timezone.utc)
    deadline = w.deadline_at
    if deadline and deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    days_until = (deadline - now).days if deadline else None
    hours_until = int((deadline - now).total_seconds() / 3600) if deadline else None
    return {
        "id":          str(w.id),
        "project_id":  str(w.project_id),
        "name":        w.name,
        "description": w.description,
        "deadline_at": w.deadline_at.isoformat() if w.deadline_at else None,
        "status":      w.status,
        "days_until":  days_until,
        "hours_until": hours_until,
        "overdue":     days_until is not None and days_until < 0,
        "created_at":  w.created_at.isoformat() if w.created_at else None,
    }


@router.get("/windows")
def list_windows(
    project_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    wins = (
        db.query(SubmissionWindow)
        .filter(SubmissionWindow.project_id == project_id)
        .order_by(SubmissionWindow.deadline_at.asc())
        .all()
    )
    items = [_win_out(w) for w in wins]
    next_win = next((i for i in items if not i["overdue"]), None)
    return {"windows": items, "next_deadline": next_win, "total": len(items)}


@router.post("/windows")
def create_window(
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    w = SubmissionWindow(
        project_id=data["project_id"],
        name=data["name"],
        description=data.get("description", ""),
        deadline_at=data.get("deadline_at"),
        status=data.get("status", "upcoming"),
        created_by=user.id,
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return _win_out(w)


@router.patch("/windows/{win_id}")
def update_window(
    win_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    w = db.query(SubmissionWindow).filter(SubmissionWindow.id == win_id).first()
    if not w:
        raise HTTPException(404, "Submission window not found")
    for field in ("name", "description", "deadline_at", "status"):
        if field in data:
            setattr(w, field, data[field])
    db.commit()
    return _win_out(w)


@router.delete("/windows/{win_id}")
def delete_window(
    win_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    w = db.query(SubmissionWindow).filter(SubmissionWindow.id == win_id).first()
    if not w:
        raise HTTPException(404, "Submission window not found")
    db.delete(w)
    db.commit()
    return {"ok": True}
