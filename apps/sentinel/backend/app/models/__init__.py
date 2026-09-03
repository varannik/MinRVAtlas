import uuid

from sqlalchemy import (
    JSON,
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
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)  # F020
    full_name = Column(String(255))
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), default="analyst")
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(String(255), nullable=True)
    theme = Column(String(10), default="dark", nullable=True)  # B1-#12: user theme preference
    # Platform access control — which of the 4 platform buckets this user can access.
    # NULL = all enabled (backward-compatible for existing users).
    # Super Admin and Admin always see everything regardless of this field.
    # {"dqa": true, "anomaly": false, "vv": true, "reviewer": false}
    platform_access = Column(JSONB, nullable=True)

class RevokedToken(Base):
    """F006: JWT denylist — tokens added here on logout/password-change cannot be reused."""
    __tablename__ = "revoked_tokens"
    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    jti        = Column(String(255), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)  # GC after this date
    revoked_at = Column(DateTime(timezone=True), server_default=func.now())


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(255), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Project(Base):
    __tablename__ = "projects"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    domain = Column(String(100), default="co2_sequestration")
    config = Column(JSONB, default={})
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    datasets = relationship("Dataset", back_populates="project", lazy="select")
    rules = relationship("DQARule", back_populates="project", lazy="select")

class Dataset(Base):
    __tablename__ = "datasets"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    name = Column(String(255), nullable=False)
    source_type = Column(String(50), default="csv")
    row_count = Column(Integer)
    column_count = Column(Integer)
    columns_meta = Column(JSONB, default=[])
    storage_path = Column(String(500))
    ingested_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    ingested_at = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String(50), default="ready")
    parent_dataset_id = Column(UUID(as_uuid=True), nullable=True)
    pass_number = Column(Integer, default=0)
    project = relationship("Project", back_populates="datasets")

class DQARule(Base):
    __tablename__ = "dqa_rules"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    rule_id = Column(String(50), nullable=False)
    rule_name = Column(String(255), nullable=False)
    dimension = Column(String(50), nullable=False)
    description = Column(Text)
    what_it_checks = Column(Text)
    severity = Column(String(20), default="medium")
    is_hard_gate = Column(Boolean, default=False)
    weight = Column(Float, default=0.125)
    parameters = Column(JSONB, default={})
    is_active = Column(Boolean, default=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    project = relationship("Project", back_populates="rules")

class DQARun(Base):
    __tablename__ = "dqa_runs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id"), index=True)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), index=True)
    triggered_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    triggered_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))
    status = Column(String(50), default="queued")
    rules_executed = Column(Integer, default=0)
    total_violations = Column(Integer, default=0)
    readiness_score = Column(Float)
    data_coverage = Column(Float, nullable=True)
    dimension_scores = Column(JSONB, default={})
    gate_passed = Column(Boolean)
    error_message = Column(Text)
    ignore_hard_gates = Column(Boolean, default=False)
    violations = relationship("DQAViolation", back_populates="run", lazy="select")

class DQAViolation(Base):
    __tablename__ = "dqa_violations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id = Column(UUID(as_uuid=True), ForeignKey("dqa_runs.id"), index=True)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id"), index=True)
    rule_id = Column(String(50), nullable=False)
    rule_name = Column(String(255))
    dimension = Column(String(50), nullable=False)
    severity = Column(String(20), nullable=False)
    affected_field = Column(String(255))
    affected_rows = Column(JSONB, default=[])
    record_count = Column(Integer, default=0)
    violation_detail = Column(JSONB, default={})
    confidence_score = Column(Float, default=1.0)
    status = Column(String(50), default="open")
    # Phase 3: assignment + SLA
    assigned_to = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    sla_hours = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    run = relationship("DQARun", back_populates="violations")
    suggestions = relationship("CorrectionSuggestion", back_populates="violation", lazy="select")
    comments = relationship("ViolationComment", back_populates="violation", lazy="select")

class CorrectionRule(Base):
    __tablename__ = "correction_rules"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    name = Column(String(255), nullable=False)
    target_dqa_rule_id = Column(String(50))
    correction_type = Column(String(100), nullable=False)
    correction_logic = Column(JSONB, default={})
    priority = Column(Integer, default=100)
    is_active = Column(Boolean, default=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Rule Studio additions
    description        = Column(Text, nullable=True)
    auto_apply_threshold     = Column(Integer, default=80)   # confidence % above which auto-apply
    auto_apply_severity_max  = Column(String(20), default="medium")  # never auto-apply above this severity
    pair_type          = Column(String(20), default="standard")  # standard / ai / manual
    # Effectiveness stats (incremented by violation / correction flows)
    violation_count    = Column(Integer, default=0)
    auto_applied_count = Column(Integer, default=0)
    rejected_count     = Column(Integer, default=0)
    last_test_result   = Column(JSONB, nullable=True)

class CorrectionSuggestion(Base):
    __tablename__ = "correction_suggestions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    violation_id = Column(UUID(as_uuid=True), ForeignKey("dqa_violations.id"), index=True)
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id"), index=True)
    suggestion_source = Column(String(50), nullable=False)
    original_value = Column(JSONB)
    suggested_value = Column(JSONB)
    correction_method = Column(String(100))
    confidence_score = Column(Float, default=0.0)
    explanation = Column(Text)
    model_version = Column(String(100))
    feature_importance = Column(JSONB, default={})
    status = Column(String(50), default="pending")
    # Fix #10: track who submitted this suggestion so self-approval can be blocked
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    reviewed_at = Column(DateTime(timezone=True))
    override_value = Column(JSONB)
    override_reason = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    violation = relationship("DQAViolation", back_populates="suggestions")

class ApprovedCorrection(Base):
    __tablename__ = "approved_corrections"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    suggestion_id = Column(UUID(as_uuid=True), ForeignKey("correction_suggestions.id"))
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id"), index=True)
    field_name = Column(String(255))
    affected_rows = Column(JSONB, default=[])
    original_value = Column(JSONB)
    corrected_value = Column(JSONB)
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True), server_default=func.now())
    applied_to_production = Column(Boolean, default=False)
    applied_at = Column(DateTime(timezone=True))

class AITrainingFeedback(Base):
    __tablename__ = "ai_training_feedback"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    correction_id = Column(UUID(as_uuid=True), ForeignKey("approved_corrections.id"))
    dataset_id = Column(UUID(as_uuid=True), ForeignKey("datasets.id"))
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    field_name = Column(String(255))
    error_type = Column(String(100))
    feature_vector = Column(JSONB, default={})
    target_value = Column(JSONB)
    used_in_training = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class AuditLog(Base):
    __tablename__ = "audit_log"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type = Column(String(100), nullable=False)
    entity_type = Column(String(100))
    entity_id = Column(UUID(as_uuid=True))
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    actor_role = Column(String(50))
    before_state = Column(JSONB)
    after_state = Column(JSONB)
    event_metadata = Column(JSONB, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# V&V Platform models
from app.models.vv_models import (
    Methodology,
    Registry,
    VVCar,
    VVCheckpoint,
    VVDecision,
    VVDocument,
    VVProject,
    VVRegistrySubmission,
    VVReport,
)


class Notification(Base):
    """In-app notifications for key platform events."""
    __tablename__ = "notifications"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # None = all users
    title       = Column(String(255), nullable=False)
    message     = Column(Text, nullable=False)
    event_type  = Column(String(100), nullable=False)   # run_complete, gate_failed, ai_ready, correction_auto_approved
    entity_id   = Column(UUID(as_uuid=True), nullable=True)
    entity_type = Column(String(50), nullable=True)
    is_read     = Column(Boolean, default=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

class ApiKey(Base):
    """Named API keys for the sensor ingest webhook and external integrations."""
    __tablename__ = "api_keys"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name        = Column(String(255), nullable=False)
    key_prefix  = Column(String(12), nullable=False)   # first 8 chars shown in UI
    key_hash    = Column(String(255), nullable=False)  # SHA-256 hash of full key
    project_id  = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    created_by  = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

class ProjectMember(Base):
    """Project-level access control: owner / analyst / viewer roles."""
    __tablename__ = "project_members"
    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"))
    user_id    = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    role       = Column(String(50), default="analyst")  # owner | analyst | viewer
    added_by   = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class DQASchedule(Base):
    """Scheduled DQA runs — cron-based automation per project/dataset."""
    __tablename__ = "dqa_schedules"
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id      = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    dataset_id      = Column(UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=True)
    name            = Column(String(255), nullable=False)
    cron_expression = Column(String(100), nullable=False, default="0 6 * * *")
    timezone        = Column(String(100), default="UTC")
    is_active       = Column(Boolean, default=True)
    notify_email    = Column(String(500), nullable=True)
    last_run_at     = Column(DateTime(timezone=True), nullable=True)
    next_run_at     = Column(DateTime(timezone=True), nullable=True)
    last_run_status = Column(String(50), nullable=True)
    run_count       = Column(Integer, default=0)
    created_by      = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Full pipeline additions
    source_type               = Column(String(20),  default="manual")   # manual/local/sharepoint/s3
    source_config             = Column(JSONB,        nullable=True)      # connection details (legacy single-project)
    auto_correct_enabled      = Column(Boolean,      default=False)
    correction_confidence_pct = Column(Integer,      default=80)        # auto-apply threshold
    output_folder_suffix      = Column(String(100),  default="corrected")
    gate_fail_emails          = Column(Text,         nullable=True)      # comma-separated
    last_pipeline_result      = Column(JSONB,        nullable=True)      # summary of last full run
    # Multi-project multi-type scheduling
    schedule_type             = Column(String(20),  default="dqa")      # dqa / anomaly / both
    project_configs           = Column(JSONB,        nullable=True)      # [{project_id, source_type, source_config, ...}]
    anomaly_confidence_pct    = Column(Integer,      default=70)         # anomaly flag threshold
    min_anomaly_count         = Column(Integer,      default=1)          # min anomalies to trigger email

class KnowledgeBaseEntry(Base):
    """Operational knowledge base for GenAI anomaly recommendations."""
    __tablename__ = "knowledge_base"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    domain      = Column(String(50), nullable=False, index=True)   # ccs, biochar, general, etc.
    parameter   = Column(String(200), nullable=True, index=True)               # None = applies to all params in domain
    category    = Column(String(100), nullable=False)              # mechanical, instrumentation, process, etc.
    title       = Column(String(300), nullable=False)
    description = Column(Text, nullable=False)
    action      = Column(Text, nullable=True)                      # recommended corrective action
    severity    = Column(String(20), default="medium")             # critical, high, medium, low
    priority    = Column(String(20), default="24h")                # immediate, 24h, scheduled
    tags        = Column(JSONB, default=[])
    source      = Column(String(200), nullable=True)               # e.g. "GSC operating manual", "44.01 incident log"
    is_active   = Column(Boolean, default=True)
    created_by  = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class AnomalyDetectionRun(Base):
    """Stores anomaly detection results per dataset — enables session restore."""
    __tablename__ = "anomaly_detection_runs"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset_id  = Column(UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=False, index=True)
    project_id  = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True, index=True)
    result      = Column(JSONB, nullable=False)          # full detection result JSON
    domain      = Column(String(50), default="ccs")
    model_params = Column(JSONB, default={})
    analysed_keys = Column(JSONB, default=[])            # list of "rowIdx__param" keys
    current_step  = Column(Integer, default=2)           # which workflow step user was on
    created_by  = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ── Phase 3 Models ────────────────────────────────────────────────────────────

class ViolationComment(Base):
    """Comment thread on a DQA violation — supports team collaboration."""
    __tablename__ = "violation_comments"
    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    violation_id = Column(UUID(as_uuid=True), ForeignKey("dqa_violations.id", ondelete="CASCADE"), index=True)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    message      = Column(Text, nullable=False)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    violation    = relationship("DQAViolation", back_populates="comments")
    user         = relationship("User", foreign_keys=[user_id], lazy="select")


class InstrumentCalibration(Base):
    """Per-sensor calibration records — track due dates and flag overdue in DQA."""
    __tablename__ = "instrument_calibrations"
    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id          = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"))
    instrument_id       = Column(String(100))          # SCADA tag / sensor ID
    instrument_name     = Column(String(255), nullable=False)
    location            = Column(String(255))
    last_calibrated_at  = Column(DateTime(timezone=True), nullable=True)
    next_calibration_at = Column(DateTime(timezone=True), nullable=True)
    calibration_cert    = Column(String(500))          # certificate number / URL
    notes               = Column(Text)
    created_by          = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())


class SubmissionWindow(Base):
    """Registry submission deadline tracker per project."""
    __tablename__ = "submission_windows"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id  = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"))
    name        = Column(String(255), nullable=False)
    description = Column(Text)
    deadline_at = Column(DateTime(timezone=True), nullable=True)
    status      = Column(String(50), default="upcoming")   # upcoming | submitted | missed
    created_by  = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())


class RetentionPolicy(Base):
    """Data retention policy per project — controls auto-archival of old runs/violations."""
    __tablename__ = "retention_policies"
    id                       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id               = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    run_retention_days        = Column(Integer, default=730)    # 2 years
    violation_retention_days  = Column(Integer, default=1825)   # 5 years
    auto_archive_enabled      = Column(Boolean, default=False)
    created_by               = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at               = Column(DateTime(timezone=True), server_default=func.now())


class IngestBatch(Base):
    """Idempotency key registry for sensor ingest — prevents duplicate processing."""
    __tablename__ = "ingest_batches"
    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    idempotency_key = Column(String(255), nullable=False, unique=True, index=True)
    project_id      = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    dataset_id      = Column(UUID(as_uuid=True), ForeignKey("datasets.id"), nullable=True)
    received_at     = Column(DateTime(timezone=True), server_default=func.now())


# ── Living Protocol Registry Models ──────────────────────────────────────────

class VVRegistry(Base):
    """Registry organisations (Puro.Earth, Isometric, Gold Standard, Verra)."""
    __tablename__ = "vv_registries"
    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name        = Column(String(100), nullable=False)
    slug        = Column(String(50), unique=True, nullable=False)
    website_url = Column(String(500), nullable=True)
    logo_emoji  = Column(String(10), nullable=True)
    description = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    protocols   = relationship("VVProtocol", back_populates="registry", lazy="select",
                               cascade="all, delete-orphan")


class VVProtocol(Base):
    """Individual carbon credit protocol within a registry."""
    __tablename__ = "vv_protocols"
    id                    = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    registry_id           = Column(UUID(as_uuid=True), ForeignKey("vv_registries.id", ondelete="CASCADE"), nullable=False)
    code                  = Column(String(50), nullable=False)
    name                  = Column(String(200), nullable=False)
    description           = Column(Text, nullable=True)
    version               = Column(String(20), nullable=False, default="1.0")
    status                = Column(String(20), nullable=False, default="active")
    source_url            = Column(String(500), nullable=True)
    last_verified_at      = Column(DateTime(timezone=True), nullable=True)
    verified_by           = Column(String(100), nullable=True)
    website_content_hash  = Column(String(64), nullable=True)
    created_at            = Column(DateTime(timezone=True), server_default=func.now())
    updated_at            = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    registry              = relationship("VVRegistry", back_populates="protocols")
    checkpoints           = relationship("VVCheckpointDef", back_populates="protocol", lazy="select",
                                         cascade="all, delete-orphan",
                                         order_by="VVCheckpointDef.sort_order")
    update_logs           = relationship("VVProtocolUpdateLog", back_populates="protocol", lazy="select",
                                         cascade="all, delete-orphan")


class VVCheckpointDef(Base):
    """Protocol checkpoint definitions — the living checklist template."""
    __tablename__ = "vv_checkpoint_defs"
    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    protocol_id          = Column(UUID(as_uuid=True), ForeignKey("vv_protocols.id", ondelete="CASCADE"), nullable=False)
    checkpoint_id        = Column(String(50), nullable=False)
    category             = Column(String(100), nullable=False)
    name                 = Column(String(200), nullable=False)
    requirement          = Column(Text, nullable=False)
    critical             = Column(Boolean, default=True)
    document_types       = Column(JSONB, nullable=True)
    evidence_types       = Column(JSONB, nullable=True)
    sort_order           = Column(Integer, default=0)
    added_in_version     = Column(String(20), nullable=True, default="1.0")
    deprecated_in_version = Column(String(20), nullable=True)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    protocol             = relationship("VVProtocol", back_populates="checkpoints")


class VVProtocolUpdateLog(Base):
    """Audit trail for protocol change proposals — AI-detected or admin-proposed."""
    __tablename__ = "vv_protocol_update_log"
    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    protocol_id          = Column(UUID(as_uuid=True), ForeignKey("vv_protocols.id", ondelete="CASCADE"), nullable=False)
    proposed_by          = Column(String(100), nullable=False)        # email or "web_monitor" / "pdf_ingestion"
    change_type          = Column(String(50), nullable=False)         # add_checkpoint | update_checkpoint | remove_checkpoint | version_bump | metadata_update
    checkpoint_id_affected = Column(String(50), nullable=True)
    old_value            = Column(JSONB, nullable=True)
    new_value            = Column(JSONB, nullable=True)
    status               = Column(String(20), nullable=False, default="pending")  # pending | approved | rejected
    reviewed_by          = Column(String(100), nullable=True)
    reviewed_at          = Column(DateTime(timezone=True), nullable=True)
    notes                = Column(Text, nullable=True)
    source               = Column(String(500), nullable=True)         # PDF filename, URL, etc.
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    protocol             = relationship("VVProtocol", back_populates="update_logs")

