"""
Reviewer Platform — Data Models
Completely isolated from existing VV/DQA tables.
All tables prefixed `reviewer_` or `registry_`.
"""
import uuid
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Integer, String, Text
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func
from app.core.database import Base


# ── Registry Connectors (multi-registry API config) ────────────────────────

class RegistryConnector(Base):
    __tablename__ = 'registry_connectors'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name            = Column(String(200), nullable=False)          # "Isometric", "Puro.Earth"
    slug            = Column(String(50),  nullable=False, unique=True)  # "isometric", "puro_earth"
    base_url        = Column(String(500), nullable=False)
    api_version     = Column(String(20),  default='v1')
    auth_type       = Column(String(30),  default='api_key')       # api_key / oauth2 / bearer
    api_key         = Column(Text,        nullable=True)            # encrypted at rest in ECS secrets
    client_id       = Column(String(200), nullable=True)           # for OAuth2
    client_secret   = Column(Text,        nullable=True)           # for OAuth2
    webhook_secret  = Column(String(200), nullable=True)           # for verifying inbound webhooks
    webhook_url     = Column(String(500), nullable=True)           # our inbound endpoint URL
    supported_events = Column(JSONB, default=list)                 # ["project.assigned", "car.response"]
    is_active       = Column(Boolean, default=True)
    sandbox_mode    = Column(Boolean, default=False)
    notes           = Column(Text, nullable=True)
    created_by      = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())


# ── Reviewer Assignments ────────────────────────────────────────────────────

class ReviewerAssignment(Base):
    __tablename__ = 'reviewer_assignments'
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Registry linkage
    registry_slug       = Column(String(50), nullable=False)       # "isometric"
    registry_assignment_ref = Column(String(200), nullable=True)   # registry's own reference ID
    registry_project_ref    = Column(String(200), nullable=True)   # registry project ID
    # Project metadata (received from registry)
    project_name        = Column(String(500), nullable=False)
    company_name        = Column(String(300), nullable=True)
    company_id          = Column(String(200), nullable=True)        # registry company ID
    methodology_code    = Column(String(100), nullable=True)
    methodology_version = Column(String(50),  nullable=True)
    credit_type         = Column(String(100), nullable=True)        # "carbon_removal", "avoided"
    vintage_year        = Column(Integer, nullable=True)
    country             = Column(String(100), nullable=True)
    credit_quantity_claimed = Column(Integer, nullable=True)        # tCO2e claimed by company
    # Assignment management
    assigned_to         = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    assigned_at         = Column(DateTime(timezone=True), nullable=True)
    deadline            = Column(DateTime(timezone=True), nullable=True)
    assurance_level     = Column(String(30), default='reasonable')  # reasonable / limited
    status              = Column(String(30), default='pending')
    # pending / accepted / active / coi_declared / planning /
    # document_review / checkpoint_review / car_issued / car_closed /
    # opinion_drafted / statement_signed / submitted / complete / declined
    decline_reason      = Column(Text, nullable=True)
    # Document package
    document_package_ref = Column(String(500), nullable=True)      # URL or registry ref to docs
    document_package_received_at = Column(DateTime(timezone=True), nullable=True)
    # Bridge to V&V Platform — auto-created on assignment acceptance
    vv_project_id       = Column(UUID(as_uuid=True), nullable=True)
    # Timestamps
    accepted_at         = Column(DateTime(timezone=True), nullable=True)
    completed_at        = Column(DateTime(timezone=True), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), onupdate=func.now())
    # Raw payload from registry
    raw_payload         = Column(JSONB, default=dict)


# ── Conflict of Interest Declarations ──────────────────────────────────────

class ReviewerCoiDeclaration(Base):
    __tablename__ = 'reviewer_coi_declarations'
    id                      = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id           = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False)
    reviewer_id             = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False)
    no_financial_interest   = Column(Boolean, nullable=False)
    no_prior_engagement     = Column(Boolean, nullable=False)
    no_personal_relationship = Column(Boolean, nullable=False)
    no_competitive_interest = Column(Boolean, nullable=False)
    additional_disclosures  = Column(Text, nullable=True)
    declaration_text        = Column(Text, nullable=True)          # full text reviewed
    signature_hash          = Column(String(64), nullable=True)    # SHA-256 of declaration content
    declared_at             = Column(DateTime(timezone=True), server_default=func.now())


# ── Review Teams ────────────────────────────────────────────────────────────

class ReviewerTeamMember(Base):
    __tablename__ = 'reviewer_teams'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id   = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False)
    reviewer_id     = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False)
    role            = Column(String(30), default='technical')      # lead / technical / peer_reviewer
    disciplines     = Column(JSONB, default=list)                  # ["carbon_accounting", "forestry"]
    joined_at       = Column(DateTime(timezone=True), server_default=func.now())


# ── Verification Plans ──────────────────────────────────────────────────────

class ReviewerVerificationPlan(Base):
    __tablename__ = 'reviewer_verification_plans'
    id                      = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id           = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False, unique=True)
    assurance_level         = Column(String(30), default='reasonable')
    methodology_version     = Column(String(50), nullable=True)
    risk_level              = Column(String(20), default='medium')  # low / medium / high
    risk_assessment_notes   = Column(Text, nullable=True)
    materiality_threshold_pct = Column(Integer, default=5)
    in_scope_checkpoints    = Column(JSONB, default=list)
    out_of_scope_reasons    = Column(JSONB, default=dict)          # {checkpoint_code: reason}
    site_visit_required     = Column(Boolean, default=False)
    site_visit_type         = Column(String(20), nullable=True)    # physical / remote
    planned_site_visit_dates = Column(JSONB, default=list)
    milestone_dates         = Column(JSONB, default=dict)
    # {doc_review_complete, cars_issued, responses_due, opinion_issued}
    plan_document_path      = Column(String(1000), nullable=True)  # S3 key of generated PDF
    ai_draft_used           = Column(Boolean, default=False)
    approved_by             = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    approved_at             = Column(DateTime(timezone=True), nullable=True)
    created_at              = Column(DateTime(timezone=True), server_default=func.now())
    updated_at              = Column(DateTime(timezone=True), onupdate=func.now())


# ── Document Pre-screen Results ─────────────────────────────────────────────

class ReviewerPreScreen(Base):
    __tablename__ = 'reviewer_pre_screens'
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id       = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False)
    completeness_result = Column(JSONB, default=dict)  # {present: [], missing: [], pct: 0}
    plausibility_result = Column(JSONB, default=dict)  # {flags: [], overall_risk: "low/medium/high"}
    authenticity_result = Column(JSONB, default=dict)  # {checks: [], issues: []}
    ai_summary          = Column(Text, nullable=True)
    risk_priority_map   = Column(JSONB, default=dict)  # {checkpoint_code: risk_level}
    run_at              = Column(DateTime(timezone=True), server_default=func.now())
    run_by              = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)


# ── Checkpoint Evidence Links ───────────────────────────────────────────────

class ReviewerCheckpointEvidence(Base):
    __tablename__ = 'reviewer_checkpoint_evidence'
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id       = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False)
    checkpoint_code     = Column(String(100), nullable=False)
    document_name       = Column(String(500), nullable=True)       # document filename/ref
    document_registry_ref = Column(String(200), nullable=True)     # registry doc ID
    document_section    = Column(Text, nullable=True)              # page/section/clause reference
    extracted_excerpt   = Column(Text, nullable=True)              # relevant text
    reviewer_note       = Column(Text, nullable=True)
    linked_by           = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    linked_at           = Column(DateTime(timezone=True), server_default=func.now())


# ── Checkpoint Assessments ──────────────────────────────────────────────────

class ReviewerCheckpointAssessment(Base):
    __tablename__ = 'reviewer_checkpoint_assessments'
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id       = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False)
    checkpoint_code     = Column(String(100), nullable=False)
    checkpoint_label    = Column(String(500), nullable=True)
    status              = Column(String(30), default='pending')
    # pending / pass / minor_finding / major_finding / critical_finding / not_applicable
    reviewer_judgment   = Column(Text, nullable=True)
    ai_pre_assessment   = Column(JSONB, default=dict)  # {status, confidence, rationale, evidence_refs}
    ai_pre_assessment_used = Column(Boolean, default=False)
    assessed_by         = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    assessed_at         = Column(DateTime(timezone=True), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), onupdate=func.now())


# ── Site Visits ─────────────────────────────────────────────────────────────

class ReviewerSiteVisit(Base):
    __tablename__ = 'reviewer_site_visits'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id   = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False)
    visit_type      = Column(String(20), default='remote')         # physical / remote
    visit_date      = Column(DateTime(timezone=True), nullable=True)
    duration_hours  = Column(Integer, nullable=True)
    location        = Column(String(300), nullable=True)
    participants    = Column(JSONB, default=list)                   # [{name, role, organisation}]
    agenda          = Column(Text, nullable=True)
    observations    = Column(Text, nullable=True)
    action_items    = Column(JSONB, default=list)
    attachments     = Column(JSONB, default=list)                   # [{name, path}]
    logged_by       = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    logged_at       = Column(DateTime(timezone=True), server_default=func.now())


# ── Stakeholder Interviews ──────────────────────────────────────────────────

class ReviewerInterview(Base):
    __tablename__ = 'reviewer_interviews'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id   = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False)
    interview_date  = Column(DateTime(timezone=True), nullable=True)
    interview_type  = Column(String(20), default='remote')         # in_person / remote / written
    interviewees    = Column(JSONB, default=list)                   # [{name, role, organisation}]
    topics          = Column(JSONB, default=list)
    key_points      = Column(Text, nullable=True)
    follow_up_items = Column(JSONB, default=list)
    logged_by       = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    logged_at       = Column(DateTime(timezone=True), server_default=func.now())


# ── Reviewer CARs ───────────────────────────────────────────────────────────

class ReviewerCAR(Base):
    __tablename__ = 'reviewer_cars'
    id                      = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id           = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False)
    car_number              = Column(String(30), nullable=False)    # e.g. "CAR-001"
    checkpoint_code         = Column(String(100), nullable=True)
    severity                = Column(String(30), nullable=False)    # critical / major / minor / observation
    finding_description     = Column(Text, nullable=False)
    requirement_reference   = Column(String(500), nullable=True)   # methodology clause
    ai_draft_used           = Column(Boolean, default=False)
    # Registry bridge
    registry_car_ref        = Column(String(200), nullable=True)   # registry's CAR ID
    registry_submitted_at   = Column(DateTime(timezone=True), nullable=True)
    # Response cycle
    status                  = Column(String(30), default='draft')
    # draft / issued / response_received / response_accepted / response_rejected / closed
    company_response        = Column(Text, nullable=True)
    response_documents      = Column(JSONB, default=list)
    response_received_at    = Column(DateTime(timezone=True), nullable=True)
    # AI assessment of response
    ai_response_assessment  = Column(JSONB, default=dict)
    # {verdict: adequate/partial/inadequate, rationale, confidence_pct}
    # Closure
    reviewer_determination  = Column(String(20), nullable=True)    # accept / reject / escalate
    determination_note      = Column(Text, nullable=True)
    escalated_severity      = Column(String(30), nullable=True)    # if escalated
    closed_by               = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    closed_at               = Column(DateTime(timezone=True), nullable=True)
    # Metadata
    issued_by               = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    issued_by_name          = Column(String(300), nullable=True)
    issued_at               = Column(DateTime(timezone=True), nullable=True)
    created_at              = Column(DateTime(timezone=True), server_default=func.now())
    updated_at              = Column(DateTime(timezone=True), onupdate=func.now())


# ── Verification Statements ─────────────────────────────────────────────────

class ReviewerVerificationStatement(Base):
    __tablename__ = 'reviewer_verification_statements'
    id                          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id               = Column(UUID(as_uuid=True), ForeignKey('reviewer_assignments.id', ondelete='CASCADE'), nullable=False, unique=True)
    assurance_level             = Column(String(30), nullable=True)
    overall_conclusion          = Column(String(50), nullable=True)
    # verified / verified_with_conditions / not_verified
    conditions                  = Column(JSONB, default=list)
    # Credit quantity
    credit_quantity_claimed     = Column(Integer, nullable=True)
    credit_quantity_reviewer_estimate = Column(Integer, nullable=True)
    material_difference_pct     = Column(Integer, nullable=True)
    credit_quantity_narrative   = Column(Text, nullable=True)
    # Additionality
    additionality_conclusion    = Column(String(30), nullable=True)  # demonstrated / not_demonstrated
    additionality_narrative     = Column(Text, nullable=True)
    # Permanence
    permanence_conclusion       = Column(String(30), nullable=True)
    permanence_narrative        = Column(Text, nullable=True)
    # Full statement
    statement_text              = Column(Text, nullable=True)         # AI-drafted then edited
    document_path               = Column(String(1000), nullable=True) # S3 key of final PDF
    ai_draft_used               = Column(Boolean, default=False)
    # Signatures
    signed_by                   = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    signed_by_name              = Column(String(300), nullable=True)
    signed_at                   = Column(DateTime(timezone=True), nullable=True)
    countersigned_by            = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    countersigned_by_name       = Column(String(300), nullable=True)
    countersigned_at            = Column(DateTime(timezone=True), nullable=True)
    signature_hash              = Column(String(64), nullable=True)
    # Registry submission
    submitted_to_registry_at    = Column(DateTime(timezone=True), nullable=True)
    submitted_by                = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    registry_ref_number         = Column(String(200), nullable=True)
    registry_decision           = Column(String(50), nullable=True)   # credits_issued / partial / denied
    registry_decision_at        = Column(DateTime(timezone=True), nullable=True)
    registry_response_payload   = Column(JSONB, default=dict)
    public_disclosure_required  = Column(Boolean, default=False)
    created_at                  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at                  = Column(DateTime(timezone=True), onupdate=func.now())


# ── Integration Events (audit trail for all registry/DMRV events) ───────────

class ReviewerIntegrationEvent(Base):
    __tablename__ = 'reviewer_integration_events'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    registry_slug   = Column(String(50), nullable=True)
    direction       = Column(String(10), nullable=False)           # inbound / outbound
    event_type      = Column(String(100), nullable=False)
    # project.assigned / car.response_received / car.issued / statement.submitted / etc.
    assignment_id   = Column(UUID(as_uuid=True), nullable=True)    # if linked to an assignment
    payload         = Column(JSONB, default=dict)
    status          = Column(String(20), default='pending')        # pending / delivered / failed
    error_message   = Column(Text, nullable=True)
    retry_count     = Column(Integer, default=0)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    delivered_at    = Column(DateTime(timezone=True), nullable=True)
