"""
DataSentinel V&V Platform — Database Models
Third-Party Verification & Validation for Carbon Registries
"""
import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import deferred, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Registry(Base):
    __tablename__ = 'registries'
    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name          = Column(String(100), nullable=False)      # e.g. "Puro.Earth"
    slug          = Column(String(50), unique=True)           # e.g. "puro_earth"
    logo_url      = Column(String(500))
    website       = Column(String(500))
    description   = Column(Text)
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    methodologies = relationship('Methodology', back_populates='registry')
    projects      = relationship('VVProject', back_populates='registry')


class Methodology(Base):
    __tablename__ = 'methodologies'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    registry_id     = Column(UUID(as_uuid=True), ForeignKey('registries.id'))
    name            = Column(String(200), nullable=False)
    code            = Column(String(100))                   # e.g. "PURO-BIOCHAR-V2"
    version         = Column(String(20))
    description     = Column(Text)
    checkpoints     = Column(JSONB, default=list)           # list of checkpoint definitions
    is_active       = Column(Boolean, default=True)
    registry        = relationship('Registry', back_populates='methodologies')
    projects        = relationship('VVProject', back_populates='methodology')


class VVProject(Base):
    __tablename__ = 'vv_projects'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name            = Column(String(300), nullable=False)
    description     = Column(Text)
    registry_id     = Column(UUID(as_uuid=True), ForeignKey('registries.id'))
    methodology_id  = Column(UUID(as_uuid=True), ForeignKey('methodologies.id'))
    project_developer = Column(String(300))
    location        = Column(String(300))
    vintage_year    = Column(Integer)
    submission_deadline = Column(DateTime(timezone=True), nullable=True)
    status          = Column(String(50), default='submitted')  # submitted/under_review/verified/rejected
    assigned_verifier = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    created_by      = Column(UUID(as_uuid=True), ForeignKey('users.id'))
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), onupdate=func.now())
    # Feature toggles — which tabs/capabilities are enabled for this project.
    # NULL means all enabled (backward-compatible with existing projects).
    # Auto-created projects from Reviewer Platform always have all enabled + locked.
    features_enabled     = Column(JSONB, nullable=True)
    # Back-reference to the Reviewer Platform assignment (if any).
    # When set, feature toggles are locked and cannot be changed.
    reviewer_assignment_id = Column(UUID(as_uuid=True), nullable=True)
    # Deferred: not included in default SELECT — safe before migration runs
    last_consistency_result  = deferred(Column(JSONB, nullable=True))
    last_consistency_run_at  = deferred(Column(DateTime(timezone=True), nullable=True))
    last_analysis_result     = deferred(Column(JSONB, nullable=True))
    last_analysis_run_at     = deferred(Column(DateTime(timezone=True), nullable=True))
    # Phase 2: Credit quantity calculation
    credit_quantity_result   = deferred(Column(JSONB, nullable=True))
    credit_quantity_run_at   = deferred(Column(DateTime(timezone=True), nullable=True))
    # Phase 3: Additionality & permanence
    additionality_result     = deferred(Column(JSONB, nullable=True))
    additionality_run_at     = deferred(Column(DateTime(timezone=True), nullable=True))
    permanence_result        = deferred(Column(JSONB, nullable=True))
    permanence_run_at        = deferred(Column(DateTime(timezone=True), nullable=True))
    registry        = relationship('Registry', back_populates='projects')
    methodology     = relationship('Methodology', back_populates='projects')
    documents       = relationship('VVDocument', back_populates='project')
    checkpoints     = relationship('VVCheckpoint', back_populates='project')
    reports         = relationship('VVReport', back_populates='project')


class VVDocument(Base):
    __tablename__ = 'vv_documents'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id      = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'))
    name            = Column(String(500))
    file_type       = Column(String(50))        # csv/xlsx/pdf/json
    document_type   = Column(String(100))       # monitoring_data/lab_report/chain_of_custody/etc
    storage_path    = Column(String(1000))
    file_size       = Column(Integer)
    status          = Column(String(50), default='uploaded')  # uploaded/processing/processed/error
    extracted_data  = Column(JSONB, default=dict)             # AI-extracted key-value pairs
    extraction_summary = Column(Text)                          # AI summary of document content
    row_count       = Column(Integer)
    column_count    = Column(Integer)
    uploaded_by     = Column(UUID(as_uuid=True), ForeignKey('users.id'))
    uploaded_at     = Column(DateTime(timezone=True), server_default=func.now())
    processed_at    = Column(DateTime(timezone=True), nullable=True)
    # V6: Document lifecycle
    expiry_date     = Column(DateTime(timezone=True), nullable=True)
    review_status   = Column(String(50), default='draft')  # draft/under_review/approved/rejected
    review_notes    = Column(Text)
    reviewed_by_name = Column(String(300))
    reviewed_at     = Column(DateTime(timezone=True), nullable=True)
    signed_off_by   = Column(String(200))
    signed_off_at   = Column(DateTime(timezone=True), nullable=True)
    is_deleted      = Column(Boolean, default=False)
    deleted_at      = Column(DateTime(timezone=True), nullable=True)
    deleted_by_name = Column(String(300))
    validation_result = Column(JSONB)           # AI content validation result
    # V7: Document version history — deferred: safe before migration 0009 runs
    doc_version     = deferred(Column(Integer, nullable=True))
    version_history = deferred(Column(JSONB, nullable=True))
    project         = relationship('VVProject', back_populates='documents')
    comments        = relationship('VVDocumentComment', back_populates='document', lazy='dynamic')


class VVAuditLog(Base):
    __tablename__ = 'vv_audit_log'
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id  = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'), nullable=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey('vv_documents.id'), nullable=True)
    actor_id    = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    actor_name  = Column(String(300))
    action      = Column(String(100), nullable=False)  # uploaded/deleted/review_status_changed/validated/etc
    log_data    = Column('metadata', JSONB, default=dict)  # named 'metadata' in DB; renamed to avoid SQLAlchemy Base.metadata clash
    created_at  = Column(DateTime(timezone=True), server_default=func.now())


class VVDocumentComment(Base):
    __tablename__ = 'vv_document_comments'
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey('vv_documents.id'), nullable=False)
    project_id  = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'), nullable=True)
    author_id   = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    author_name = Column(String(300))
    body        = Column(Text, nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    document    = relationship('VVDocument', back_populates='comments')


class VVNotificationPreference(Base):
    __tablename__ = 'vv_notification_preferences'
    id                    = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id               = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=False, unique=True)
    email                 = Column(String(300))
    on_document_uploaded  = Column(Boolean, default=True)
    on_expiry_warning     = Column(Boolean, default=True)
    on_status_change      = Column(Boolean, default=True)
    on_consistency_check  = Column(Boolean, default=True)
    on_validation_complete = Column(Boolean, default=False)
    updated_at            = Column(DateTime(timezone=True), server_default=func.now())


class VVCheckpoint(Base):
    __tablename__ = 'vv_checkpoints'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id      = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'))
    checkpoint_id   = Column(String(50))        # e.g. "PURO-B-01"
    category        = Column(String(100))        # Eligibility/Monitoring/Documentation/etc
    name            = Column(String(300))
    description     = Column(Text)
    requirement     = Column(Text)              # what the registry requires
    status          = Column(String(50), default='pending')  # pending/passed/failed/warning/na
    ai_finding      = Column(Text)              # AI analysis result
    ai_confidence   = Column(Float)             # 0-1
    ai_evidence     = Column(JSONB, default=list)  # list of {doc_id, excerpt, page}
    verifier_status  = Column(String(50))        # verifier override: passed/failed/na
    verifier_note    = Column(Text)
    # Deferred: added in migration 0013 — safe before that migration runs
    finding_severity = deferred(Column(String(20), nullable=True, server_default='none'))
    reviewed_by      = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    reviewed_at      = Column(DateTime(timezone=True), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    project          = relationship('VVProject', back_populates='checkpoints')


class VVCar(Base):
    """Corrective Action Request — formal findings that must be resolved before credit issuance."""
    __tablename__ = 'vv_cars'
    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id       = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'), nullable=False)
    checkpoint_code  = Column(String(50), nullable=True)    # optional link, e.g. "PURO-B-01"
    car_number       = Column(String(20), nullable=False)   # CAR-001, scoped per project
    severity         = Column(String(20), nullable=False)   # major_nc / minor_nc
    title            = Column(String(300), nullable=False)
    description      = Column(Text, nullable=False)
    status           = Column(String(30), default='open')   # open/responded/closed/withdrawn
    raised_by        = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    raised_by_name   = Column(String(300), nullable=True)
    raised_at        = Column(DateTime(timezone=True), server_default=func.now())
    response         = Column(Text, nullable=True)
    responded_by_name = Column(String(300), nullable=True)
    responded_at     = Column(DateTime(timezone=True), nullable=True)
    closed_by_name   = Column(String(300), nullable=True)
    closed_at        = Column(DateTime(timezone=True), nullable=True)
    closure_note     = Column(Text, nullable=True)
    updated_at       = Column(DateTime(timezone=True), onupdate=func.now())


class VVDecision(Base):
    """Formal verification decision — history preserved; active = superseded_at IS NULL."""
    __tablename__ = 'vv_decisions'
    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id       = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'), nullable=False)
    decision         = Column(String(30), nullable=False)   # approved/conditional_approved/rejected/deferred
    findings_summary = Column(Text, nullable=True)
    conditions       = Column(JSONB, default=list)          # condition strings for conditional approval
    open_cars_at_decision = Column(Integer, default=0)      # snapshot of open CARs at decision time
    decided_by       = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    decided_by_name  = Column(String(300), nullable=True)
    decided_at           = Column(DateTime(timezone=True), server_default=func.now())
    superseded_at        = Column(DateTime(timezone=True), nullable=True)
    updated_at           = Column(DateTime(timezone=True), onupdate=func.now())
    # Phase 4: Two-person rule / countersign
    second_reviewer_id   = deferred(Column(UUID(as_uuid=True), nullable=True))
    second_reviewer_name = deferred(Column(String(300), nullable=True))
    second_reviewer_note = deferred(Column(Text, nullable=True))
    countersigned_at     = deferred(Column(DateTime(timezone=True), nullable=True))
    signature_hash       = deferred(Column(String(64), nullable=True))  # SHA-256


class VVRfi(Base):
    """Request for Information — formal information requests raised during V&V."""
    __tablename__ = 'vv_rfis'
    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id        = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'), nullable=False)
    checkpoint_id     = Column(String(50), nullable=True)    # optional link to a checkpoint code
    title             = Column(String(300), nullable=False)
    body              = Column(Text, nullable=False)
    severity          = Column(String(20), default='medium') # high / medium / low / info
    status            = Column(String(30), default='open')   # open / in_review / resolved / closed
    raised_by         = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    raised_by_name    = Column(String(300))
    raised_at         = Column(DateTime(timezone=True), server_default=func.now())
    assigned_to_name  = Column(String(300))
    response          = Column(Text)
    responded_by_name = Column(String(300))
    responded_at      = Column(DateTime(timezone=True), nullable=True)
    resolved_by_name  = Column(String(300))
    resolved_at       = Column(DateTime(timezone=True), nullable=True)
    updated_at        = Column(DateTime(timezone=True), onupdate=func.now())


class VVRegistrySubmission(Base):
    """Phase 6: Registry submission — framework for submitting to registry APIs."""
    __tablename__ = 'vv_registry_submissions'
    id                    = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id            = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'), nullable=False)
    decision_id           = Column(UUID(as_uuid=True), ForeignKey('vv_decisions.id'), nullable=True)
    submission_number     = Column(String(30), nullable=False)  # REG-SUB-001 scoped per project
    registry_slug         = Column(String(50), nullable=False)
    status                = Column(String(30), default='draft')  # draft/submitted/pending/accepted/rejected
    payload               = Column(JSONB, default=dict)           # structured submission package
    submitted_at          = Column(DateTime(timezone=True), nullable=True)
    submitted_by          = Column(UUID(as_uuid=True), ForeignKey('users.id'), nullable=True)
    submitted_by_name     = Column(String(300), nullable=True)
    registry_ref_number   = Column(String(100), nullable=True)   # reference from registry
    registry_response     = Column(JSONB, nullable=True)          # registry's full response
    estimated_review_days = Column(Integer, nullable=True)
    notes                 = Column(Text, nullable=True)
    created_at            = Column(DateTime(timezone=True), server_default=func.now())
    updated_at            = Column(DateTime(timezone=True), onupdate=func.now())


class VVRegistrySync(Base):
    """Feature #8: Registry sync status — one record per project (upserted on each sync)."""
    __tablename__ = 'vv_registry_sync'
    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # FK type MUST match VVProject.id (UUID) — a String FK to UUID breaks SQLAlchemy mapper init
    project_id           = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'), nullable=False)
    registry_slug        = Column(String(50),  nullable=False)
    external_project_id  = Column(String(200), nullable=True)
    sync_status          = Column(String(30),  default='ok')   # ok / discrepancy / error
    last_synced_at       = Column(DateTime(timezone=True), nullable=True)
    registry_data        = Column(JSONB, default=dict)         # raw registry response
    discrepancies        = Column(JSONB, default=list)         # list of human-readable strings
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), onupdate=func.now())


class VVReport(Base):
    __tablename__ = 'vv_reports'
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id      = Column(UUID(as_uuid=True), ForeignKey('vv_projects.id'))
    report_type     = Column(String(50))        # verification/validation/gap_analysis
    status          = Column(String(50))        # draft/final
    overall_outcome = Column(String(50))        # verified/conditional/not_verified
    credit_estimate = Column(Float)             # estimated credits
    credit_unit     = Column(String(50))        # tCO2e / CORC / etc
    summary         = Column(Text)
    findings        = Column(JSONB, default=list)
    recommendations = Column(JSONB, default=list)
    conditions      = Column(JSONB, default=list)  # conditions for conditional verification
    generated_by    = Column(UUID(as_uuid=True), ForeignKey('users.id'))
    generated_at    = Column(DateTime(timezone=True), server_default=func.now())
    finalized_at    = Column(DateTime(timezone=True), nullable=True)
    report_data     = Column(JSONB, default=dict)  # full machine-readable report
    # Feature #12: Polygon blockchain anchoring — deferred: safe before migration 0010 runs
    anchor_tx_hash     = deferred(Column(String(100),  nullable=True))
    anchor_block       = deferred(Column(BigInteger(), nullable=True))
    anchor_anchored_at = deferred(Column(DateTime(timezone=True), nullable=True))
    anchor_report_hash = deferred(Column(String(64),   nullable=True))
    anchor_chain       = deferred(Column(String(40),   nullable=True))
    project         = relationship('VVProject', back_populates='reports')
