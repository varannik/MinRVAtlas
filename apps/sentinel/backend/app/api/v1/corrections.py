import logging
import os
from datetime import datetime
from typing import Optional
from uuid import UUID

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import storage
from app.core.database import get_db
from app.core.security import get_current_user
from app.models import (
    AITrainingFeedback,
    ApprovedCorrection,
    AuditLog,
    CorrectionRule,
    CorrectionSuggestion,
    Dataset,
    DQARun,
    DQAViolation,
    ProjectMember,
)
from app.schemas import (
    ApprovalAction,
    BulkApproval,
    CorrectionRuleCreate,
)

logger = logging.getLogger("datasentinel")

router = APIRouter()

# ── Dataset loader ────────────────────────────────────────────────────────────
def _load_df(dataset: Dataset) -> Optional[pd.DataFrame]:
    """Load dataset into DataFrame — works for both local and S3 storage."""
    if not dataset or not dataset.storage_path:
        return None
    path = dataset.storage_path
    ext = os.path.splitext(path)[1].lower() or ".csv"
    try:
        with storage.open_local(path, suffix=ext) as local_path:
            if ext == ".csv":
                return pd.read_csv(local_path)
            if ext == ".parquet":
                return pd.read_parquet(local_path)
            return pd.read_excel(local_path)
    except Exception as e:
        logger.warning(f"_load_df failed for {path}: {e}")
        return None

# ── Correction Rules ──────────────────────────────────────────────────────────
@router.get("/rules")
def list_correction_rules(project_id: Optional[UUID] = None,
                           db: Session = Depends(get_db), user=Depends(get_current_user)):
    role = getattr(user, "role", "analyst")
    q = db.query(CorrectionRule)
    if project_id:
        q = q.filter(CorrectionRule.project_id == project_id)
    elif role not in ("admin", "super_admin"):
        user_project_ids = db.query(ProjectMember.project_id).filter(
            ProjectMember.user_id == user.id
        ).subquery()
        q = q.filter(CorrectionRule.project_id.in_(user_project_ids))
    return [{"id": str(r.id), "name": r.name, "target_dqa_rule_id": r.target_dqa_rule_id,
             "correction_type": r.correction_type, "correction_logic": r.correction_logic,
             "priority": r.priority, "is_active": r.is_active,
             "project_id": str(r.project_id) if r.project_id else None}
            for r in q.order_by(CorrectionRule.priority).all()]

@router.post("/rules")
def create_correction_rule(data: CorrectionRuleCreate, project_id: UUID,
                            db: Session = Depends(get_db), user=Depends(get_current_user)):
    rule = CorrectionRule(project_id=project_id, name=data.name,
                          target_dqa_rule_id=data.target_dqa_rule_id,
                          correction_type=data.correction_type,
                          correction_logic=data.correction_logic,
                          priority=data.priority, is_active=True)
    db.add(rule); db.commit(); db.refresh(rule)
    return {"id": str(rule.id), "name": rule.name, "is_active": rule.is_active,
            "target_dqa_rule_id": rule.target_dqa_rule_id,
            "correction_type": rule.correction_type,
            "correction_logic": rule.correction_logic, "priority": rule.priority}

@router.patch("/rules/{rule_id}")
def update_correction_rule(rule_id: UUID, is_active: Optional[bool] = None,
                            db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.query(CorrectionRule).filter(CorrectionRule.id == rule_id).first()
    if not r: raise HTTPException(404, "Rule not found")
    if is_active is not None: r.is_active = is_active
    db.commit()
    return {"id": str(r.id), "name": r.name, "is_active": r.is_active,
            "target_dqa_rule_id": r.target_dqa_rule_id, "correction_type": r.correction_type,
            "correction_logic": r.correction_logic, "priority": r.priority}

@router.patch("/rules/{rule_id}/full")
def update_correction_rule_full(rule_id: UUID, data: dict,
                                 db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.query(CorrectionRule).filter(CorrectionRule.id == rule_id).first()
    if not r: raise HTTPException(404, "Rule not found")
    for field in ["name", "target_dqa_rule_id", "correction_type", "correction_logic", "priority"]:
        if field in data: setattr(r, field, data[field])
    db.commit()
    return {"id": str(r.id), "name": r.name, "is_active": r.is_active,
            "target_dqa_rule_id": r.target_dqa_rule_id, "correction_type": r.correction_type,
            "correction_logic": r.correction_logic, "priority": r.priority}

@router.delete("/rules/{rule_id}")
def delete_correction_rule(rule_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.query(CorrectionRule).filter(CorrectionRule.id == rule_id).first()
    if not r: raise HTTPException(404, "Rule not found")
    db.delete(r); db.commit()
    return {"deleted": str(rule_id)}

# ── Generate Suggestions ──────────────────────────────────────────────────────
@router.post("/generate/{run_id}")
def generate_suggestions(run_id: UUID, db: Session = Depends(get_db),
                          user=Depends(get_current_user)):
    logger.info(f"Generate suggestions called for run {run_id}")

    # Load run
    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    if run.status not in ("completed", "failed"):
        raise HTTPException(400, f"Run status is '{run.status}'. Must be 'completed' first.")

    # Load violations
    violations = db.query(DQAViolation).filter(DQAViolation.run_id == run_id).all()
    logger.info(f"Found {len(violations)} violations for run {run_id}")
    if not violations:
        return {"message": "No violations in this run — nothing to correct.", "count": 0}

    # Load correction rules
    corr_rules = db.query(CorrectionRule).filter(
        CorrectionRule.project_id == run.project_id, CorrectionRule.is_active == True).all()

    # Load dataset (best-effort — works without it)
    dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
    df = _load_df(dataset)
    if df is None:
        logger.warning(f"Dataset file not found for dataset {run.dataset_id} — using fallback mode")
        df = pd.DataFrame()

    # Build dicts
    crules = [{"id": str(r.id), "name": r.name, "target_dqa_rule_id": r.target_dqa_rule_id,
                "correction_type": r.correction_type, "correction_logic": r.correction_logic,
                "priority": r.priority, "is_active": r.is_active} for r in corr_rules]
    viols = [{"id": str(v.id), "rule_id": v.rule_id, "dimension": v.dimension,
               "severity": v.severity, "affected_field": v.affected_field or "",
               "affected_rows": v.affected_rows or [],
               "violation_detail": v.violation_detail or {}} for v in violations]

    # Run correction engine
    from app.engines.correction.engine import RuleBasedCorrectionEngine
    engine = RuleBasedCorrectionEngine()
    suggestions = engine.generate(df, viols, crules)
    logger.info(f"Engine generated {len(suggestions)} suggestions")

    # Save to DB
    created = 0
    skipped = 0
    for s in suggestions:
        try:
            # Find violation by string ID match
            violation = next((v for v in violations if str(v.id) == str(s.violation_id)), None)
            if not violation:
                skipped += 1
                continue
            # Skip if already exists
            existing = db.query(CorrectionSuggestion).filter(
                CorrectionSuggestion.violation_id == violation.id,
                CorrectionSuggestion.suggestion_source == s.suggestion_source
            ).first()
            if existing:
                skipped += 1
                continue
            # Create suggestion
            # Sanitise NaN/Inf → None before PostgreSQL JSON insert
            def _pg_clean(v):
                import math
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)): return None
                if isinstance(v, list): return [_pg_clean(x) for x in v]
                if isinstance(v, dict): return {k: _pg_clean(x) for k,x in v.items()}
                return v

            sug = CorrectionSuggestion(
                violation_id=violation.id,
                dataset_id=run.dataset_id,
                suggestion_source=s.suggestion_source,
                original_value=_pg_clean(s.original_value),
                suggested_value=_pg_clean(s.suggested_value),
                correction_method=s.correction_method,
                confidence_score=float(s.confidence_score),
                explanation=s.explanation or "",
                feature_importance=_pg_clean(s.feature_importance or {}),
                status="pending",
                # Fix (self-approval guard): record who triggered the generation
                # so the approve endpoint can prevent same-user self-approval.
                created_by=user.id,
            )
            db.add(sug)
            created += 1
        except Exception as e:
            logger.error(f"Error saving suggestion for violation {s.violation_id}: {e}")
            skipped += 1
            continue

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"DB commit failed: {e}")
        raise HTTPException(500, f"Database error saving suggestions: {str(e)}")

    # Categorise each violation for the convergence report
    INFORMATIONAL = {'T-02', 'U-02', 'CON-07', 'CON-05', 'CON-06', 'A-01'}
    CORRECTABLE   = {'I-04', 'I-01', 'C-02', 'C-03', 'CON-04'}

    violations_breakdown = []
    for v in violations:
        rid = v.rule_id
        field = (v.affected_field or "").split("/")[0]  # handle compound names
        rows  = v.affected_rows or []
        count_rows = len(rows) if rows else (v.record_count or 0)

        if rid in INFORMATIONAL:
            reason = {
                'T-02': "Batch arrival timing — informational, not correctable",
                'U-02': "Repeated operational state values — expected behaviour",
                'CON-07': "Rolling z-score anomaly — statistical flag, not correctable",
                'CON-05': "Rate/pressure correlation — informational",
                'CON-06': "Injection rate bounds — informational",
                'A-01': "Accuracy formula — informational",
            }.get(rid, "Informational violation — no correction applies")
            status = "informational"
        elif rid == 'REL-01':
            reason = "Rows already marked as 'excluded' — no further action needed"
            status = "already_corrected"
        elif rid == 'CON-04':
            # Check if values are already within limits
            ratio_col = (v.affected_field or "").split("/")[0]
            dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
            df_check = _load_df(dataset)
            if df_check is not None and ratio_col in df_check.columns:
                max_val = float(df_check[ratio_col].max())
                over_count = int((df_check[ratio_col] > 0.6).sum())
                if over_count == 0:
                    reason = f"All ratio values now within limit (max {max_val:.4f} ≤ 0.6) — no correction needed"
                    status = "already_corrected"
                else:
                    reason = f"{over_count} rows still exceed ratio limit — correction applied"
                    status = "corrected"
            else:
                reason = "Water/CO₂ ratio — correction applied where values exceeded limit"
                status = "corrected"
        else:
            reason = "Correction applied" if any(str(v.id) == str(s.violation_id) for s in suggestions) else "No handler available"
            status = "corrected" if any(str(v.id) == str(s.violation_id) for s in suggestions) else "informational"

        violations_breakdown.append({
            "rule_id": rid,
            "rule_name": v.rule_name,
            "severity": v.severity,
            "affected_field": field,
            "record_count": count_rows,
            "status": status,
            "reason": reason,
        })

    if created == 0:
        msg = f"0 actionable corrections — data has converged. {len(violations_breakdown)} remaining violations are informational or already resolved."
    else:
        msg = f"Generated {created} correction suggestion{'s' if created != 1 else ''}"
        if skipped: msg += f" ({skipped} skipped)"

    logger.info(msg)
    return {
        "message": msg,
        "count": created,
        "converged": created == 0,
        "violations_breakdown": violations_breakdown,
    }

# ── AI Auto-Suggest ───────────────────────────────────────────────────────────
@router.post("/ai-suggest/{run_id}")
async def ai_suggest_corrections(run_id: UUID, db: Session = Depends(get_db),
                                  user=Depends(get_current_user)):
    """
    Use Claude AI to generate smart correction suggestions for a DQA run.
    Returns structured suggestions (does not persist — user must approve individually).
    """
    from app.engines.ai.correction_agent import suggest_corrections
    from app.models import Project

    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    if run.status != "completed":
        raise HTTPException(400, f"Run not yet completed (status: {run.status})")

    violations = db.query(DQAViolation).filter(DQAViolation.run_id == run_id).all()
    if not violations:
        return {"suggestions": [], "summary": "No violations found in this run", "high_risk_count": 0}

    dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
    project = db.query(Project).filter(Project.id == run.project_id).first()

    project_name = project.name if project else "Unknown Project"

    # Build a small dataset sample for context (5 rows max)
    dataset_sample: list = []
    if dataset and dataset.storage_path:
        try:
            df = _load_df(dataset)
            if df is not None:
                dataset_sample = df.head(5).to_dict(orient="records")
        except Exception:
            pass

    result = await suggest_corrections(violations, dataset_sample, project_name, domain="ccs")
    return result

# ── AI Auto-Approve Low-Risk Corrections ─────────────────────────────────────
@router.post("/ai-auto-approve/{run_id}")
async def ai_auto_approve(run_id: UUID, db: Session = Depends(get_db),
                           user=Depends(get_current_user)):
    """
    Run AI correction analysis and auto-approve all high-confidence, low-risk suggestions.
    Skips anything with requires_human_review=True or credit_impact of moderate/significant.
    """
    from app.engines.ai.correction_agent import suggest_corrections
    from app.models import Project

    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    if run.status != "completed":
        raise HTTPException(400, f"Run not completed (status: {run.status})")

    violations = db.query(DQAViolation).filter(DQAViolation.run_id == run_id).all()
    if not violations:
        return {"approved_count": 0, "skipped_count": 0, "message": "No violations to correct"}

    dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
    project = db.query(Project).filter(Project.id == run.project_id).first()
    project_name = project.name if project else "Unknown Project"

    dataset_sample: list = []
    if dataset and dataset.storage_path:
        try:
            df = _load_df(dataset)
            if df is not None:
                dataset_sample = df.head(5).to_dict(orient="records")
        except Exception:
            pass

    result = await suggest_corrections(violations, dataset_sample, project_name, domain="ccs")
    suggestions = result.get("suggestions", [])

    approved_count = 0
    skipped_count = 0
    skipped_reasons: list = []

    for sug_data in suggestions:
        # Auto-approve only: high confidence + no human review + none/minor credit impact
        is_high = sug_data.get("confidence") == "high"
        no_review = not sug_data.get("requires_human_review", True)
        low_impact = sug_data.get("credit_impact", "significant") in ("none", "minor")

        if not (is_high and no_review and low_impact):
            skipped_count += 1
            skipped_reasons.append({
                "violation_id": sug_data.get("violation_id"),
                "field": sug_data.get("field"),
                "reason": f"confidence={sug_data.get('confidence')} requires_review={sug_data.get('requires_human_review')} credit_impact={sug_data.get('credit_impact')}",
            })
            continue

        violation = next(
            (v for v in violations if str(v.id) == str(sug_data.get("violation_id", ""))), None
        )
        if not violation:
            skipped_count += 1
            continue

        # Skip if already has an approved suggestion
        existing_approved = db.query(CorrectionSuggestion).filter(
            CorrectionSuggestion.violation_id == violation.id,
            CorrectionSuggestion.status == "approved"
        ).first()
        if existing_approved:
            skipped_count += 1
            continue

        # Create suggestion and immediately approve it
        # Use actual AI-returned confidence; fall back to XGBoost model score if available
        ai_confidence = float(sug_data.get("confidence") or sug_data.get("confidence_score") or 0.0)
        if ai_confidence == 0.0:
            # Try reading from persisted XGBoost model
            try:
                from app.ml import dqa_xgb, model_store
                xgb_model = model_store.load_or_none("dqa_xgb")
                if xgb_model and violation:
                    ctx = dqa_xgb.extract_series_context(
                        _load_df(db.query(Dataset).filter(Dataset.id == run.dataset_id).first()) or __import__("pandas").DataFrame(),
                        violation.affected_field or "", 0
                    )
                    pred = dqa_xgb.predict_with_shap(xgb_model, {
                        "rule_id": violation.rule_id, "severity": violation.severity,
                        "affected_rows": violation.affected_rows or []
                    }, ctx)
                    ai_confidence = pred.get("confidence", 0.0)
            except Exception:
                pass
        # Final fallback: use rule-based score if still zero
        if ai_confidence == 0.0:
            ai_confidence = float(sug_data.get("credit_impact_score", 0.75))

        sug = CorrectionSuggestion(
            violation_id=violation.id,
            dataset_id=run.dataset_id,
            suggestion_source="ai_auto",
            suggested_value=sug_data.get("suggested_value"),
            correction_method=sug_data.get("correction_type"),
            confidence_score=round(ai_confidence, 4),
            explanation=sug_data.get("reasoning", "AI auto-approved: high confidence, no credit impact"),
            status="pending",
        )
        db.add(sug)
        db.flush()
        _approve(sug, db, user)
        approved_count += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"DB error saving corrections: {str(e)}")

    return {
        "approved_count": approved_count,
        "skipped_count": skipped_count,
        "message": f"Auto-approved {approved_count} high-confidence corrections — {skipped_count} sent for human review",
        "summary": result.get("summary", ""),
        "high_risk_count": result.get("high_risk_count", 0),
        "skipped_details": skipped_reasons[:10],
    }

# ── List Suggestions ──────────────────────────────────────────────────────────
@router.get("/suggestions")
def list_suggestions(violation_id: Optional[UUID] = None, dataset_id: Optional[UUID] = None,
                      status: Optional[str] = None,
                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    role = getattr(user, "role", "analyst")
    q = db.query(CorrectionSuggestion)
    if violation_id: q = q.filter(CorrectionSuggestion.violation_id == violation_id)
    if dataset_id:   q = q.filter(CorrectionSuggestion.dataset_id == dataset_id)
    if status:       q = q.filter(CorrectionSuggestion.status == status)
    if not violation_id and not dataset_id and role not in ("admin", "super_admin"):
        # No scope filter provided — restrict to datasets within user's projects
        user_project_ids = db.query(ProjectMember.project_id).filter(
            ProjectMember.user_id == user.id
        ).subquery()
        accessible_dataset_ids = db.query(Dataset.id).filter(
            Dataset.project_id.in_(user_project_ids)
        ).subquery()
        q = q.filter(CorrectionSuggestion.dataset_id.in_(accessible_dataset_ids))
    items = q.order_by(CorrectionSuggestion.created_at.desc()).limit(200).all()
    return [{"id": str(s.id), "violation_id": str(s.violation_id),
             "dataset_id": str(s.dataset_id), "suggestion_source": s.suggestion_source,
             "original_value": s.original_value, "suggested_value": s.suggested_value,
             "correction_method": s.correction_method, "confidence_score": s.confidence_score,
             "explanation": s.explanation, "feature_importance": s.feature_importance or {},
             "status": s.status, "override_reason": getattr(s, 'override_reason', None),
             "created_at": s.created_at.isoformat() if s.created_at else None} for s in items]

# ── Approve ───────────────────────────────────────────────────────────────────
def _approve(s: CorrectionSuggestion, db: Session, user,
             override_value=None, override_reason=None):
    if s.status != "pending":
        return  # silently skip
    s.status = "approved"
    s.reviewed_by = user.id
    s.reviewed_at = datetime.utcnow()
    if override_value is not None:
        s.suggested_value = override_value
        if hasattr(s, 'override_reason'): s.override_reason = override_reason

    violation = db.query(DQAViolation).filter(DQAViolation.id == s.violation_id).first()
    if violation: violation.status = "in_review"

    corrected = override_value if override_value is not None else s.suggested_value

    # Build ApprovedCorrection using only columns that exist in the model
    approved_data = {
        "suggestion_id": s.id,
        "dataset_id": s.dataset_id,
        "field_name": violation.affected_field if violation else None,
        "affected_rows": violation.affected_rows if violation else [],
        "original_value": s.original_value,
        "corrected_value": corrected,
        "approved_by": user.id,
        "approved_at": datetime.utcnow(),
        "applied_to_production": False,
    }
    approved = ApprovedCorrection(**approved_data)
    db.add(approved)

    # Feed AI training store — build real feature vectors from dataset
    if violation and violation.affected_field:
        try:
            from app.ml.dqa_xgb import extract_series_context
            # Load the dataset to extract real rolling features
            dataset = db.query(Dataset).filter(Dataset.id == s.dataset_id).first() if s.dataset_id else None
            df_loaded = _load_df(dataset) if dataset else None

            orig_list = s.original_value if isinstance(s.original_value, list) else [s.original_value]
            corr_list = corrected if isinstance(corrected, list) else [corrected]
            affected_rows = violation.affected_rows or []

            for i, (orig, corr) in enumerate(zip(orig_list[:10], corr_list[:10])):
                if orig is not None and corr is not None:
                    try:
                        c_f = float(corr)
                        row_idx = affected_rows[i] if i < len(affected_rows) else 0

                        # Build real feature vector from series context
                        if df_loaded is not None and violation.affected_field in df_loaded.columns:
                            ctx = extract_series_context(df_loaded, violation.affected_field, row_idx)
                        else:
                            # Fallback: use original value as best available estimate
                            try:
                                o_f = float(orig)
                            except (ValueError, TypeError):
                                o_f = 0.0
                            ctx = {
                                "lag_1": o_f, "lag_2": o_f, "lag_3": o_f,
                                "rolling_mean_5": o_f, "rolling_std_5": 0.0,
                                "rolling_mean_10": o_f, "rolling_std_10": 0.0,
                                "z_score": 0.0, "iqr_deviation": 0.0,
                                "hour_of_day": datetime.utcnow().hour, "day_of_week": datetime.utcnow().weekday(),
                            }

                        # Enrich with violation metadata
                        fv = {
                            **ctx,
                            "rule_id": violation.rule_id or "",
                            "severity": violation.severity or "medium",
                            "violation_row_count": len(affected_rows),
                        }
                        db.add(AITrainingFeedback(
                            correction_id=approved.id,
                            dataset_id=s.dataset_id,
                            project_id=violation.run.project_id if violation.run else None,
                            field_name=violation.affected_field,
                            error_type=violation.rule_id,
                            feature_vector=fv,
                            target_value=c_f,
                        ))
                    except (ValueError, TypeError):
                        pass
        except Exception as e:
            logger.warning("Training feedback generation failed (non-fatal): %s", e)

    db.add(AuditLog(event_type="correction_approved", entity_type="correction_suggestion",
                    entity_id=s.id, actor_id=user.id, actor_role=user.role,
                    after_state={"method": s.correction_method,
                                 "corrected_value": str(corrected)[:100]}))

@router.post("/approve")
def approve_suggestion(data: ApprovalAction, db: Session = Depends(get_db),
                        user=Depends(get_current_user)):
    s = db.query(CorrectionSuggestion).filter(
        CorrectionSuggestion.id == data.suggestion_id).first()
    if not s: raise HTTPException(404, "Suggestion not found")
    # Fix #10: prevent self-approval — four-eyes principle requires a different user
    if s.created_by is not None and s.created_by == user.id:
        raise HTTPException(403, "Cannot approve your own correction suggestion — a different user must review it")
    _approve(s, db, user, data.override_value, data.override_reason)
    db.commit()
    return {"message": "Approved"}


@router.post("/second-approve/{suggestion_id}")
def second_approve(suggestion_id: UUID, db: Session = Depends(get_db),
                   user=Depends(get_current_user)):
    """
    4-Eyes second approval — a different user confirms an already-approved correction.
    Sets four_eyes_status = 'approved' on the linked ApprovedCorrection.
    """
    from datetime import datetime
    s = db.query(CorrectionSuggestion).filter(CorrectionSuggestion.id == suggestion_id).first()
    if not s:
        raise HTTPException(404, "Suggestion not found")
    if s.status != "approved":
        raise HTTPException(400, "Suggestion must be approved (first pass) before second approval")
    # Find linked approved correction
    ac = db.query(ApprovedCorrection).filter(ApprovedCorrection.suggestion_id == suggestion_id).first()
    if not ac:
        raise HTTPException(404, "No linked approved correction found")
    # Check it's a different user
    if ac.approved_by == user.id:
        raise HTTPException(400, "Second approver must be a different user than the first approver")
    # Apply second approval
    if hasattr(ac, 'four_eyes_status'):
        ac.four_eyes_status = "approved"
    if hasattr(ac, 'second_approved_by'):
        ac.second_approved_by = user.id
    if hasattr(ac, 'second_approved_at'):
        ac.second_approved_at = datetime.utcnow()
    db.add(AuditLog(
        event_type="correction_second_approved",
        entity_type="approved_correction",
        entity_id=ac.id,
        actor_id=user.id,
        actor_role=user.role,
        after_state={"four_eyes_status": "approved", "second_approved_by": str(user.id)},
    ))
    db.commit()
    return {
        "message": "Second approval confirmed",
        "correction_id": str(ac.id),
        "four_eyes_status": "approved",
        "second_approved_by": str(user.id),
    }

@router.post("/reject/{suggestion_id}")
def reject_suggestion(suggestion_id: UUID, reason: Optional[str] = None,
                       db: Session = Depends(get_db), user=Depends(get_current_user)):
    s = db.query(CorrectionSuggestion).filter(
        CorrectionSuggestion.id == suggestion_id).first()
    if not s: raise HTTPException(404, "Suggestion not found")
    s.status = "rejected"; s.reviewed_by = user.id; s.reviewed_at = datetime.utcnow()
    if reason and hasattr(s, 'override_reason'): s.override_reason = reason
    db.add(AuditLog(event_type="correction_rejected", entity_type="correction_suggestion",
                    entity_id=s.id, actor_id=user.id, actor_role=user.role,
                    after_state={"reason": reason}))
    db.commit()
    return {"message": "Rejected"}

@router.post("/bulk-approve")
def bulk_approve(data: BulkApproval, db: Session = Depends(get_db),
                  user=Depends(get_current_user)):
    approved_count = 0; skip_count = 0
    for sid in data.suggestion_ids:
        try:
            s = db.query(CorrectionSuggestion).filter(
                CorrectionSuggestion.id == sid).first()
            if not s or s.status != "pending":
                skip_count += 1; continue
            # Fix (self-approval bypass): bulk_approve was calling _approve directly,
            # skipping the guard in the single-approve endpoint.  Apply the same check here.
            if s.created_by is not None and s.created_by == user.id:
                skip_count += 1; continue
            _approve(s, db, user)
            approved_count += 1
        except Exception as e:
            logger.error(f"Bulk approve error for {sid}: {e}")
            skip_count += 1
    db.commit()
    return {"message": f"Approved {approved_count} ({skip_count} skipped)", "count": approved_count}

@router.get("/approved")
def list_approved(dataset_id: Optional[UUID] = None, db: Session = Depends(get_db),
                   user=Depends(get_current_user)):
    # Collect dataset_ids to search: this dataset + all ancestors in the lineage chain
    search_ids = []
    if dataset_id:
        search_ids.append(dataset_id)
        # Walk parent chain to include corrections from previous passes
        current_id = dataset_id
        for _ in range(10):  # max 10 passes
            ds = db.query(Dataset).filter(Dataset.id == current_id).first()
            parent_id = getattr(ds, 'parent_dataset_id', None) if ds else None
            if not parent_id: break
            search_ids.append(parent_id)
            current_id = parent_id

    q = db.query(ApprovedCorrection)
    if search_ids:
        q = q.filter(ApprovedCorrection.dataset_id.in_(search_ids))

    rows = q.order_by(ApprovedCorrection.approved_at.desc()).limit(500).all()

    # Batch-load suggestions to retrieve correction_method and confidence_score
    suggestion_ids = [r.suggestion_id for r in rows if r.suggestion_id]
    sug_map: dict = {}
    if suggestion_ids:
        sugs = db.query(CorrectionSuggestion).filter(
            CorrectionSuggestion.id.in_(suggestion_ids)
        ).all()
        sug_map = {str(s.id): s for s in sugs}

    return [{"id": str(r.id), "suggestion_id": str(r.suggestion_id) if r.suggestion_id else None,
             "dataset_id": str(r.dataset_id), "field_name": r.field_name,
             "affected_rows": r.affected_rows or [],
             "original_value": r.original_value, "corrected_value": r.corrected_value,
             "correction_method": sug_map[str(r.suggestion_id)].correction_method if r.suggestion_id and str(r.suggestion_id) in sug_map else None,
             "confidence_score": float(sug_map[str(r.suggestion_id)].confidence_score) if r.suggestion_id and str(r.suggestion_id) in sug_map and sug_map[str(r.suggestion_id)].confidence_score is not None else None,
             "applied_to_production": r.applied_to_production,
             "applied_at": r.applied_at.isoformat() if r.applied_at else None,
             "approved_at": r.approved_at.isoformat() if r.approved_at else None,
             "override_reason": None}
            for r in rows]

@router.post("/apply/{dataset_id}")
def apply_corrections(dataset_id: UUID, db: Session = Depends(get_db),
                       user=Depends(get_current_user)):
    pending = db.query(ApprovedCorrection).filter(
        ApprovedCorrection.dataset_id == dataset_id,
        ApprovedCorrection.applied_to_production == False).all()
    count = 0
    for a in pending:
        a.applied_to_production = True
        a.applied_at = datetime.utcnow()
        count += 1
    db.add(AuditLog(event_type="correction_applied", entity_type="dataset",
                    entity_id=dataset_id, actor_id=user.id, actor_role=user.role,
                    after_state={"corrections_applied": count}))
    db.commit()
    return {"message": f"Applied {count} corrections to production", "count": count}

@router.get("/export/{dataset_id}")
def export_corrected(dataset_id: UUID, db: Session = Depends(get_db),
                      user=Depends(get_current_user)):
    """
    Return a presigned S3 URL (15 min TTL) for the corrected CSV export.
    Falls back to inline csv_preview for local/dev environments without S3.
    """
    import tempfile
    import uuid as _uuid

    import boto3
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    pass_number = getattr(dataset, 'pass_number', 0) or 0

    # Collect all corrections from this dataset AND all parent datasets in chain
    search_ids = [dataset_id]
    current_id = dataset_id
    for _ in range(10):
        ds = db.query(Dataset).filter(Dataset.id == current_id).first()
        parent_id = getattr(ds, 'parent_dataset_id', None) if ds else None
        if not parent_id: break
        search_ids.append(parent_id)
        current_id = parent_id

    approved = db.query(ApprovedCorrection).filter(
        ApprovedCorrection.dataset_id.in_(search_ids),
        ApprovedCorrection.applied_to_production == True
    ).all()

    # Load the base dataframe
    if pass_number > 0:
        df = _load_df(dataset)
    else:
        df = _load_df(dataset)
        if df is None:
            raise HTTPException(500, "Dataset file not found. Re-upload the original file.")
        # Apply corrections to the original
        for a in approved:
            field = a.field_name
            rows  = a.affected_rows or []
            value = a.corrected_value
            if field and field in df.columns and rows:
                try:
                    if isinstance(value, list):
                        for i, r in enumerate(rows):
                            if r < len(df) and i < len(value): df.loc[r, field] = value[i]
                    else:
                        df.loc[rows, field] = value
                except Exception:
                    pass

    row_count = len(df) if df is not None else 0

    # Try to upload to S3 and return a presigned URL (F028)
    bucket = os.environ.get("AWS_S3_BUCKET", "")
    if bucket and df is not None:
        try:
            export_key = f"exports/{_uuid.uuid4()}.csv"
            with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
                df.to_csv(tmp.name, index=False)
                tmp_path = tmp.name
            s3 = boto3.client("s3")
            s3.upload_file(tmp_path, bucket, export_key,
                           ExtraArgs={"ContentType": "text/csv",
                                      "ContentDisposition": f'attachment; filename="export_{dataset_id}.csv"'})
            os.unlink(tmp_path)
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": export_key},
                ExpiresIn=900,  # 15 minutes
            )
            return {
                "corrections_applied": len(approved),
                "row_count": row_count,
                "pass_number": pass_number,
                "download_url": url,
                "expires_in_seconds": 900,
            }
        except Exception as e:
            logger.warning("S3 export failed, falling back to inline CSV: %s", e)

    # Local / dev fallback: return inline CSV (small datasets only)
    csv_preview = df.to_csv(index=False) if df is not None else ""
    return {
        "corrections_applied": len(approved),
        "row_count": row_count,
        "pass_number": pass_number,
        "csv_preview": csv_preview,
        "download_url": None,
    }


@router.post("/rerun/{dataset_id}")
def rerun_dqa_on_corrected(dataset_id: UUID, db: Session = Depends(get_db),
                             user=Depends(get_current_user)):
    """
    Iterative correction pass:
    1. Applies all approved corrections to the original dataset
    2. Saves the result as a new versioned dataset (pass1, pass2, ...)
    3. Triggers a new DQA run on the corrected dataset
    4. Returns the new dataset_id so the frontend can auto-switch to it
    """
    import os
    import re
    import threading
    import uuid as uuid_mod

    from app.models import Dataset as DS
    from app.models import DQARun

    # Load the original dataset
    dataset = db.query(DS).filter(DS.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    approved = db.query(ApprovedCorrection).filter(
        ApprovedCorrection.dataset_id == dataset_id,
        ApprovedCorrection.applied_to_production == True
    ).all()
    if not approved:
        raise HTTPException(400, "No applied corrections found. Click 'Apply All to Production' first.")

    # Load and apply corrections to the dataframe
    df = _load_df(dataset)
    if df is None:
        raise HTTPException(500, "Original dataset file not available. Re-upload the file and try again.")

    for a in approved:
        field = a.field_name
        rows  = a.affected_rows or []
        value = a.corrected_value
        if field and field in df.columns and rows:
            try:
                if isinstance(value, list):
                    for i, r in enumerate(rows):
                        if r < len(df) and i < len(value):
                            df.loc[r, field] = value[i]
                else:
                    df.loc[rows, field] = value
            except Exception:
                pass

    # Determine pass number from parent lineage
    current_pass = getattr(dataset, 'pass_number', 0) or 0
    new_pass_num = current_pass + 1

    # Build clean filename: strip existing _passN suffix then add new
    base_name = os.path.splitext(dataset.name or "dataset")[0]
    base_name = re.sub(r'_pass[0-9]+$', '', base_name)
    new_name = f"{base_name}_pass{new_pass_num}.csv"

    # Save corrected CSV — upload to S3 (or local in dev)
    upload_dir = os.environ.get("UPLOAD_DIR", "/app/uploads")
    os.makedirs(upload_dir, exist_ok=True)
    tmp_path = os.path.join(upload_dir, f"{uuid_mod.uuid4()}.csv")
    df.to_csv(tmp_path, index=False)
    s3_key = f"uploads/{os.path.basename(tmp_path)}"
    new_path = storage.save(tmp_path, s3_key)   # uploads to S3 and removes tmp, or returns local path

    # Create new Dataset record with lineage
    new_dataset = DS(
        project_id=dataset.project_id,
        name=new_name,
        source_type="csv",
        storage_path=new_path,
        row_count=len(df),
        column_count=len(df.columns),
        status="ready",
        ingested_by=user.id,
    )
    # Set lineage if columns exist
    try:
        new_dataset.parent_dataset_id = dataset_id
        new_dataset.pass_number = new_pass_num
    except Exception:
        pass

    db.add(new_dataset)
    db.flush()

    # Trigger DQA run on the corrected dataset
    new_run = DQARun(
        dataset_id=new_dataset.id,
        project_id=dataset.project_id,
        triggered_by=user.id,
        status="queued",
    )
    db.add(new_run)
    db.commit()
    db.refresh(new_run)

    # Execute DQA in background thread (non-blocking)
    from app.api.v1.runs import _execute_dqa
    t = threading.Thread(target=_execute_dqa, args=(str(new_run.id),), daemon=True)
    t.start()

    logger.info(f"Pass {new_pass_num}: new dataset {new_dataset.id}, run {new_run.id}")
    return {
        "message": f"Pass {new_pass_num} created: '{new_name}'. DQA is running.",
        "new_dataset_id": str(new_dataset.id),
        "new_dataset_name": new_name,
        "new_run_id": str(new_run.id),
        "pass_number": new_pass_num,
        "corrections_applied": len(approved),
        "rows": len(df),
    }
