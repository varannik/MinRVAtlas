import asyncio
import json
import os
import threading
from datetime import datetime
from typing import List
from uuid import UUID

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core import storage
from app.core.database import get_db
from app.core.security import get_current_user
from app.engines.dqa.engine import DQAEngine
from app.models import AuditLog, Dataset, DQARule, DQARun, DQAViolation, ProjectMember
from app.schemas import RunCreate, RunOut

# B3-#4: In-process SSE progress store.
# Maps run_id → list of progress strings published by _execute_dqa.
# Works in single-worker (dev) mode; in Celery mode the Celery task also
# writes here if it runs in the same process (won't work cross-worker, but
# the frontend falls back to polling seamlessly).
_progress_store: dict[str, list[str]] = {}
_progress_lock = threading.Lock()

# Hard cap on dataset rows to prevent OOM on very large files
MAX_ROWS = 5_000_000

import logging as _log

_runs_log = _log.getLogger("datasentinel.runs")

router = APIRouter()


def _publish_progress(run_id: str, step: str, pct: int, detail: str = "") -> None:
    """B3-#4 / Task-26: Append a progress event to the in-process store AND the DB.
    Writing to DB makes SSE work cross-worker (Celery worker → API worker)."""
    event = json.dumps({"step": step, "pct": pct, "detail": detail})
    with _progress_lock:
        if run_id not in _progress_store:
            _progress_store[run_id] = []
        _progress_store[run_id].append(event)
    # Persist to DB so cross-worker SSE can read it (fix: always close session)
    try:
        from sqlalchemy import text as _text

        from app.core.database import SessionLocal
        _db = SessionLocal()
        try:
            _db.execute(_text("""
                INSERT INTO run_progress_events (run_id, step, pct, detail)
                VALUES (:rid::uuid, :step, :pct, :detail)
            """), {"rid": run_id, "step": step[:100], "pct": pct, "detail": detail or ""})
            _db.commit()
        finally:
            _db.close()
    except Exception as _db_err:
        _runs_log.warning("_publish_progress: DB write failed for run %s: %s", run_id, _db_err)


def _require_project_access(db: Session, project_id, user) -> None:
    """Raise 403 if user is not admin/super_admin and not a project member."""
    role = getattr(user, 'role', '')
    if role in ('admin', 'super_admin'):
        return
    member = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user.id,
    ).first()
    if not member:
        raise HTTPException(403, "You don't have access to this project")

def _load_df(dataset: Dataset) -> pd.DataFrame:
    """Load dataset into a DataFrame — works for both local and S3 storage."""
    path = dataset.storage_path
    if not path:
        raise FileNotFoundError("Dataset has no storage path")
    ext = os.path.splitext(path)[1].lower()
    with storage.open_local(path, suffix=ext) as local_path:
        if ext == ".csv":
            return pd.read_csv(local_path)
        if ext == ".parquet":
            return pd.read_parquet(local_path)
        return pd.read_excel(local_path)

def _execute_dqa(run_id: str):
    from app.core.database import SessionLocal
    from app.models import Dataset, DQARun, DQAViolation
    db = SessionLocal()
    try:
      run = db.query(DQARun).filter(DQARun.id == run_id).first()
      if not run: db.close(); return
    except Exception:
      db.close(); return
    try:
        run.status = "running"; db.commit()
        _publish_progress(run_id, "Loading dataset", 5, "Reading data file…")
        dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
        df = _load_df(dataset)
        if len(df) > MAX_ROWS:
            raise ValueError(
                f"Dataset has {len(df):,} rows which exceeds the maximum of {MAX_ROWS:,}. "
                "Please split the file or contact your administrator."
            )
        _publish_progress(run_id, "Dataset loaded", 20, f"{len(df):,} rows · {len(df.columns)} columns")
        rules = db.query(DQARule).filter(
            DQARule.project_id == run.project_id,
            DQARule.is_active == True
        ).all()
        _publish_progress(run_id, "Rules loaded", 30, f"{len(rules)} active rules")
        # All active rules execute (dimension filtering removed for reliability)
        rules_dicts = [
            {"rule_id": r.rule_id, "rule_name": r.rule_name, "dimension": r.dimension,
             "severity": r.severity, "is_hard_gate": r.is_hard_gate,
             "weight": r.weight, "parameters": r.parameters, "is_active": r.is_active}
            for r in rules
        ]
        _publish_progress(run_id, "Executing rules", 50, "Running DQA engine…")
        engine = DQAEngine()
        result = engine.run(df, rules_dicts, ignore_hard_gates=bool(run.ignore_hard_gates))
        _publish_progress(run_id, "Persisting results", 80, f"{len(result['violations'])} violation(s) found")
        # Persist violations
        for v_data in result["violations"]:
            violation = DQAViolation(
                run_id=run.id, dataset_id=run.dataset_id,
                rule_id=v_data["rule_id"], rule_name=v_data["rule_name"],
                dimension=v_data["dimension"], severity=v_data["severity"],
                affected_field=v_data["affected_field"],
                affected_rows=v_data["affected_rows"][:200],
                record_count=v_data["record_count"],
                violation_detail=v_data["violation_detail"],
                confidence_score=v_data["confidence_score"],
                status="open"
            )
            db.add(violation)
        # Update run
        run.status = "completed"
        run.completed_at = datetime.utcnow()
        run.rules_executed = result["rules_executed"]
        run.total_violations = len(result["violations"])
        run.readiness_score = result.get("readiness_score", 0)
        run.data_coverage = result.get("data_coverage")
        run.dimension_scores = result.get("dimension_scores", {})
        run.gate_passed = result.get("gate_passed", False)
        run.error_message = result.get("gate_reason")
        # Audit
        db.add(AuditLog(
            event_type="dqa_run_completed", entity_type="dqa_run", entity_id=run.id,
            actor_id=run.triggered_by, actor_role="system",
            after_state={"readiness_score": run.readiness_score, "total_violations": run.total_violations}
        ))
        db.commit()
        _publish_progress(run_id, "Complete", 100, f"Readiness {round((run.readiness_score or 0)*100,1)}% | Gate {'PASSED' if run.gate_passed else 'FAILED'}")
        # Evict completed run from in-process store to prevent unbounded memory growth.
        # Must happen after the 100% event is appended so any in-process reader sees it.
        with _progress_lock:
            _progress_store.pop(run_id, None)
        # Fire in-app notification
        try:
            from app.api.v1.notifications import create_notification
            gate_str = "✅ PASSED" if run.gate_passed else "❌ FAILED"
            score = round((run.readiness_score or 0) * 100, 1)
            create_notification(
                db=db,
                title=f"DQA Run Complete — {gate_str}",
                message=f"Readiness {score}% | {run.total_violations} violation(s) detected.",
                event_type="dqa_completed",
                entity_id=run.id,
                entity_type="dqa_run",
            )
            # B2-#6: readiness threshold alert
            from app.models import Project as _Proj
            proj_cfg = db.query(_Proj).filter(_Proj.id == run.project_id).first()
            threshold = (proj_cfg.config or {}).get("readiness_alert_threshold") if proj_cfg else None
            if threshold is not None:
                try:
                    threshold = float(threshold)
                    if score < threshold:
                        create_notification(
                            db=db,
                            title=f"⚠ Readiness Alert — {score}% below {threshold:.0f}% threshold",
                            message=f"Project readiness dropped to {score}%. Your configured alert threshold is {threshold:.0f}%. Review violations immediately.",
                            event_type="readiness_alert",
                            entity_id=run.id,
                            entity_type="dqa_run",
                        )
                except (TypeError, ValueError):
                    pass
        except Exception:
            pass
        # Fire email + Slack/Teams webhooks
        try:
            from app.api.v1.webhooks import fire_project_webhooks
            from app.models import Project
            proj = db.query(Project).filter(Project.id == run.project_id).first()
            proj_name = proj.name if proj else "Unknown Project"
            fire_project_webhooks(
                db=db,
                project_id=str(run.project_id),
                gate_passed=bool(run.gate_passed),
                project_name=proj_name,
                readiness=run.readiness_score or 0,
                violations=run.total_violations or 0,
                run_id=str(run.id),
            )
            # Email alert on gate failure (uses global ALERT_EMAIL_TO setting)
            if not run.gate_passed:
                from app.services.email import send_gate_failure_alert
                send_gate_failure_alert(
                    project_name=proj_name,
                    run_id=str(run.id),
                    readiness=run.readiness_score or 0,
                    total_violations=run.total_violations or 0,
                    gate_reason=run.error_message or "",
                )
        except Exception as notify_err:
            # F015: log notification errors rather than silently swallowing them
            import logging as _log
            _log.getLogger("datasentinel.runs").warning("Post-run notification failed: %s", notify_err)
    except Exception as e:
        run.status = "failed"; run.error_message = str(e)
        run.completed_at = datetime.utcnow()
        try: db.commit()
        except Exception as commit_err:
            import logging as _log
            _log.getLogger("datasentinel.runs").warning("Failed to persist run failure state: %s", commit_err)
        try:
            from app.api.v1.notifications import create_notification
            from app.core.database import SessionLocal as _SL
            _db2 = _SL()
            create_notification(
                db=_db2,
                title="DQA Run Failed",
                message=f"Run {run_id} failed: {str(e)[:120]}",
                event_type="dqa_failed",
                entity_id=run.id,
                entity_type="dqa_run",
            )
            _db2.close()
        except Exception:
            pass
    finally:
        db.close()

@router.post("/", response_model=RunOut)
def create_run(data: RunCreate, background_tasks: BackgroundTasks,
               db: Session = Depends(get_db), user=Depends(get_current_user)):
    _require_project_access(db, data.project_id, user)
    dataset = db.query(Dataset).filter(Dataset.id == data.dataset_id).first()
    if not dataset: raise HTTPException(404, "Dataset not found")
    run = DQARun(dataset_id=data.dataset_id, project_id=data.project_id,
                 triggered_by=user.id, status="queued",
                 ignore_hard_gates=data.ignore_hard_gates)
    db.add(run); db.commit(); db.refresh(run)
    db.add(AuditLog(
        event_type="dqa_run_triggered", entity_type="dqa_run", entity_id=run.id,
        actor_id=user.id, actor_role=user.role,
        event_metadata={"dataset_id": str(data.dataset_id), "project_id": str(data.project_id)}
    ))
    db.commit()
    # F010: dispatch to Celery worker if available; fall back to FastAPI BackgroundTask
    try:
        from app.tasks.dqa_tasks import run_dqa_task
        run_dqa_task.delay(str(run.id))
    except Exception:
        # Celery broker not available (dev mode) — fall back to background thread
        background_tasks.add_task(_execute_dqa, str(run.id))
    return run

@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not r: raise HTTPException(404, "Run not found")
    # Fix #03: verify caller has access to the project that owns this run
    _require_project_access(db, r.project_id, user)
    return r

@router.get("/{run_id}/progress-stream")
async def run_progress_stream(
    run_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """B3-#4: SSE stream of DQA run progress events."""
    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    _require_project_access(db, run.project_id, user)
    run_id_str = str(run_id)

    async def event_generator():
        # Fix: use DB as the single source of truth for SSE events.
        # This eliminates the event-duplication bug caused by db_last_id not
        # advancing when in-process store events were consumed between DB polls.
        # The in-process store is still written to for backward-compat but is
        # not read here. Session always closed in finally (fix for connection leak).
        from sqlalchemy import text as _text

        from app.core.database import SessionLocal as _SL
        db_last_id = 0
        max_ticks = 300      # 5 min max (1-second ticks)
        tick = 0
        yield "data: " + json.dumps({"step": "Queued", "pct": 0, "detail": "Waiting for worker…"}) + "\n\n"

        while tick < max_ticks:
            _db = None
            try:
                _db = _SL()
                rows = _db.execute(_text("""
                    SELECT id, step, pct, detail FROM run_progress_events
                    WHERE run_id = :rid::uuid AND id > :last_id
                    ORDER BY id ASC LIMIT 50
                """), {"rid": run_id_str, "last_id": db_last_id}).fetchall()
                for row in rows:
                    db_last_id = row.id
                    evt_json = json.dumps({"step": row.step, "pct": row.pct, "detail": row.detail or ""})
                    yield f"data: {evt_json}\n\n"
                    if row.pct >= 100:
                        yield ": done\n\n"
                        return
            except Exception:
                pass
            finally:
                if _db is not None:
                    try:
                        _db.close()
                    except Exception:
                        pass

            # Heartbeat every 15 ticks to keep connection alive
            if tick % 15 == 0:
                yield ": heartbeat\n\n"

            await asyncio.sleep(1)
            tick += 1

        yield "data: " + json.dumps({"step": "Timeout", "pct": 100, "detail": "Stream timed out — check run status"}) + "\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # Nginx: disable buffering
        },
    )


@router.get("/dataset/{dataset_id}", response_model=List[RunOut])
def runs_for_dataset(dataset_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    # Verify user has access to the project this dataset belongs to
    ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if ds:
        _require_project_access(db, ds.project_id, user)
    return db.query(DQARun).filter(DQARun.dataset_id == dataset_id).order_by(DQARun.triggered_at.desc()).limit(20).all()

@router.get("/{run_id}/violations")
def run_violations(run_id: UUID, limit: int = 1000,
                   db: Session = Depends(get_db), user=Depends(get_current_user)):
    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    _require_project_access(db, run.project_id, user)
    # F009: cap results to prevent OOM on large runs
    limit = max(1, min(limit, 5000))
    viols = db.query(DQAViolation).filter(DQAViolation.run_id == run_id).limit(limit).all()
    return [{"id": str(v.id), "rule_id": v.rule_id, "rule_name": v.rule_name,
             "dimension": v.dimension, "severity": v.severity,
             "affected_field": v.affected_field, "record_count": v.record_count,
             "violation_detail": v.violation_detail, "status": v.status,
             "created_at": v.created_at.isoformat()} for v in viols]

@router.get("/{run_id}/ai-explain")
async def ai_explain_run(run_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Generate a plain-English Claude AI explanation of a completed DQA run."""
    from app.engines.ai.dqa_agent import explain_run
    from app.models import Project

    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    _require_project_access(db, run.project_id, user)
    if run.status != "completed":
        raise HTTPException(400, f"Run is not yet completed (status: {run.status})")

    violations = db.query(DQAViolation).filter(DQAViolation.run_id == run_id).limit(2000).all()
    dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
    project = db.query(Project).filter(Project.id == run.project_id).first()

    dataset_name = dataset.name if dataset else "Unknown Dataset"
    project_name = project.name if project else "Unknown Project"

    result = await explain_run(run, violations, dataset_name, project_name)
    return result

@router.get("/project/{project_id}/trend")
def runs_trend(project_id: UUID, limit: int = 30,
               db: Session = Depends(get_db), user=Depends(get_current_user)):
    _require_project_access(db, project_id, user)
    """Readiness score trend for a project — last N completed runs, oldest first for charting."""
    runs = (
        db.query(DQARun)
        .filter(DQARun.project_id == project_id, DQARun.status == "completed")
        .order_by(DQARun.triggered_at.desc())
        .limit(limit)
        .all()
    )
    runs = list(reversed(runs))
    return [
        {
            "date": r.triggered_at.strftime("%b %d"),
            "full_date": r.triggered_at.isoformat(),
            "readiness": round((r.readiness_score or 0) * 100, 1),
            "violations": r.total_violations or 0,
            "gate_passed": r.gate_passed,
            "run_id": str(r.id),
            "dimension_scores": {k: round(v * 100, 1) for k, v in (r.dimension_scores or {}).items()},
        }
        for r in runs
    ]

@router.get("/project/{project_id}")
def runs_for_project(project_id: UUID, limit: int = 20,
                     db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Recent DQA runs for a project (any status) — for run history views."""
    _require_project_access(db, project_id, user)
    runs = (
        db.query(DQARun)
        .filter(DQARun.project_id == project_id)
        .order_by(DQARun.triggered_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": str(r.id),
            "status": r.status,
            "triggered_at": r.triggered_at.isoformat(),
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            "readiness_score": r.readiness_score,
            "total_violations": r.total_violations,
            "gate_passed": r.gate_passed,
            "rules_executed": r.rules_executed,
        }
        for r in runs
    ]

@router.get("/project/{project_id}/predict")
def predict_readiness(project_id: UUID, horizon: int = 5,
                      db: Session = Depends(get_db), user=Depends(get_current_user)):
    _require_project_access(db, project_id, user)
    """Predict next N readiness scores using linear extrapolation from the last 20 runs."""
    import numpy as np
    runs = (
        db.query(DQARun)
        .filter(DQARun.project_id == project_id, DQARun.status == "completed")
        .order_by(DQARun.triggered_at.asc())
        .limit(20)
        .all()
    )
    if len(runs) < 2:
        return {"predictions": [], "confidence": "insufficient_data", "horizon": horizon}

    scores = [round((r.readiness_score or 0) * 100, 1) for r in runs]
    x = np.arange(len(scores), dtype=float)
    coeffs = np.polyfit(x, scores, 1)  # linear fit
    slope, intercept = float(coeffs[0]), float(coeffs[1])

    last_date = runs[-1].triggered_at
    avg_gap_seconds = (
        (runs[-1].triggered_at - runs[0].triggered_at).total_seconds() / max(len(runs) - 1, 1)
    )

    predictions = []
    for i in range(1, horizon + 1):
        pred_score = min(100.0, max(0.0, round(slope * (len(scores) + i - 1) + intercept, 1)))
        from datetime import timedelta
        pred_date = last_date + timedelta(seconds=avg_gap_seconds * i)
        predictions.append({
            "index": len(scores) + i,
            "date": pred_date.strftime("%b %d"),
            "readiness": pred_score,
            "is_forecast": True,
        })

    r2 = 0.0
    y_mean = sum(scores) / len(scores)
    ss_tot = sum((s - y_mean) ** 2 for s in scores)
    if ss_tot > 0:
        y_pred = [slope * i + intercept for i in x]
        ss_res = sum((s - p) ** 2 for s, p in zip(scores, y_pred))
        r2 = round(1 - ss_res / ss_tot, 3)

    confidence = "high" if r2 > 0.7 else "medium" if r2 > 0.4 else "low"
    return {
        "predictions": predictions,
        "trend_slope": round(slope, 3),
        "r2": r2,
        "confidence": confidence,
        "horizon": horizon,
        "based_on_runs": len(runs),
    }


@router.post("/ai-compare")
async def ai_compare_runs(data: dict, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """AI-powered comparison between two DQA runs."""
    from app.engines.ai.comparison_agent import compare_runs

    run_a_id = data.get("run_a_id")
    run_b_id = data.get("run_b_id")
    if not run_a_id or not run_b_id:
        raise HTTPException(400, "run_a_id and run_b_id are required")

    run_a = db.query(DQARun).filter(DQARun.id == run_a_id).first()
    run_b = db.query(DQARun).filter(DQARun.id == run_b_id).first()
    if not run_a or not run_b:
        raise HTTPException(404, "One or both runs not found")
    _require_project_access(db, run_a.project_id, user)
    _require_project_access(db, run_b.project_id, user)

    viols_a = db.query(DQAViolation).filter(DQAViolation.run_id == run_a.id).limit(2000).all()
    viols_b = db.query(DQAViolation).filter(DQAViolation.run_id == run_b.id).limit(2000).all()

    def _run_dict(r):
        return {
            "id": str(r.id), "date": r.triggered_at.isoformat() if r.triggered_at else "",
            "readiness_score": round((r.readiness_score or 0) * 100, 1),
            "total_violations": r.total_violations or 0,
            "gate_passed": r.gate_passed,
            "rules_executed": r.rules_executed or 0,
            "dimension_scores": {k: round(v * 100, 1) for k, v in (r.dimension_scores or {}).items()},
        }

    def _viol_list(vs):
        return [{"rule_id": v.rule_id, "rule_name": v.rule_name, "dimension": v.dimension,
                 "severity": v.severity, "affected_field": v.affected_field,
                 "record_count": v.record_count} for v in vs]

    result = await compare_runs(_run_dict(run_a), _run_dict(run_b), _viol_list(viols_a), _viol_list(viols_b))
    return result


@router.post("/{run_id}/ai-cluster")
async def ai_cluster_violations(run_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Cluster violations by root cause using AI."""
    from app.engines.ai.clustering_agent import cluster_violations

    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")

    violations = db.query(DQAViolation).filter(DQAViolation.run_id == run_id).limit(2000).all()
    if not violations:
        return {"clusters": [], "singleton_count": 0, "summary": "No violations to cluster."}

    dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
    result = await cluster_violations(violations, dataset_name=dataset.name if dataset else "")
    return result


@router.post("/{run_id}/ai-report-ping")
async def ai_narrative_ping(run_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Diagnostic: return run status without calling the LLM."""
    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run:
        raise HTTPException(404, "Run not found")
    return {"run_id": str(run_id), "status": run.status, "score": run.readiness_score}


@router.post("/{run_id}/ai-report")
async def ai_narrative_report(run_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Generate a V&V-ready AI narrative report for a completed DQA run."""
    import traceback, logging as _logging
    _log = _logging.getLogger("datasentinel.runs")
    try:
        from app.engines.ai.narrative_agent import generate_narrative
        from app.models import CorrectionSuggestion, Project

        run = db.query(DQARun).filter(DQARun.id == run_id).first()
        if not run:
            raise HTTPException(404, "Run not found")

        def _str(v):
            return str(v) if v is not None else None

        run_dict = {
            "id":               _str(run.id),
            "status":           run.status,
            "readiness_score":  run.readiness_score,
            "gate_passed":      run.gate_passed,
            "rules_executed":   run.rules_executed,
            "total_violations": run.total_violations,
            "dimension_scores": run.dimension_scores or {},
            "triggered_at":     _str(run.triggered_at),
        }

        if run_dict["status"] != "completed":
            raise HTTPException(400, f"Run must be completed (current status: {run_dict['status']})")

        violations_raw = db.query(DQAViolation).filter(DQAViolation.run_id == run_id).limit(2000).all()
        violation_ids = [v.id for v in violations_raw]
        corrections_raw = (
            db.query(CorrectionSuggestion)
            .filter(CorrectionSuggestion.violation_id.in_(violation_ids))
            .limit(1000)
            .all()
            if violation_ids else []
        )
        dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
        project = db.query(Project).filter(Project.id == run.project_id).first()

        violations_list = [
            {
                "rule_id":        v.rule_id,
                "rule_name":      v.rule_name,
                "severity":       v.severity,
                "affected_field": v.affected_field,
                "record_count":   v.record_count or 0,
            }
            for v in violations_raw
        ]
        project_dict = {"name": project.name if project else "Unknown Project"}
        dataset_name = dataset.name if dataset else "Unknown Dataset"
        correction_count = len(corrections_raw)

        result = await generate_narrative(
            run=run_dict,
            violations=violations_list,
            corrections=correction_count,
            project=project_dict,
            dataset_name=dataset_name,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        _log.error("ai_narrative_report failed: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, detail=f"{type(exc).__name__}: {exc}")


@router.get("/{run_id}/report")
def run_report(run_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    run = db.query(DQARun).filter(DQARun.id == run_id).first()
    if not run: raise HTTPException(404, "Run not found")
    viols = db.query(DQAViolation).filter(DQAViolation.run_id == run_id).limit(5000).all()
    return {
        "run_id": str(run_id),
        "status": run.status,
        "triggered_at": run.triggered_at.isoformat(),
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "rules_executed": run.rules_executed,
        "gate_passed": run.gate_passed,
        "readiness_score": run.readiness_score,
        "dimension_scores": run.dimension_scores,
        "total_violations": run.total_violations,
        "violations_by_severity": {
            sev: sum(1 for v in viols if v.severity == sev)
            for sev in ["critical", "high", "medium", "low"]
        },
        "violations_by_dimension": {
            dim: sum(1 for v in viols if v.dimension == dim)
            for dim in set(v.dimension for v in viols)
        },
        "violations": [{"rule_id": v.rule_id, "dimension": v.dimension,
                         "severity": v.severity, "affected_field": v.affected_field,
                         "record_count": v.record_count} for v in viols]
    }


@router.get("/project/{project_id}/compare-last")
def compare_last_two_runs(project_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """
    Quick comparison between the two most recent completed runs for a project.
    Returns delta in readiness, violation counts, and per-dimension changes.
    Used on Dashboard for the 'vs previous run' badge.
    """
    runs = (
        db.query(DQARun)
        .filter(DQARun.project_id == project_id, DQARun.status == "completed")
        .order_by(DQARun.triggered_at.desc())
        .limit(2)
        .all()
    )
    if len(runs) < 2:
        return {"available": False, "message": "Need at least 2 completed runs for comparison"}

    current, previous = runs[0], runs[1]
    cur_score  = round((current.readiness_score or 0) * 100, 1)
    prev_score = round((previous.readiness_score or 0) * 100, 1)
    delta      = round(cur_score - prev_score, 1)

    cur_dims  = current.dimension_scores or {}
    prev_dims = previous.dimension_scores or {}
    dim_deltas = {
        k: round(round((cur_dims.get(k, 0)) * 100, 1) - round((prev_dims.get(k, 0)) * 100, 1), 1)
        for k in set(list(cur_dims.keys()) + list(prev_dims.keys()))
    }

    return {
        "available": True,
        "current": {
            "run_id": str(current.id),
            "date": current.triggered_at.strftime("%b %d"),
            "readiness": cur_score,
            "violations": current.total_violations or 0,
            "gate_passed": current.gate_passed,
        },
        "previous": {
            "run_id": str(previous.id),
            "date": previous.triggered_at.strftime("%b %d"),
            "readiness": prev_score,
            "violations": previous.total_violations or 0,
            "gate_passed": previous.gate_passed,
        },
        "delta_readiness":   delta,
        "delta_violations":  (current.total_violations or 0) - (previous.total_violations or 0),
        "dimension_deltas":  dim_deltas,
        "improved":          delta > 0,
    }


@router.get("/project/{project_id}/dimension-sparklines")
def dimension_sparklines(
    project_id: UUID,
    limit: int = 20,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Return per-dimension score history for the last N runs.
    Used for field-level sparkline charts in violation detail panels.
    """
    runs = (
        db.query(DQARun)
        .filter(DQARun.project_id == project_id, DQARun.status == "completed")
        .order_by(DQARun.triggered_at.asc())
        .limit(limit)
        .all()
    )
    if not runs:
        return {"sparklines": {}, "dates": []}

    dims = ["completeness", "integrity", "accuracy", "consistency", "timeliness", "uniqueness"]
    dates = [r.triggered_at.strftime("%b %d") for r in runs]
    sparklines: dict = {d: [] for d in dims}
    for r in runs:
        scores = r.dimension_scores or {}
        for d in dims:
            val = scores.get(d)
            sparklines[d].append(round(val * 100, 1) if val is not None else None)

    return {"sparklines": sparklines, "dates": dates, "run_count": len(runs)}
