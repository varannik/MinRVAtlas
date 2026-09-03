"""
Reviewer Platform API  — /api/v2/reviewer/
Completely isolated from existing VV/DQA routes.
Handles the full third-party reviewer workflow:
  Registry Connectors · Assignments · CoI · Teams · Plans ·
  Pre-screen · Evidence · Checkpoints · Site Visits ·
  Interviews · CARs · Verification Statements · Integration
"""
import hashlib
import json
import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.reviewer_models import (
    RegistryConnector,
    ReviewerAssignment,
    ReviewerCAR,
    ReviewerCheckpointAssessment,
    ReviewerCheckpointEvidence,
    ReviewerCoiDeclaration,
    ReviewerIntegrationEvent,
    ReviewerInterview,
    ReviewerPreScreen,
    ReviewerSiteVisit,
    ReviewerTeamMember,
    ReviewerVerificationPlan,
    ReviewerVerificationStatement,
)

logger = logging.getLogger("datasentinel.reviewer")
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _log_event(db: Session, *, registry_slug: str = "", direction: str,
               event_type: str, assignment_id=None, payload: dict = None,
               status: str = "delivered"):
    ev = ReviewerIntegrationEvent(
        registry_slug=registry_slug,
        direction=direction,
        event_type=event_type,
        assignment_id=assignment_id,
        payload=payload or {},
        status=status,
        delivered_at=datetime.utcnow() if status == "delivered" else None,
    )
    db.add(ev)
    db.commit()


def _assignment_out(a: ReviewerAssignment) -> dict:
    return {
        "id": str(a.id),
        "registry_slug": a.registry_slug,
        "registry_assignment_ref": a.registry_assignment_ref,
        "registry_project_ref": a.registry_project_ref,
        "project_name": a.project_name,
        "company_name": a.company_name,
        "company_id": a.company_id,
        "methodology_code": a.methodology_code,
        "methodology_version": a.methodology_version,
        "credit_type": a.credit_type,
        "vintage_year": a.vintage_year,
        "country": a.country,
        "credit_quantity_claimed": a.credit_quantity_claimed,
        "assigned_to": str(a.assigned_to) if a.assigned_to else None,
        "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
        "deadline": a.deadline.isoformat() if a.deadline else None,
        "assurance_level": a.assurance_level,
        "status": a.status,
        "document_package_ref": a.document_package_ref,
        "document_package_received_at": a.document_package_received_at.isoformat() if a.document_package_received_at else None,
        "accepted_at":    a.accepted_at.isoformat() if a.accepted_at else None,
        "completed_at":   a.completed_at.isoformat() if a.completed_at else None,
        "created_at":     a.created_at.isoformat() if a.created_at else None,
        "vv_project_id":  str(a.vv_project_id) if a.vv_project_id else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Registry Connectors (API configuration)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/registry-connectors")
def list_registry_connectors(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """List all configured registry connectors."""
    connectors = db.query(RegistryConnector).order_by(RegistryConnector.name).all()
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "slug": c.slug,
            "base_url": c.base_url,
            "api_version": c.api_version,
            "auth_type": c.auth_type,
            "has_api_key": bool(c.api_key),
            "has_webhook_secret": bool(c.webhook_secret),
            "webhook_url": c.webhook_url,
            "supported_events": c.supported_events or [],
            "is_active": c.is_active,
            "sandbox_mode": c.sandbox_mode,
            "notes": c.notes,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in connectors
    ]


@router.post("/registry-connectors")
def create_registry_connector(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Create a new registry connector configuration."""
    slug = (data.get("slug") or "").lower().strip().replace(" ", "_")
    if not slug or not data.get("name") or not data.get("base_url"):
        raise HTTPException(400, "name, slug, and base_url are required")
    existing = db.query(RegistryConnector).filter(RegistryConnector.slug == slug).first()
    if existing:
        raise HTTPException(409, f"A connector with slug '{slug}' already exists")
    connector = RegistryConnector(
        name=data["name"].strip(),
        slug=slug,
        base_url=data["base_url"].strip().rstrip("/"),
        api_version=data.get("api_version", "v1"),
        auth_type=data.get("auth_type", "api_key"),
        api_key=data.get("api_key"),
        client_id=data.get("client_id"),
        client_secret=data.get("client_secret"),
        webhook_secret=data.get("webhook_secret"),
        webhook_url=data.get("webhook_url"),
        supported_events=data.get("supported_events", []),
        is_active=data.get("is_active", True),
        sandbox_mode=data.get("sandbox_mode", False),
        notes=data.get("notes"),
        created_by=user.id,
    )
    db.add(connector)
    db.commit()
    db.refresh(connector)
    return {"id": str(connector.id), "message": f"Registry connector '{connector.name}' created"}


@router.patch("/registry-connectors/{connector_id}")
def update_registry_connector(connector_id: UUID, data: dict,
                               db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Update a registry connector (rotate keys, update URLs, toggle active)."""
    c = db.query(RegistryConnector).filter(RegistryConnector.id == connector_id).first()
    if not c:
        raise HTTPException(404, "Connector not found")
    for field in ["name", "base_url", "api_version", "auth_type", "api_key",
                  "client_id", "client_secret", "webhook_secret", "webhook_url",
                  "supported_events", "is_active", "sandbox_mode", "notes"]:
        if field in data:
            setattr(c, field, data[field])
    db.commit()
    return {"message": "Connector updated"}


@router.delete("/registry-connectors/{connector_id}")
def delete_registry_connector(connector_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = db.query(RegistryConnector).filter(RegistryConnector.id == connector_id).first()
    if not c:
        raise HTTPException(404, "Connector not found")
    db.delete(c)
    db.commit()
    return {"message": "Connector deleted"}


@router.post("/registry-connectors/{connector_id}/test")
async def test_registry_connector(connector_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Test connectivity to a registry — tries to list pending assignments."""
    c = db.query(RegistryConnector).filter(RegistryConnector.id == connector_id).first()
    if not c:
        raise HTTPException(404, "Connector not found")
    try:
        from app.integrations.isometric import get_connector
        conn = get_connector(c.slug, {
            "base_url": c.base_url, "api_key": c.api_key,
            "api_version": c.api_version, "sandbox_mode": c.sandbox_mode,
        })
        assignments = await conn.fetch_pending_assignments()
        return {"status": "ok", "pending_assignments": len(assignments), "message": "Connection successful"}
    except ValueError as e:
        return {"status": "not_implemented", "message": str(e)}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Assignments
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/assignments")
def list_assignments(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """List all assignments (admin sees all; reviewer sees own)."""
    q = db.query(ReviewerAssignment)
    if getattr(user, "role", "analyst") not in ("admin", "super_admin"):
        q = q.filter(ReviewerAssignment.assigned_to == user.id)
    assignments = q.order_by(ReviewerAssignment.created_at.desc()).all()
    return [_assignment_out(a) for a in assignments]


@router.get("/assignments/incoming")
def list_incoming_assignments(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Admin only — list unassigned assignments that arrived from the registry
    and are waiting to be assigned to a specific reviewer.
    """
    if getattr(user, "role", "analyst") not in ("admin", "super_admin"):
        raise HTTPException(403, "Admin access required")
    assignments = (
        db.query(ReviewerAssignment)
        .filter(
            ReviewerAssignment.assigned_to == None,  # noqa: E711
            ReviewerAssignment.status == "pending",
        )
        .order_by(ReviewerAssignment.created_at.desc())
        .all()
    )
    return [_assignment_out(a) for a in assignments]


@router.post("/assignments/{assignment_id}/assign")
def assign_to_reviewer(
    assignment_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Admin only — assign an incoming assignment to a specific reviewer.
    Body: { reviewer_id: str }
    Sends an in-app notification to the assigned reviewer.
    """
    if getattr(user, "role", "analyst") not in ("admin", "super_admin"):
        raise HTTPException(403, "Admin access required")

    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    if a.assigned_to is not None:
        raise HTTPException(409, "Assignment is already assigned to a reviewer")

    reviewer_id = (data.get("reviewer_id") or "").strip()
    if not reviewer_id:
        raise HTTPException(400, "reviewer_id is required")

    from app.models import User as UserModel
    reviewer = db.query(UserModel).filter(UserModel.id == reviewer_id, UserModel.is_active == True).first()
    if not reviewer:
        raise HTTPException(404, "Reviewer not found or inactive")

    a.assigned_to = reviewer.id
    a.assigned_at  = datetime.utcnow()
    a.status = "pending"  # pending acceptance by reviewer
    db.commit()

    # Notify the assigned reviewer
    try:
        from app.api.v1.notifications import create_notification
        create_notification(
            db,
            title="New verification project assigned",
            message=(
                f"You have been assigned a new verification project: "
                f'"{a.project_name}" ({a.registry_slug.replace("_", " ").title()}). '
                f"Please review and accept or decline in My Assignments."
            ),
            event_type="assignment_assigned",
            entity_id=str(a.id),
            entity_type="reviewer_assignment",
            user_id=reviewer.id,
        )
    except Exception as notif_err:
        logger.warning("Could not send assignment notification: %s", notif_err)

    _log_event(
        db, registry_slug=a.registry_slug, direction="outbound",
        event_type="assignment.assigned_to_reviewer", assignment_id=a.id,
        payload={
            "reviewer_id":   str(reviewer.id),
            "reviewer_email": reviewer.email,
            "assigned_by":   str(user.id),
        },
    )
    return {
        "message":      f"Assignment assigned to {reviewer.full_name or reviewer.email}",
        "assignment":   _assignment_out(a),
        "reviewer_name": reviewer.full_name or reviewer.email,
    }


@router.get("/reviewers")
def list_available_reviewers(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Admin only — list users who have Reviewer Platform access and can be
    assigned verification projects.
    """
    if getattr(user, "role", "analyst") not in ("admin", "super_admin"):
        raise HTTPException(403, "Admin access required")
    from app.models import User as UserModel
    from sqlalchemy import or_
    users = db.query(UserModel).filter(UserModel.is_active == True).all()
    result = []
    for u in users:
        role = getattr(u, "role", "analyst")
        pa = getattr(u, "platform_access", None)
        # Include: admins (full access) OR users with reviewer platform access
        has_reviewer = (
            role in ("admin", "super_admin")
            or pa is None  # null = all enabled
            or (isinstance(pa, dict) and pa.get("reviewer") is True)
        )
        if has_reviewer:
            result.append({
                "id":        str(u.id),
                "name":      u.full_name or u.email.split("@")[0],
                "email":     u.email,
                "role":      role,
                "avatar":    "".join(p[0].upper() for p in (u.full_name or u.email).split()[:2])[:2],
            })
    return result


@router.post("/assignments")
def create_assignment(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Manually create an assignment (e.g. entered from a registry email).
    In production this is created automatically by the webhook receiver.
    """
    if not data.get("project_name") or not data.get("registry_slug"):
        raise HTTPException(400, "project_name and registry_slug are required")
    a = ReviewerAssignment(
        registry_slug=data["registry_slug"],
        registry_assignment_ref=data.get("registry_assignment_ref"),
        registry_project_ref=data.get("registry_project_ref"),
        project_name=data["project_name"],
        company_name=data.get("company_name"),
        company_id=data.get("company_id"),
        methodology_code=data.get("methodology_code"),
        methodology_version=data.get("methodology_version"),
        credit_type=data.get("credit_type"),
        vintage_year=data.get("vintage_year"),
        country=data.get("country"),
        credit_quantity_claimed=data.get("credit_quantity_claimed"),
        assurance_level=data.get("assurance_level", "reasonable"),
        document_package_ref=data.get("document_package_ref"),
        status="pending",
    )
    if data.get("deadline"):
        try:
            a.deadline = datetime.fromisoformat(data["deadline"].replace("Z", "+00:00"))
        except Exception:
            pass
    db.add(a)
    db.commit()
    db.refresh(a)
    _log_event(db, direction="inbound", event_type="assignment.created",
               assignment_id=a.id, payload=data)
    return _assignment_out(a)


@router.get("/assignments/{assignment_id}")
def get_assignment(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    return _assignment_out(a)


@router.post("/assignments/{assignment_id}/accept")
def accept_assignment(assignment_id: UUID, data: dict = {},
                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Accept a project assignment.
    Automatically creates a linked V&V Platform project so the reviewer
    can go straight into the review workspace without manual setup.
    """
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    if a.status not in ("pending",):
        raise HTTPException(409, f"Assignment is already '{a.status}'")

    a.assigned_to = user.id
    a.assigned_at = datetime.utcnow()
    a.accepted_at = datetime.utcnow()
    a.status = "accepted"

    # ── Auto-create V&V project bridge ────────────────────────────────────────
    # Only create if one doesn't already exist for this assignment
    if not a.vv_project_id:
        try:
            from app.models.vv_models import VVProject
            registry_slug = a.registry_slug or "unknown_registry"
            methodology   = a.methodology_code or "UNKNOWN"
            # All features enabled + locked for formal reviewer projects
            all_features_on = {
                "cars": True, "rfis": True, "ai_deep_analysis": True,
                "consistency_check": True, "decision": True, "registry_sync": True,
            }
            vv_project = VVProject(
                name=a.project_name,
                description=(
                    f"REGISTRY:{registry_slug}|METHODOLOGY:{methodology}|"
                    f"Auto-created from Reviewer Platform assignment "
                    f"{a.registry_assignment_ref or str(a.id)}"
                ),
                registry_id=None,
                methodology_id=None,
                project_developer=a.company_name or "",
                location=a.country or "",
                vintage_year=a.vintage_year or 2024,
                status="submitted",
                created_by=user.id,
                features_enabled=all_features_on,
                reviewer_assignment_id=a.id,  # locks the toggles
            )
            db.add(vv_project)
            db.flush()  # get the UUID without committing yet
            a.vv_project_id = vv_project.id
            logger.info(
                "Auto-created VV project %s for assignment %s",
                vv_project.id, assignment_id,
            )
        except Exception as vv_err:
            # Non-fatal — assignment still accepted even if VV project creation fails
            logger.warning("Could not auto-create VV project for assignment %s: %s", assignment_id, vv_err)

    db.commit()
    _log_event(db, registry_slug=a.registry_slug, direction="outbound",
               event_type="assignment.accepted", assignment_id=a.id,
               payload={
                   "reviewer_id":   str(user.id),
                   "reviewer_name": getattr(user, "full_name", None) or str(user.email),
                   "vv_project_id": str(a.vv_project_id) if a.vv_project_id else None,
               })
    return {
        "message":        "Assignment accepted",
        "status":         a.status,
        "vv_project_id":  str(a.vv_project_id) if a.vv_project_id else None,
    }


@router.post("/assignments/{assignment_id}/decline")
def decline_assignment(assignment_id: UUID, data: dict,
                       db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    reason = (data.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "A reason for declining is required")
    a.status = "declined"
    a.decline_reason = reason
    db.commit()
    _log_event(db, registry_slug=a.registry_slug, direction="outbound",
               event_type="assignment.declined", assignment_id=a.id,
               payload={"reason": reason})
    return {"message": "Assignment declined"}


@router.patch("/assignments/{assignment_id}")
def update_assignment(assignment_id: UUID, data: dict,
                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    for field in ["status", "assurance_level", "document_package_ref", "methodology_version"]:
        if field in data:
            setattr(a, field, data[field])
    if "deadline" in data and data["deadline"]:
        try:
            a.deadline = datetime.fromisoformat(data["deadline"].replace("Z", "+00:00"))
        except Exception:
            pass
    db.commit()
    return _assignment_out(a)


# ─────────────────────────────────────────────────────────────────────────────
# Conflict of Interest Declarations
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/assignments/{assignment_id}/coi")
def submit_coi(assignment_id: UUID, data: dict,
               db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Submit a Conflict of Interest declaration for an assignment."""
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    # Build a canonical declaration text and hash it
    declaration_content = json.dumps({
        "assignment_id": str(assignment_id),
        "reviewer_id": str(user.id),
        "project_name": a.project_name,
        "company_name": a.company_name,
        "no_financial_interest": data.get("no_financial_interest"),
        "no_prior_engagement": data.get("no_prior_engagement"),
        "no_personal_relationship": data.get("no_personal_relationship"),
        "no_competitive_interest": data.get("no_competitive_interest"),
        "additional_disclosures": data.get("additional_disclosures", ""),
        "declared_at": datetime.utcnow().isoformat(),
    }, sort_keys=True)
    sig = hashlib.sha256(declaration_content.encode()).hexdigest()
    coi = ReviewerCoiDeclaration(
        assignment_id=assignment_id,
        reviewer_id=user.id,
        no_financial_interest=bool(data.get("no_financial_interest")),
        no_prior_engagement=bool(data.get("no_prior_engagement")),
        no_personal_relationship=bool(data.get("no_personal_relationship")),
        no_competitive_interest=bool(data.get("no_competitive_interest", True)),
        additional_disclosures=data.get("additional_disclosures"),
        declaration_text=declaration_content,
        signature_hash=sig,
    )
    db.add(coi)
    # Advance assignment status
    if a.status == "accepted":
        a.status = "coi_declared"
    db.commit()
    return {"message": "CoI declaration recorded", "signature_hash": sig}


@router.get("/assignments/{assignment_id}/coi")
def get_coi(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    cois = db.query(ReviewerCoiDeclaration).filter(
        ReviewerCoiDeclaration.assignment_id == assignment_id
    ).all()
    return [
        {
            "id": str(c.id),
            "reviewer_id": str(c.reviewer_id),
            "no_financial_interest": c.no_financial_interest,
            "no_prior_engagement": c.no_prior_engagement,
            "no_personal_relationship": c.no_personal_relationship,
            "no_competitive_interest": c.no_competitive_interest,
            "additional_disclosures": c.additional_disclosures,
            "signature_hash": c.signature_hash,
            "declared_at": c.declared_at.isoformat() if c.declared_at else None,
        }
        for c in cois
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Review Teams
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/assignments/{assignment_id}/team")
def add_team_member(assignment_id: UUID, data: dict,
                    db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    member = ReviewerTeamMember(
        assignment_id=assignment_id,
        reviewer_id=data.get("reviewer_id") or user.id,
        role=data.get("role", "technical"),
        disciplines=data.get("disciplines", []),
    )
    db.add(member)
    db.commit()
    return {"message": "Team member added"}


@router.get("/assignments/{assignment_id}/team")
def get_team(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    members = db.query(ReviewerTeamMember).filter(
        ReviewerTeamMember.assignment_id == assignment_id
    ).all()
    return [
        {
            "id": str(m.id),
            "reviewer_id": str(m.reviewer_id),
            "role": m.role,
            "disciplines": m.disciplines or [],
            "joined_at": m.joined_at.isoformat() if m.joined_at else None,
        }
        for m in members
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Verification Plans
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/assignments/{assignment_id}/plan")
def create_or_update_plan(assignment_id: UUID, data: dict,
                          db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Create or update the verification plan for an assignment."""
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    plan = db.query(ReviewerVerificationPlan).filter(
        ReviewerVerificationPlan.assignment_id == assignment_id
    ).first()
    if not plan:
        plan = ReviewerVerificationPlan(assignment_id=assignment_id)
        db.add(plan)
    for field in ["assurance_level", "methodology_version", "risk_level", "risk_assessment_notes",
                  "materiality_threshold_pct", "in_scope_checkpoints", "out_of_scope_reasons",
                  "site_visit_required", "site_visit_type", "planned_site_visit_dates",
                  "milestone_dates", "ai_draft_used"]:
        if field in data:
            setattr(plan, field, data[field])
    if data.get("approved") and not plan.approved_at:
        plan.approved_by = user.id
        plan.approved_at = datetime.utcnow()
        if a.status in ("coi_declared", "accepted"):
            a.status = "planning"
    db.commit()
    db.refresh(plan)
    return {
        "id": str(plan.id),
        "assignment_id": str(plan.assignment_id),
        "assurance_level": plan.assurance_level,
        "methodology_version": plan.methodology_version,
        "risk_level": plan.risk_level,
        "risk_assessment_notes": plan.risk_assessment_notes,
        "materiality_threshold_pct": plan.materiality_threshold_pct,
        "in_scope_checkpoints": plan.in_scope_checkpoints or [],
        "out_of_scope_reasons": plan.out_of_scope_reasons or {},
        "site_visit_required": plan.site_visit_required,
        "site_visit_type": plan.site_visit_type,
        "planned_site_visit_dates": plan.planned_site_visit_dates or [],
        "milestone_dates": plan.milestone_dates or {},
        "ai_draft_used": plan.ai_draft_used,
        "approved_at": plan.approved_at.isoformat() if plan.approved_at else None,
    }


@router.get("/assignments/{assignment_id}/plan")
def get_plan(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    plan = db.query(ReviewerVerificationPlan).filter(
        ReviewerVerificationPlan.assignment_id == assignment_id
    ).first()
    if not plan:
        return None
    return {
        "id": str(plan.id),
        "assurance_level": plan.assurance_level,
        "methodology_version": plan.methodology_version,
        "risk_level": plan.risk_level,
        "risk_assessment_notes": plan.risk_assessment_notes,
        "materiality_threshold_pct": plan.materiality_threshold_pct,
        "in_scope_checkpoints": plan.in_scope_checkpoints or [],
        "out_of_scope_reasons": plan.out_of_scope_reasons or {},
        "site_visit_required": plan.site_visit_required,
        "site_visit_type": plan.site_visit_type,
        "planned_site_visit_dates": plan.planned_site_visit_dates or [],
        "milestone_dates": plan.milestone_dates or {},
        "ai_draft_used": plan.ai_draft_used,
        "approved_at": plan.approved_at.isoformat() if plan.approved_at else None,
    }


@router.post("/assignments/{assignment_id}/plan/ai-draft")
async def ai_draft_plan(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Generate an AI draft of the verification plan based on assignment metadata."""
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    try:
        from app.engines.ai.claude_client import call_claude
        system = "You are a senior carbon verification specialist. Draft a concise verification plan."
        prompt = f"""Draft a verification plan for:
Project: {a.project_name}
Company: {a.company_name}
Methodology: {a.methodology_code} {a.methodology_version or ''}
Credit type: {a.credit_type}
Vintage: {a.vintage_year}
Country: {a.country}
Claimed credits: {a.credit_quantity_claimed} tCO2e

Include: risk assessment rationale, key areas of focus, site visit recommendation,
key milestones with suggested timeframes. Be concise and professional."""
        draft = await call_claude(system, prompt, max_tokens=1200, timeout=60)
        return {"draft": draft or "AI draft unavailable — please draft manually."}
    except Exception as e:
        return {"draft": f"AI draft failed: {e}"}


# ─────────────────────────────────────────────────────────────────────────────
# Document Pre-Screen
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/assignments/{assignment_id}/pre-screen")
async def run_pre_screen(assignment_id: UUID, data: dict = {},
                         db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Run AI completeness + plausibility pre-screen on the received document package.
    documents: [{name, type, size}] — passed from the frontend after package receipt.
    """
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    documents = data.get("documents", [])
    doc_list_str = "\n".join(f"  - {d.get('name','?')} ({d.get('type','?')})" for d in documents)
    try:
        from app.engines.ai.claude_client import call_claude_json
        system = "You are a carbon registry document analyst. Respond with valid JSON only."
        prompt = f"""Analyse this document package for a carbon credit verification.

Project: {a.project_name} | Methodology: {a.methodology_code} | Credits claimed: {a.credit_quantity_claimed} tCO2e

Documents received:
{doc_list_str or 'No document list provided — assess from project type only.'}

Return JSON:
{{
  "completeness": {{
    "present": ["list of doc types present"],
    "likely_missing": ["doc types typically required but not seen"],
    "pct_complete": 0-100
  }},
  "plausibility": {{
    "overall_risk": "low|medium|high",
    "flags": ["list of plausibility concerns or anomalies"]
  }},
  "priority_focus_areas": ["top 3-5 areas requiring closest scrutiny"],
  "ai_summary": "2-3 sentence executive summary of pre-screen findings"
}}"""
        result = await call_claude_json(system, prompt, max_tokens=1000, timeout=45)
        if not result:
            result = {"completeness": {}, "plausibility": {}, "priority_focus_areas": [], "ai_summary": "AI pre-screen unavailable."}
    except Exception:
        result = {"completeness": {}, "plausibility": {}, "priority_focus_areas": [], "ai_summary": "AI pre-screen failed."}
    ps = ReviewerPreScreen(
        assignment_id=assignment_id,
        completeness_result=result.get("completeness", {}),
        plausibility_result=result.get("plausibility", {}),
        ai_summary=result.get("ai_summary"),
        risk_priority_map={a: "high" for a in result.get("priority_focus_areas", [])},
        run_by=user.id,
    )
    db.add(ps)
    if a.status == "planning":
        a.status = "document_review"
    db.commit()
    return result


@router.get("/assignments/{assignment_id}/pre-screen")
def get_pre_screen(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ps = db.query(ReviewerPreScreen).filter(
        ReviewerPreScreen.assignment_id == assignment_id
    ).order_by(ReviewerPreScreen.run_at.desc()).first()
    if not ps:
        return None
    return {
        "completeness": ps.completeness_result,
        "plausibility": ps.plausibility_result,
        "ai_summary": ps.ai_summary,
        "priority_focus_areas": list(ps.risk_priority_map.keys()) if ps.risk_priority_map else [],
        "run_at": ps.run_at.isoformat() if ps.run_at else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Checkpoint Assessments & Evidence
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/assignments/{assignment_id}/checkpoints")
async def list_checkpoints(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return all checkpoint assessments, with AI pre-assessment where available."""
    assessments = db.query(ReviewerCheckpointAssessment).filter(
        ReviewerCheckpointAssessment.assignment_id == assignment_id
    ).all()
    evidence = db.query(ReviewerCheckpointEvidence).filter(
        ReviewerCheckpointEvidence.assignment_id == assignment_id
    ).all()
    ev_map: dict = {}
    for e in evidence:
        ev_map.setdefault(e.checkpoint_code, []).append({
            "id": str(e.id),
            "document_name": e.document_name,
            "document_section": e.document_section,
            "extracted_excerpt": e.extracted_excerpt,
            "reviewer_note": e.reviewer_note,
        })
    return [
        {
            "id": str(a.id),
            "checkpoint_code": a.checkpoint_code,
            "checkpoint_label": a.checkpoint_label,
            "status": a.status,
            "reviewer_judgment": a.reviewer_judgment,
            "ai_pre_assessment": a.ai_pre_assessment or {},
            "ai_pre_assessment_used": a.ai_pre_assessment_used,
            "evidence": ev_map.get(a.checkpoint_code, []),
            "assessed_at": a.assessed_at.isoformat() if a.assessed_at else None,
        }
        for a in assessments
    ]


@router.post("/assignments/{assignment_id}/checkpoints")
def create_checkpoint(assignment_id: UUID, data: dict,
                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Add a checkpoint to the review (bulk-create or single)."""
    checkpoints = data.get("checkpoints") or [data]
    created = []
    for cp in checkpoints:
        existing = db.query(ReviewerCheckpointAssessment).filter(
            ReviewerCheckpointAssessment.assignment_id == assignment_id,
            ReviewerCheckpointAssessment.checkpoint_code == cp.get("checkpoint_code"),
        ).first()
        if existing:
            continue
        obj = ReviewerCheckpointAssessment(
            assignment_id=assignment_id,
            checkpoint_code=cp.get("checkpoint_code", ""),
            checkpoint_label=cp.get("checkpoint_label", ""),
            status="pending",
            ai_pre_assessment=cp.get("ai_pre_assessment", {}),
        )
        db.add(obj)
        created.append(cp.get("checkpoint_code"))
    db.commit()
    return {"created": created}


@router.patch("/assignments/{assignment_id}/checkpoints/{checkpoint_code}")
def update_checkpoint(assignment_id: UUID, checkpoint_code: str, data: dict,
                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Record reviewer judgment on a checkpoint."""
    cp = db.query(ReviewerCheckpointAssessment).filter(
        ReviewerCheckpointAssessment.assignment_id == assignment_id,
        ReviewerCheckpointAssessment.checkpoint_code == checkpoint_code,
    ).first()
    if not cp:
        raise HTTPException(404, "Checkpoint not found")
    if "status" in data:
        cp.status = data["status"]
    if "reviewer_judgment" in data:
        cp.reviewer_judgment = data["reviewer_judgment"]
    if "ai_pre_assessment_used" in data:
        cp.ai_pre_assessment_used = data["ai_pre_assessment_used"]
    if data.get("status") and data["status"] != "pending":
        cp.assessed_by = user.id
        cp.assessed_at = datetime.utcnow()
    db.commit()
    return {"message": "Checkpoint updated"}


@router.post("/assignments/{assignment_id}/checkpoints/{checkpoint_code}/ai-assess")
async def ai_assess_checkpoint(assignment_id: UUID, checkpoint_code: str, data: dict = {},
                                db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Run AI pre-assessment on a single checkpoint given the available evidence."""
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    evidence_text = data.get("evidence_text", "")
    requirement = data.get("requirement", "")
    try:
        from app.engines.ai.claude_client import call_claude_json
        system = "You are a carbon credit verification expert. Respond with valid JSON only."
        prompt = f"""Assess this verification checkpoint.

Project: {a.project_name} | Methodology: {a.methodology_code}
Checkpoint: {checkpoint_code}
Requirement: {requirement or 'See methodology'}
Evidence provided:
{evidence_text or 'No specific evidence text provided.'}

Return JSON:
{{
  "preliminary_status": "pass|minor_finding|major_finding|critical_finding|needs_more_info",
  "confidence_pct": 0-100,
  "rationale": "1-2 sentence explanation",
  "suggested_evidence_gaps": ["list any evidence still needed"],
  "draft_car_text": "If a finding — draft CAR text, else null"
}}"""
        result = await call_claude_json(system, prompt, max_tokens=600, timeout=35)
        if not result:
            result = {"preliminary_status": "needs_more_info", "confidence_pct": 0, "rationale": "AI assessment unavailable."}
        # Store on the checkpoint record
        cp = db.query(ReviewerCheckpointAssessment).filter(
            ReviewerCheckpointAssessment.assignment_id == assignment_id,
            ReviewerCheckpointAssessment.checkpoint_code == checkpoint_code,
        ).first()
        if cp:
            cp.ai_pre_assessment = result
            db.commit()
        return result
    except Exception as e:
        raise HTTPException(503, f"AI assessment failed: {e}")


@router.post("/assignments/{assignment_id}/checkpoints/{checkpoint_code}/evidence")
def add_evidence(assignment_id: UUID, checkpoint_code: str, data: dict,
                 db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Link a document/section as evidence for a checkpoint."""
    ev = ReviewerCheckpointEvidence(
        assignment_id=assignment_id,
        checkpoint_code=checkpoint_code,
        document_name=data.get("document_name"),
        document_registry_ref=data.get("document_registry_ref"),
        document_section=data.get("document_section"),
        extracted_excerpt=data.get("extracted_excerpt"),
        reviewer_note=data.get("reviewer_note"),
        linked_by=user.id,
    )
    db.add(ev)
    db.commit()
    return {"id": str(ev.id), "message": "Evidence linked"}


@router.delete("/assignments/{assignment_id}/checkpoints/{checkpoint_code}/evidence/{evidence_id}")
def remove_evidence(assignment_id: UUID, checkpoint_code: str, evidence_id: UUID,
                    db: Session = Depends(get_db), user=Depends(get_current_user)):
    ev = db.query(ReviewerCheckpointEvidence).filter(
        ReviewerCheckpointEvidence.id == evidence_id,
        ReviewerCheckpointEvidence.assignment_id == assignment_id,
    ).first()
    if not ev:
        raise HTTPException(404, "Evidence link not found")
    db.delete(ev)
    db.commit()
    return {"message": "Evidence link removed"}


# ─────────────────────────────────────────────────────────────────────────────
# Site Visits & Interviews
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/assignments/{assignment_id}/site-visits")
def log_site_visit(assignment_id: UUID, data: dict,
                   db: Session = Depends(get_db), user=Depends(get_current_user)):
    sv = ReviewerSiteVisit(
        assignment_id=assignment_id,
        visit_type=data.get("visit_type", "remote"),
        location=data.get("location"),
        duration_hours=data.get("duration_hours"),
        participants=data.get("participants", []),
        agenda=data.get("agenda"),
        observations=data.get("observations"),
        action_items=data.get("action_items", []),
        attachments=data.get("attachments", []),
        logged_by=user.id,
    )
    if data.get("visit_date"):
        try:
            sv.visit_date = datetime.fromisoformat(data["visit_date"].replace("Z", "+00:00"))
        except Exception:
            pass
    db.add(sv)
    db.commit()
    return {"id": str(sv.id), "message": "Site visit logged"}


@router.get("/assignments/{assignment_id}/site-visits")
def list_site_visits(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    visits = db.query(ReviewerSiteVisit).filter(
        ReviewerSiteVisit.assignment_id == assignment_id
    ).order_by(ReviewerSiteVisit.visit_date.desc()).all()
    return [
        {
            "id": str(v.id),
            "visit_type": v.visit_type,
            "visit_date": v.visit_date.isoformat() if v.visit_date else None,
            "location": v.location,
            "duration_hours": v.duration_hours,
            "participants": v.participants or [],
            "observations": v.observations,
            "action_items": v.action_items or [],
        }
        for v in visits
    ]


@router.post("/assignments/{assignment_id}/interviews")
def log_interview(assignment_id: UUID, data: dict,
                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    iv = ReviewerInterview(
        assignment_id=assignment_id,
        interview_type=data.get("interview_type", "remote"),
        interviewees=data.get("interviewees", []),
        topics=data.get("topics", []),
        key_points=data.get("key_points"),
        follow_up_items=data.get("follow_up_items", []),
        logged_by=user.id,
    )
    if data.get("interview_date"):
        try:
            iv.interview_date = datetime.fromisoformat(data["interview_date"].replace("Z", "+00:00"))
        except Exception:
            pass
    db.add(iv)
    db.commit()
    return {"id": str(iv.id), "message": "Interview logged"}


@router.get("/assignments/{assignment_id}/interviews")
def list_interviews(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    interviews = db.query(ReviewerInterview).filter(
        ReviewerInterview.assignment_id == assignment_id
    ).order_by(ReviewerInterview.interview_date.desc()).all()
    return [
        {
            "id": str(iv.id),
            "interview_type": iv.interview_type,
            "interview_date": iv.interview_date.isoformat() if iv.interview_date else None,
            "interviewees": iv.interviewees or [],
            "topics": iv.topics or [],
            "key_points": iv.key_points,
        }
        for iv in interviews
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Reviewer CARs
# ─────────────────────────────────────────────────────────────────────────────

def _car_out(c: ReviewerCAR) -> dict:
    return {
        "id": str(c.id),
        "assignment_id": str(c.assignment_id),
        "car_number": c.car_number,
        "checkpoint_code": c.checkpoint_code,
        "severity": c.severity,
        "finding_description": c.finding_description,
        "requirement_reference": c.requirement_reference,
        "ai_draft_used": c.ai_draft_used,
        "registry_car_ref": c.registry_car_ref,
        "status": c.status,
        "company_response": c.company_response,
        "response_received_at": c.response_received_at.isoformat() if c.response_received_at else None,
        "ai_response_assessment": c.ai_response_assessment or {},
        "reviewer_determination": c.reviewer_determination,
        "determination_note": c.determination_note,
        "closed_at": c.closed_at.isoformat() if c.closed_at else None,
        "issued_by_name": c.issued_by_name,
        "issued_at": c.issued_at.isoformat() if c.issued_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.get("/assignments/{assignment_id}/cars")
def list_cars(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    cars = db.query(ReviewerCAR).filter(
        ReviewerCAR.assignment_id == assignment_id
    ).order_by(ReviewerCAR.created_at.asc()).all()
    return [_car_out(c) for c in cars]


@router.get("/cars")
def list_all_cars(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Cross-assignment CAR dashboard — all open CARs for this reviewer."""
    q = db.query(ReviewerCAR)
    if getattr(user, "role", "analyst") != "admin":
        # Filter to assignments owned by this reviewer
        my_ids = [
            a.id for a in db.query(ReviewerAssignment).filter(
                ReviewerAssignment.assigned_to == user.id
            ).all()
        ]
        q = q.filter(ReviewerCAR.assignment_id.in_(my_ids))
    cars = q.filter(ReviewerCAR.status.notin_(["closed"])).order_by(ReviewerCAR.created_at.desc()).all()
    return [_car_out(c) for c in cars]


@router.post("/assignments/{assignment_id}/cars")
async def issue_car(assignment_id: UUID, data: dict,
                    db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Issue a new CAR (optionally with AI draft)."""
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    # Auto-number
    count = db.query(ReviewerCAR).filter(ReviewerCAR.assignment_id == assignment_id).count()
    car_number = f"CAR-{count + 1:03d}"
    ai_draft_used = bool(data.get("ai_draft_used"))
    car = ReviewerCAR(
        assignment_id=assignment_id,
        car_number=car_number,
        checkpoint_code=data.get("checkpoint_code"),
        severity=data.get("severity", "major"),
        finding_description=data.get("finding_description", ""),
        requirement_reference=data.get("requirement_reference"),
        ai_draft_used=ai_draft_used,
        status="draft",
        issued_by=user.id,
        issued_by_name=getattr(user, "full_name", None) or str(getattr(user, "email", "")),
    )
    db.add(car)
    if a.status == "checkpoint_review":
        a.status = "car_issued"
    db.commit()
    db.refresh(car)
    return _car_out(car)


@router.post("/assignments/{assignment_id}/cars/{car_id}/ai-draft")
async def ai_draft_car(assignment_id: UUID, car_id: UUID, data: dict = {},
                       db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Generate AI draft CAR text for a finding."""
    car = db.query(ReviewerCAR).filter(
        ReviewerCAR.id == car_id, ReviewerCAR.assignment_id == assignment_id
    ).first()
    if not car:
        raise HTTPException(404, "CAR not found")
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    try:
        from app.engines.ai.claude_client import call_claude
        system = "You are a senior carbon credit verifier. Write professional, precise CAR text."
        prompt = f"""Draft a Corrective Action Request (CAR) for the following verification finding.

Project: {a.project_name if a else 'Unknown'} | Methodology: {a.methodology_code if a else 'Unknown'}
Checkpoint: {car.checkpoint_code or data.get('checkpoint_code', 'N/A')}
Severity: {car.severity}
Requirement reference: {car.requirement_reference or data.get('requirement_reference', 'N/A')}
Finding notes: {data.get('finding_notes', '') or car.finding_description}

Write a formal CAR with:
1. Clear description of the non-conformance
2. Reference to the methodology requirement
3. What the project developer must provide to close this CAR
Keep it under 200 words, professional, specific."""
        draft = await call_claude(system, prompt, max_tokens=400, timeout=35)
        return {"draft": draft or "AI draft unavailable."}
    except Exception as e:
        return {"draft": f"AI draft failed: {e}"}


@router.patch("/assignments/{assignment_id}/cars/{car_id}")
def update_car(assignment_id: UUID, car_id: UUID, data: dict,
               db: Session = Depends(get_db), user=Depends(get_current_user)):
    car = db.query(ReviewerCAR).filter(
        ReviewerCAR.id == car_id, ReviewerCAR.assignment_id == assignment_id
    ).first()
    if not car:
        raise HTTPException(404, "CAR not found")
    for field in ["severity", "finding_description", "requirement_reference", "status"]:
        if field in data:
            setattr(car, field, data[field])
    if data.get("status") == "issued" and not car.issued_at:
        car.issued_at = datetime.utcnow()
        _log_event(db, direction="outbound", event_type="car.issued",
                   assignment_id=assignment_id, payload={"car_number": car.car_number})
    db.commit()
    return _car_out(car)


@router.post("/assignments/{assignment_id}/cars/{car_id}/close")
async def close_car(assignment_id: UUID, car_id: UUID, data: dict,
                    db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Accept company response and close the CAR."""
    car = db.query(ReviewerCAR).filter(
        ReviewerCAR.id == car_id, ReviewerCAR.assignment_id == assignment_id
    ).first()
    if not car:
        raise HTTPException(404, "CAR not found")
    car.reviewer_determination = "accept"
    car.determination_note = data.get("note", "")
    car.status = "closed"
    car.closed_by = user.id
    car.closed_at = datetime.utcnow()
    db.commit()
    _log_event(db, direction="outbound", event_type="car.closed",
               assignment_id=assignment_id, payload={"car_number": car.car_number})
    return _car_out(car)


@router.post("/assignments/{assignment_id}/cars/{car_id}/reject")
def reject_car_response(assignment_id: UUID, car_id: UUID, data: dict,
                        db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Reject company response — CAR goes back to issued for another response cycle."""
    car = db.query(ReviewerCAR).filter(
        ReviewerCAR.id == car_id, ReviewerCAR.assignment_id == assignment_id
    ).first()
    if not car:
        raise HTTPException(404, "CAR not found")
    car.reviewer_determination = "reject"
    car.determination_note = data.get("reason", "")
    car.status = "issued"  # back to open
    car.company_response = None
    car.response_received_at = None
    db.commit()
    return _car_out(car)


@router.post("/assignments/{assignment_id}/cars/{car_id}/ai-assess-response")
async def ai_assess_car_response(assignment_id: UUID, car_id: UUID,
                                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    """AI pre-assessment of a company's CAR response."""
    car = db.query(ReviewerCAR).filter(
        ReviewerCAR.id == car_id, ReviewerCAR.assignment_id == assignment_id
    ).first()
    if not car:
        raise HTTPException(404, "CAR not found")
    if not car.company_response:
        raise HTTPException(400, "No company response received yet")
    try:
        from app.engines.ai.claude_client import call_claude_json
        system = "You are a carbon credit verification expert. Respond with valid JSON only."
        prompt = f"""Assess whether this company response adequately addresses the CAR.

CAR: {car.car_number} ({car.severity})
Finding: {car.finding_description}
Requirement: {car.requirement_reference or 'N/A'}
Company response: {car.company_response}

Return JSON:
{{
  "verdict": "adequate|partially_adequate|inadequate",
  "confidence_pct": 0-100,
  "rationale": "2-3 sentence assessment",
  "outstanding_issues": ["list any gaps still not addressed"]
}}"""
        result = await call_claude_json(system, prompt, max_tokens=400, timeout=35)
        if result:
            car.ai_response_assessment = result
            db.commit()
        return result or {"verdict": "needs_review", "rationale": "AI assessment unavailable."}
    except Exception as e:
        raise HTTPException(503, f"AI assessment failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Verification Statements
# ─────────────────────────────────────────────────────────────────────────────

def _statement_out(s: ReviewerVerificationStatement) -> dict:
    return {
        "id": str(s.id),
        "assignment_id": str(s.assignment_id),
        "assurance_level": s.assurance_level,
        "overall_conclusion": s.overall_conclusion,
        "conditions": s.conditions or [],
        "credit_quantity_claimed": s.credit_quantity_claimed,
        "credit_quantity_reviewer_estimate": s.credit_quantity_reviewer_estimate,
        "material_difference_pct": s.material_difference_pct,
        "credit_quantity_narrative": s.credit_quantity_narrative,
        "additionality_conclusion": s.additionality_conclusion,
        "additionality_narrative": s.additionality_narrative,
        "permanence_conclusion": s.permanence_conclusion,
        "permanence_narrative": s.permanence_narrative,
        "statement_text": s.statement_text,
        "ai_draft_used": s.ai_draft_used,
        "signed_by_name": s.signed_by_name,
        "signed_at": s.signed_at.isoformat() if s.signed_at else None,
        "countersigned_by_name": s.countersigned_by_name,
        "countersigned_at": s.countersigned_at.isoformat() if s.countersigned_at else None,
        "signature_hash": s.signature_hash,
        "submitted_to_registry_at": s.submitted_to_registry_at.isoformat() if s.submitted_to_registry_at else None,
        "registry_ref_number": s.registry_ref_number,
        "registry_decision": s.registry_decision,
        "registry_decision_at": s.registry_decision_at.isoformat() if s.registry_decision_at else None,
        "public_disclosure_required": s.public_disclosure_required,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.post("/assignments/{assignment_id}/statement")
def create_or_update_statement(assignment_id: UUID, data: dict,
                                db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    s = db.query(ReviewerVerificationStatement).filter(
        ReviewerVerificationStatement.assignment_id == assignment_id
    ).first()
    if not s:
        s = ReviewerVerificationStatement(assignment_id=assignment_id)
        db.add(s)
    for field in ["assurance_level", "overall_conclusion", "conditions",
                  "credit_quantity_claimed", "credit_quantity_reviewer_estimate",
                  "material_difference_pct", "credit_quantity_narrative",
                  "additionality_conclusion", "additionality_narrative",
                  "permanence_conclusion", "permanence_narrative",
                  "statement_text", "ai_draft_used", "public_disclosure_required"]:
        if field in data:
            setattr(s, field, data[field])
    db.commit()
    db.refresh(s)
    return _statement_out(s)


@router.get("/assignments/{assignment_id}/statement")
def get_statement(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    s = db.query(ReviewerVerificationStatement).filter(
        ReviewerVerificationStatement.assignment_id == assignment_id
    ).first()
    if not s:
        return None
    return _statement_out(s)


@router.post("/assignments/{assignment_id}/statement/ai-draft")
async def ai_draft_statement(assignment_id: UUID,
                              db: Session = Depends(get_db), user=Depends(get_current_user)):
    """AI drafts the full verification statement from structured review data."""
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found")
    s = db.query(ReviewerVerificationStatement).filter(
        ReviewerVerificationStatement.assignment_id == assignment_id
    ).first()
    plan = db.query(ReviewerVerificationPlan).filter(
        ReviewerVerificationPlan.assignment_id == assignment_id
    ).first()
    cars = db.query(ReviewerCAR).filter(ReviewerCAR.assignment_id == assignment_id).all()
    closed_cars = [c for c in cars if c.status == "closed"]
    try:
        from app.engines.ai.claude_client import call_claude
        system = "You are a senior carbon credit verifier writing a formal verification statement."
        prompt = f"""Draft a formal Verification Statement for:

PROJECT: {a.project_name}
COMPANY: {a.company_name}
METHODOLOGY: {a.methodology_code} {a.methodology_version or ''}
CREDIT TYPE: {a.credit_type} | VINTAGE: {a.vintage_year} | COUNTRY: {a.country}
CREDITS CLAIMED: {a.credit_quantity_claimed} tCO2e
ASSURANCE LEVEL: {a.assurance_level}

PLAN SUMMARY: Risk level {plan.risk_level if plan else 'medium'}, threshold {plan.materiality_threshold_pct if plan else 5}%

CARS ISSUED: {len(cars)} total, {len(closed_cars)} closed
CONCLUSION: {s.overall_conclusion or 'TBD'}
ADDITIONALITY: {s.additionality_conclusion or 'TBD'}
PERMANENCE: {s.permanence_conclusion or 'TBD'}
CREDIT QTY ESTIMATE: {s.credit_quantity_reviewer_estimate or 'TBD'} tCO2e

Write a formal 400-500 word verification statement covering:
1. Scope and objective
2. Methodology and approach
3. Evidence reviewed
4. Key findings and CAR summary
5. Credit quantity determination
6. Additionality and permanence conclusions
7. Overall verification conclusion
Use professional, formal language appropriate for registry submission."""
        draft = await call_claude(system, prompt, max_tokens=1500, timeout=90)
        if s and draft:
            s.statement_text = draft
            s.ai_draft_used = True
            db.commit()
        return {"draft": draft or "AI draft unavailable — please draft manually."}
    except Exception as e:
        return {"draft": f"AI draft failed: {e}"}


@router.post("/assignments/{assignment_id}/statement/sign")
def sign_statement(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Lead verifier signs the verification statement."""
    s = db.query(ReviewerVerificationStatement).filter(
        ReviewerVerificationStatement.assignment_id == assignment_id
    ).first()
    if not s:
        raise HTTPException(404, "Statement not created yet")
    if not s.statement_text or not s.overall_conclusion:
        raise HTTPException(400, "Statement is incomplete — add text and conclusion before signing")
    if s.signed_at:
        raise HTTPException(409, "Statement already signed")
    s.signed_by = user.id
    s.signed_by_name = getattr(user, "full_name", None) or str(getattr(user, "email", ""))
    s.signed_at = datetime.utcnow()
    db.commit()
    return {"message": "Statement signed", "signed_by": s.signed_by_name, "signed_at": s.signed_at.isoformat()}


@router.post("/assignments/{assignment_id}/statement/countersign")
def countersign_statement(assignment_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Second reviewer countersigns — generates integrity hash."""
    s = db.query(ReviewerVerificationStatement).filter(
        ReviewerVerificationStatement.assignment_id == assignment_id
    ).first()
    if not s:
        raise HTTPException(404, "Statement not found")
    if not s.signed_at:
        raise HTTPException(400, "Statement must be signed before countersigning")
    if s.countersigned_at:
        raise HTTPException(409, "Already countersigned")
    if str(user.id) == str(s.signed_by):
        raise HTTPException(409, "Countersigner must be a different person from the lead signer")
    now = datetime.utcnow()
    content = f"{assignment_id}:{s.overall_conclusion}:{s.signed_at.isoformat()}:{s.signed_by_name}:{now.isoformat()}"
    sig = hashlib.sha256(content.encode()).hexdigest()
    s.countersigned_by = user.id
    s.countersigned_by_name = getattr(user, "full_name", None) or str(getattr(user, "email", ""))
    s.countersigned_at = now
    s.signature_hash = sig
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if a:
        a.status = "statement_signed"
    db.commit()
    return {"message": "Statement countersigned", "signature_hash": sig}


@router.post("/assignments/{assignment_id}/statement/submit")
async def submit_statement(assignment_id: UUID,
                           db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Submit the verified statement to the registry."""
    s = db.query(ReviewerVerificationStatement).filter(
        ReviewerVerificationStatement.assignment_id == assignment_id
    ).first()
    a = db.query(ReviewerAssignment).filter(ReviewerAssignment.id == assignment_id).first()
    if not s or not a:
        raise HTTPException(404, "Statement or assignment not found")
    if not s.countersigned_at:
        raise HTTPException(400, "Statement must be countersigned before submission")
    connector_config = db.query(RegistryConnector).filter(
        RegistryConnector.slug == a.registry_slug,
        RegistryConnector.is_active == True,
    ).first()
    payload = {
        "project_ref": a.registry_project_ref,
        "conclusion": s.overall_conclusion,
        "credit_quantity_estimate": s.credit_quantity_reviewer_estimate,
        "additionality": s.additionality_conclusion,
        "permanence": s.permanence_conclusion,
        "statement_text": s.statement_text,
        "signature_hash": s.signature_hash,
        "signed_by": s.signed_by_name,
        "countersigned_by": s.countersigned_by_name,
    }
    if connector_config:
        try:
            from app.integrations.isometric import get_connector
            conn = get_connector(a.registry_slug, {
                "base_url": connector_config.base_url,
                "api_key": connector_config.api_key,
                "api_version": connector_config.api_version,
                "sandbox_mode": connector_config.sandbox_mode,
            })
            result = await conn.submit_verification_statement(a.registry_assignment_ref or str(a.id), payload)
            s.registry_ref_number = result.get("ref") or result.get("id")
        except Exception as e:
            logger.warning("Registry submission failed (storing locally): %s", e)
    s.submitted_to_registry_at = datetime.utcnow()
    s.submitted_by = user.id
    a.status = "submitted"
    db.commit()
    _log_event(db, registry_slug=a.registry_slug, direction="outbound",
               event_type="statement.submitted", assignment_id=a.id, payload=payload)
    return {"message": "Statement submitted", "registry_ref": s.registry_ref_number}


@router.get("/statements")
def list_all_statements(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Archive of all verification statements."""
    statements = db.query(ReviewerVerificationStatement).order_by(
        ReviewerVerificationStatement.created_at.desc()
    ).all()
    return [_statement_out(s) for s in statements]


# ─────────────────────────────────────────────────────────────────────────────
# Integration Hub — Events & Webhooks
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/integration/events")
def list_integration_events(limit: int = 100, db: Session = Depends(get_db), user=Depends(get_current_user)):
    events = db.query(ReviewerIntegrationEvent).order_by(
        ReviewerIntegrationEvent.created_at.desc()
    ).limit(limit).all()
    return [
        {
            "id": str(e.id),
            "registry_slug": e.registry_slug,
            "direction": e.direction,
            "event_type": e.event_type,
            "assignment_id": str(e.assignment_id) if e.assignment_id else None,
            "status": e.status,
            "error_message": e.error_message,
            "retry_count": e.retry_count,
            "created_at": e.created_at.isoformat() if e.created_at else None,
            "delivered_at": e.delivered_at.isoformat() if e.delivered_at else None,
        }
        for e in events
    ]


@router.post("/integration/webhook/{registry_slug}")
async def receive_webhook(registry_slug: str, request: Request,
                          background_tasks: BackgroundTasks,
                          db: Session = Depends(get_db)):
    """
    Inbound webhook receiver — accepts events from any registry.
    No auth required (verified by webhook signature).
    """
    body = await request.body()
    sig = request.headers.get("x-webhook-signature", "")
    connector_config = db.query(RegistryConnector).filter(
        RegistryConnector.slug == registry_slug,
        RegistryConnector.is_active == True,
    ).first()
    if connector_config and connector_config.webhook_secret:
        try:
            from app.integrations.isometric import get_connector
            conn = get_connector(registry_slug, {"webhook_secret": connector_config.webhook_secret})
            if not conn.verify_webhook(body, sig):
                raise HTTPException(401, "Invalid webhook signature")
        except ValueError:
            pass  # connector not implemented yet — accept anyway
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")
    event_type = payload.get("event") or payload.get("type", "unknown")
    ev = ReviewerIntegrationEvent(
        registry_slug=registry_slug,
        direction="inbound",
        event_type=event_type,
        payload=payload,
        status="delivered",
        delivered_at=datetime.utcnow(),
    )
    db.add(ev)
    db.commit()
    # Handle known event types
    background_tasks.add_task(_handle_webhook_event, registry_slug, event_type, payload)
    return {"received": True, "event": event_type}


def _handle_webhook_event(registry_slug: str, event_type: str, payload: dict):
    """Process inbound webhook events asynchronously."""
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        if event_type in ("project.assigned", "verification.assigned"):
            # Auto-create an assignment record
            from app.integrations.base import RegistryConnectorBase
            normalised = RegistryConnectorBase._normalise_assignment(payload.get("data") or payload)
            existing = db.query(ReviewerAssignment).filter(
                ReviewerAssignment.registry_assignment_ref == normalised.get("registry_assignment_ref"),
                ReviewerAssignment.registry_slug == registry_slug,
            ).first()
            if not existing:
                a = ReviewerAssignment(registry_slug=registry_slug, **{
                    k: v for k, v in normalised.items()
                    if hasattr(ReviewerAssignment, k) and k != "raw_payload"
                })
                a.raw_payload = normalised.get("raw_payload", payload)
                a.status = "pending"
                db.add(a)
                db.commit()
        elif event_type in ("car.response_submitted", "car.response"):
            car_ref = payload.get("car_id") or payload.get("car_ref")
            response_text = payload.get("response") or payload.get("response_text", "")
            if car_ref:
                car = db.query(ReviewerCAR).filter(
                    ReviewerCAR.registry_car_ref == car_ref
                ).first()
                if car:
                    car.company_response = response_text
                    car.response_received_at = datetime.utcnow()
                    car.status = "response_received"
                    db.commit()
    except Exception as e:
        logger.error("Webhook event handling failed (%s): %s", event_type, e)
    finally:
        db.close()


@router.post("/integration/test/{registry_slug}")
async def test_registry_connection_by_slug(
    registry_slug: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Test connectivity to a registry by slug.
    Attempts a real API call (fetch pending assignments) and returns
    latency, status, and any error detail so the UI can show a clear result.
    """
    import time
    connector_config = db.query(RegistryConnector).filter(
        RegistryConnector.slug == registry_slug,
    ).first()
    if not connector_config:
        raise HTTPException(404, f"No connector found for registry '{registry_slug}'")

    start = time.monotonic()
    try:
        from app.integrations.isometric import get_connector
        conn = get_connector(registry_slug, {
            "base_url":      connector_config.base_url,
            "api_key":       connector_config.api_key,
            "api_version":   connector_config.api_version,
            "sandbox_mode":  connector_config.sandbox_mode,
        })
        assignments = await conn.fetch_pending_assignments()
        latency_ms = int((time.monotonic() - start) * 1000)
        return {
            "status":              "ok",
            "message":             "Connection successful",
            "registry":            connector_config.name,
            "sandbox":             connector_config.sandbox_mode,
            "pending_assignments": len(assignments),
            "latency_ms":          latency_ms,
            "base_url":            connector_config.base_url,
        }
    except ValueError as e:
        return {"status": "not_implemented", "message": str(e)}
    except Exception as e:
        latency_ms = int((time.monotonic() - start) * 1000)
        return {
            "status":      "error",
            "message":     str(e),
            "latency_ms":  latency_ms,
        }


@router.post("/integration/sync/{registry_slug}")
async def sync_from_registry(registry_slug: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Manually poll registry for new assignments (fallback when webhooks aren't available).
    """
    connector_config = db.query(RegistryConnector).filter(
        RegistryConnector.slug == registry_slug,
        RegistryConnector.is_active == True,
    ).first()
    if not connector_config:
        raise HTTPException(404, f"No active connector for registry '{registry_slug}'")
    try:
        from app.integrations.isometric import get_connector
        conn = get_connector(registry_slug, {
            "base_url": connector_config.base_url,
            "api_key": connector_config.api_key,
            "api_version": connector_config.api_version,
            "sandbox_mode": connector_config.sandbox_mode,
        })
        assignments = await conn.fetch_pending_assignments()
        created = 0
        for a_data in assignments:
            existing = db.query(ReviewerAssignment).filter(
                ReviewerAssignment.registry_assignment_ref == a_data.get("registry_assignment_ref"),
                ReviewerAssignment.registry_slug == registry_slug,
            ).first()
            if not existing:
                a = ReviewerAssignment(registry_slug=registry_slug, status="pending")
                for k, v in a_data.items():
                    if hasattr(ReviewerAssignment, k):
                        setattr(a, k, v)
                db.add(a)
                created += 1
        db.commit()
        _log_event(db, registry_slug=registry_slug, direction="inbound",
                   event_type="sync.completed", payload={"new_assignments": created})
        return {"synced": True, "new_assignments": created, "total_found": len(assignments)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(503, f"Registry sync failed: {e}")
