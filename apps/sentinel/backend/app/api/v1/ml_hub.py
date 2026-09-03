"""
ML Hub API — model status, anomaly feedback (TP/FP labels), manual retrain triggers.
Routes:
  GET  /api/v1/ml/status              — model registry (all versions)
  POST /api/v1/ml/retrain/dqa         — manual DQA retrain trigger
  POST /api/v1/ml/retrain/anomaly     — manual anomaly retrain trigger
  POST /api/v1/anomaly/feedback       — submit TP/FP label for an anomaly
  GET  /api/v1/anomaly/feedback       — list feedback for a project
"""
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user

logger = logging.getLogger("datasentinel.ml_hub")
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class AnomalyFeedbackIn(BaseModel):
    detection_run_id: Optional[str] = None
    project_id: str
    parameter: str
    row_index: int
    value: float
    label: int                          # 1 = true anomaly, 0 = false positive
    feature_vector: Optional[list] = None


# ── Model Hub ─────────────────────────────────────────────────────────────────

@router.get("/ml/status")
def ml_model_status(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Return current status of all ML models from the registry."""
    from app.ml.model_store import get_model_status
    try:
        models = get_model_status(db)
    except Exception:
        models = []

    # Also report cache state
    from app.ml import model_store
    cache_keys = list(model_store._cache.keys())

    return {
        "models": models,
        "cached_in_memory": cache_keys,
        "model_keys": list(model_store.MODEL_KEYS.keys()),
    }


# ── Manual retrain triggers ───────────────────────────────────────────────────

@router.post("/ml/retrain/dqa")
def trigger_dqa_retrain(background_tasks: BackgroundTasks,
                         db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    """Manually trigger DQA XGBoost retraining (admin only)."""
    if getattr(user, "role", "analyst") not in ("admin", "owner"):
        raise HTTPException(403, "Admin role required")
    try:
        from app.tasks.dqa_tasks import retrain_dqa_model
        task = retrain_dqa_model.delay()
        return {"status": "queued", "task_id": task.id,
                "message": "DQA retraining queued — check back in ~60 seconds"}
    except Exception as e:
        logger.error("DQA retrain trigger failed: %s", e)
        raise HTTPException(500, f"Failed to queue task: {e}")


@router.post("/ml/retrain/anomaly")
def trigger_anomaly_retrain(background_tasks: BackgroundTasks,
                              db: Session = Depends(get_db),
                              user=Depends(get_current_user)):
    """Manually trigger anomaly model retraining (admin only)."""
    if getattr(user, "role", "analyst") not in ("admin", "owner"):
        raise HTTPException(403, "Admin role required")
    try:
        from app.tasks.dqa_tasks import retrain_anomaly_models
        task = retrain_anomaly_models.delay()
        return {"status": "queued", "task_id": task.id,
                "message": "Anomaly retraining queued — check back in ~90 seconds"}
    except Exception as e:
        logger.error("Anomaly retrain trigger failed: %s", e)
        raise HTTPException(500, f"Failed to queue task: {e}")


# ── Anomaly Feedback ──────────────────────────────────────────────────────────

@router.post("/anomaly/feedback")
def submit_anomaly_feedback(payload: AnomalyFeedbackIn,
                             db: Session = Depends(get_db),
                             user=Depends(get_current_user)):
    """
    Store a TP/FP label for an anomaly detection result.
    Builds the feature vector from the detection run if not provided.
    """
    if payload.label not in (0, 1):
        raise HTTPException(400, "label must be 0 (false positive) or 1 (true anomaly)")

    fv = payload.feature_vector

    # Auto-build feature vector from stored detection run if not supplied
    if not fv and payload.detection_run_id:
        try:
            run_row = db.execute(text("""
                SELECT result FROM anomaly_detection_runs WHERE id = :rid
            """), {"rid": payload.detection_run_id}).fetchone()
            if run_row:
                result = run_row.result or {}
                matching = [
                    a for a in result.get("anomalies", [])
                    if a.get("parameter") == payload.parameter
                    and a.get("row_index") == payload.row_index
                ]
                if matching:
                    a = matching[0]
                    ps_list = result.get("parameter_stats", [])
                    ps = next((p for p in ps_list if p.get("parameter") == payload.parameter), {})
                    from app.ml.anomaly_xgb import build_anomaly_feature
                    fv = build_anomaly_feature(a, ps)
        except Exception as e:
            logger.warning("Auto-feature-vector build failed: %s", e)
            fv = None

    feedback_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO anomaly_feedback
            (id, detection_run_id, project_id, parameter, row_index, value,
             label, feature_vector, labeled_by, labeled_at)
        VALUES
            (:id, :run_id::uuid, :proj_id::uuid, :param, :ridx, :val,
             :lbl, :fv::jsonb, :user_id::uuid, now())
    """), {
        "id":      feedback_id,
        "run_id":  payload.detection_run_id,
        "proj_id": payload.project_id,
        "param":   payload.parameter,
        "ridx":    payload.row_index,
        "val":     payload.value,
        "lbl":     payload.label,
        "fv":      __import__("json").dumps(fv or []),
        "user_id": str(user.id),
    })
    db.commit()

    label_text = "True Anomaly" if payload.label == 1 else "False Positive"
    logger.info("Anomaly feedback stored: %s param=%s row=%d label=%s",
                feedback_id, payload.parameter, payload.row_index, label_text)

    return {
        "id":          feedback_id,
        "label":       payload.label,
        "label_text":  label_text,
        "parameter":   payload.parameter,
        "has_feature_vector": bool(fv),
    }


@router.get("/anomaly/feedback")
def list_anomaly_feedback(project_id: str,
                           db: Session = Depends(get_db),
                           user=Depends(get_current_user)):
    """List feedback labels for a project — used in Model Hub panel."""
    rows = db.execute(text("""
        SELECT id, parameter, row_index, value, label, labeled_at, used_in_training
        FROM anomaly_feedback
        WHERE project_id = :pid::uuid
        ORDER BY labeled_at DESC
        LIMIT 200
    """), {"pid": project_id}).fetchall()

    items = [
        {
            "id":               str(r.id),
            "parameter":        r.parameter,
            "row_index":        r.row_index,
            "value":            r.value,
            "label":            r.label,
            "label_text":       "True Anomaly" if r.label == 1 else "False Positive",
            "labeled_at":       r.labeled_at.isoformat() if r.labeled_at else None,
            "used_in_training": r.used_in_training,
        }
        for r in rows
    ]
    tp  = sum(1 for i in items if i["label"] == 1)
    fp  = sum(1 for i in items if i["label"] == 0)
    return {"items": items, "total": len(items), "true_positives": tp, "false_positives": fp}


# ── Task-32: IsolationForest anomaly scoring per dataset ──────────────────────

@router.get("/anomaly/dataset/{dataset_id}")
def dataset_anomaly_score(
    dataset_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Train an IsolationForest on historical violation patterns for this dataset
    and return an anomaly score (0–100, higher = more anomalous).
    Falls back to rule-of-thumb heuristics when fewer than 10 runs exist.
    """
    import numpy as np

    # Pull last 50 completed runs for this dataset
    runs = db.execute(text("""
        SELECT r.id, r.readiness_score, r.total_violations, r.rules_executed,
               r.data_coverage, r.gate_passed, r.triggered_at,
               COALESCE(r.dimension_scores, '{}'::jsonb) AS dimension_scores
        FROM dqa_runs r
        WHERE r.dataset_id = :did::uuid AND r.status = 'completed'
        ORDER BY r.triggered_at DESC
        LIMIT 50
    """), {"did": dataset_id}).fetchall()

    if not runs:
        return {
            "dataset_id":    dataset_id,
            "anomaly_score": None,
            "risk_level":    "unknown",
            "message":       "No completed runs found — run DQA at least once",
            "flagged_fields": [],
            "run_count":     0,
        }

    # Build feature matrix: [readiness, violations_rate, coverage, gate_passed, dim_scores...]
    DIMS = ["completeness", "integrity", "accuracy", "consistency", "timeliness", "uniqueness"]

    def _row_features(r) -> list[float]:
        rs = float(r.readiness_score or 0)
        vr = float(r.total_violations or 0) / max(float(r.rules_executed or 1), 1)
        cov = float(r.data_coverage or 1.0)
        gp = 1.0 if r.gate_passed else 0.0
        ds = r.dimension_scores if isinstance(r.dimension_scores, dict) else {}
        dim_vals = [float(ds.get(d, 0.5)) for d in DIMS]
        return [rs, vr, cov, gp] + dim_vals

    X = np.array([_row_features(r) for r in runs])

    if len(runs) < 10:
        # Heuristic: use last run stats directly
        last = runs[0]
        rs = float(last.readiness_score or 0)
        vr = float(last.total_violations or 0) / max(float(last.rules_executed or 1), 1)
        raw_score = max(0.0, (1 - rs) * 50 + vr * 50)
        score = round(min(100.0, raw_score), 1)
    else:
        from sklearn.ensemble import IsolationForest
        clf = IsolationForest(
            n_estimators=100,
            contamination=0.1,
            random_state=42,
        )
        clf.fit(X)
        # Score the most recent run
        last_feat = np.array([_row_features(runs[0])])
        raw = float(clf.decision_function(last_feat)[0])  # more negative = more anomalous
        # Normalise to 0–100 (0 = normal, 100 = highly anomalous)
        score = round(max(0.0, min(100.0, (-raw + 0.5) * 100)), 1)

    # Determine risk level
    if score >= 70:
        risk = "high"
    elif score >= 40:
        risk = "medium"
    else:
        risk = "low"

    # Identify fields with most violations in recent run
    flagged = db.execute(text("""
        SELECT v.affected_field, COUNT(*) AS cnt, v.severity
        FROM dqa_violations v
        JOIN dqa_runs r ON r.id = v.run_id
        WHERE r.dataset_id = :did::uuid AND r.status = 'completed'
        GROUP BY v.affected_field, v.severity
        ORDER BY cnt DESC
        LIMIT 5
    """), {"did": dataset_id}).fetchall()

    return {
        "dataset_id":    dataset_id,
        "anomaly_score": score,
        "risk_level":    risk,
        "run_count":     len(runs),
        "message":       f"Anomaly score based on {len(runs)} historical runs",
        "flagged_fields": [
            {"field": r.affected_field, "violation_count": r.cnt, "severity": r.severity}
            for r in flagged
        ],
    }
