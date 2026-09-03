"""
Anomaly Detection API — v1
Three-model ensemble: Heuristic · Statistical · ML (Isolation Forest)
"""
import io
import logging
from typing import Any
from uuid import UUID

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user


class AnomalyRunPayload(BaseModel):
    model_params: dict = Field(default_factory=dict)
    custom_thresholds: dict | None = None

class RecommendPayload(BaseModel):
    anomaly: dict
    context: dict = Field(default_factory=dict)
    domain: str = "ccs"

class FeedbackPayload(BaseModel):
    parameter: str = ""
    dataset_id: str | None = None
    project_id: str | None = None
    original_value: Any = None
    corrected_value: Any = None
    correction_reason: str = ""
    accepted_suggestions: list = Field(default_factory=list)
    rejected_suggestions: list = Field(default_factory=list)
    user_recommendation: dict | None = None
from app.engines.anomaly.engine import DEFAULT_THRESHOLDS, AnomalyDetectionEngine
from app.models import Dataset

router = APIRouter()
logger = logging.getLogger("datasentinel.anomaly")
_engine = AnomalyDetectionEngine()


@router.get("/thresholds")
def list_thresholds(user=Depends(get_current_user)):
    """Return default parameter thresholds for UI display."""
    return {"thresholds": DEFAULT_THRESHOLDS}


@router.post("/run/{dataset_id}")
def run_anomaly_detection(
    dataset_id: UUID,
    payload: AnomalyRunPayload | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Run full anomaly detection on a stored dataset."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    import os
    path = dataset.storage_path
    if not path or not os.path.exists(path):
        raise HTTPException(400, "Dataset file not available — please re-upload")

    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".parquet":
            df = pd.read_parquet(path)
        elif ext in (".xlsx", ".xls"):
            df = pd.read_excel(path)
        else:
            df = pd.read_csv(path)
    except Exception as e:
        raise HTTPException(400, f"Could not read dataset: {e}")

    logger.info(f"Running anomaly detection on {dataset.name} ({len(df)} rows)")
    payload = payload or AnomalyRunPayload()
    custom_thresholds = payload.custom_thresholds
    model_params = payload.model_params
    result = _engine.run(df, custom_thresholds, model_params)
    result["dataset_id"]   = str(dataset_id)
    result["dataset_name"] = dataset.name
    return result


@router.post("/run-inline")
async def run_anomaly_inline(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Run anomaly detection on an uploaded CSV (no DB storage)."""
    MAX_UPLOAD = 50 * 1024 * 1024  # 50 MB
    if file.filename and not file.filename.lower().endswith('.csv'):
        raise HTTPException(400, "Only CSV files are accepted")
    content = await file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "File exceeds 50 MB limit")
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(400, f"Could not parse CSV: {e}")

    if len(df) == 0:
        raise HTTPException(400, "Uploaded file has no data rows")

    logger.info(f"Inline anomaly detection: {file.filename} ({len(df)} rows)")
    result = _engine.run(df)  # inline uses defaults
    result["dataset_name"] = file.filename
    return result


@router.get("/sample")
def get_sample_result(user=Depends(get_current_user)):
    """Return a sample anomaly detection result for UI demonstration."""
    import numpy as np
    np.random.seed(42)
    n = 60
    ts = pd.date_range("2024-03-01", periods=n, freq="1h")
    co2 = np.random.normal(4.5, 0.5, n)
    co2[14] = 85.0   # spike
    co2[39] = 0.01   # low-low
    pressure = np.random.normal(120, 8, n)
    pressure[27] = 260.0  # critical high
    df = pd.DataFrame({"timestamp_utc": ts, "CO2_FLOW_RATE": co2, "INJECTION_PRESSURE": pressure})
    result = _engine.run(df)  # inline uses defaults
    result["dataset_name"] = "Sample Demo Data"
    return result


@router.post("/recommend")
async def get_recommendations(
    payload: RecommendPayload,
    user=Depends(get_current_user),
):
    """
    Generate GenAI recommendations for a detected anomaly.
    Calls Claude API if ANTHROPIC_API_KEY is set, otherwise returns rule-based fallback.
    
    Payload: { anomaly: {...}, context: { co_occurring_anomalies, parameter_stats }, domain: "ccs"|"biochar"|"general" }
    """
    from app.engines.anomaly.genai_recommendations import generate_recommendations

    anomaly = payload.anomaly
    context = payload.context
    domain  = payload.domain
    if not anomaly:
        raise HTTPException(400, "anomaly object is required")

    result = await generate_recommendations(anomaly, context, domain)
    return result


@router.post("/recommendation-feedback")
def submit_recommendation_feedback(
    payload: FeedbackPayload,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Store user feedback on GenAI anomaly recommendations: accepted/rejected suggestions
    + user-written recommendation. Distinct from TP/FP ML labels (POST /anomaly/feedback
    in ml_hub) — this endpoint records recommendation quality for the audit trail.
    """
    import uuid as _uuid

    from app.models import AITrainingFeedback, AuditLog

    anomaly_parameter    = payload.parameter
    dataset_id           = payload.dataset_id
    project_id           = payload.project_id
    accepted_suggestions = payload.accepted_suggestions
    rejected_suggestions = payload.rejected_suggestions
    user_recommendation  = payload.user_recommendation or {}
    corrected_value      = payload.corrected_value
    original_value       = payload.original_value
    correction_reason    = payload.correction_reason

    # Store each accepted suggestion as AI training feedback
    for sug in accepted_suggestions:
        fb = AITrainingFeedback(
            dataset_id       = _uuid.UUID(dataset_id) if dataset_id else None,
            project_id       = _uuid.UUID(project_id) if project_id else None,
            field_name       = anomaly_parameter,
            error_type       = sug.get("action_type", "anomaly_detection") if isinstance(sug, dict) else "anomaly_detection",
            feature_vector   = {},   # no feature vector for recommendation feedback
            target_value     = corrected_value,
            used_in_training = False,
        )
        db.add(fb)

    # Audit log
    log = AuditLog(
        user_id = user.id,
        action  = "anomaly_feedback",
        resource_type = "anomaly",
        resource_id   = str(dataset_id or ""),
        details = {
            "parameter": anomaly_parameter,
            "accepted_count": len(accepted_suggestions),
            "rejected_count": len(rejected_suggestions),
            "user_recommendation": user_recommendation.get("title",""),
            "corrected_value": corrected_value,
            "original_value": original_value,
            "correction_reason": correction_reason,
        }
    )
    db.add(log)
    db.commit()

    return {
        "success": True,
        "message": f"Feedback recorded — {len(accepted_suggestions)} suggestions accepted",
        "training_records_created": len(accepted_suggestions),
        "next_training_cycle": "Monday",
        "labels_added_to_training_pool": len(accepted_suggestions),
        "next_scheduled_retrain": "02:30 UTC nightly (Celery beat)",
        "improvement_note": "XGBoost calibration accuracy will be measured after next retraining run once ≥30 labels are collected.",
    }


@router.get("/run/{dataset_id}/last")
def get_last_run(
    dataset_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Fetch the last anomaly detection result for a dataset.
    Called automatically when user selects a dataset — restores session from DB."""
    from app.models import AnomalyDetectionRun
    run = db.query(AnomalyDetectionRun).filter(
        AnomalyDetectionRun.dataset_id == dataset_id
    ).order_by(AnomalyDetectionRun.updated_at.desc()).first()
    if not run:
        return {"exists": False}
    return {
        "exists": True,
        "result":       run.result,
        "domain":       run.domain,
        "model_params": run.model_params,
        "analysed_keys": run.analysed_keys,
        "current_step": run.current_step,
        "updated_at":   run.updated_at.isoformat() if run.updated_at else None,
    }


@router.post("/run/{dataset_id}/save")
def save_run(
    dataset_id: UUID,
    payload: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Persist detection result to DB. Called after a successful detection run."""
    from app.models import AnomalyDetectionRun
    run = db.query(AnomalyDetectionRun).filter(
        AnomalyDetectionRun.dataset_id == dataset_id
    ).order_by(AnomalyDetectionRun.updated_at.desc()).first()
    if run:
        run.result       = payload.get("result", run.result)
        run.domain       = payload.get("domain", run.domain)
        run.model_params = payload.get("model_params", run.model_params)
        run.analysed_keys = payload.get("analysed_keys", run.analysed_keys)
        run.current_step = payload.get("current_step", run.current_step)
    else:
        project_id = payload.get("project_id")
        run = AnomalyDetectionRun(
            dataset_id   = dataset_id,
            project_id   = UUID(project_id) if project_id else None,
            result       = payload["result"],
            domain       = payload.get("domain", "ccs"),
            model_params = payload.get("model_params", {}),
            analysed_keys = payload.get("analysed_keys", []),
            current_step = payload.get("current_step", 2),
            created_by   = user.id,
        )
        db.add(run)
    db.commit()
    return {"saved": True}


@router.patch("/run/{dataset_id}/progress")
def update_progress(
    dataset_id: UUID,
    payload: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Lightweight update — save analysed_keys and current_step without re-saving the full result."""
    from app.models import AnomalyDetectionRun
    run = db.query(AnomalyDetectionRun).filter(
        AnomalyDetectionRun.dataset_id == dataset_id
    ).order_by(AnomalyDetectionRun.updated_at.desc()).first()
    if not run:
        return {"updated": False, "reason": "no run found"}
    if "analysed_keys" in payload:
        run.analysed_keys = payload["analysed_keys"]
    if "current_step" in payload:
        run.current_step = payload["current_step"]
    db.commit()
    return {"updated": True}
