"""
DataSentinel Celery tasks:
  - run_dqa_task           : async DQA run execution
  - retrain_dqa_model      : nightly XGBoost retraining from approved corrections
  - retrain_anomaly_models : nightly Isolation Forest + XGBoost retraining from TP/FP feedback
  - run_protocol_monitor   : weekly protocol website health check (Celery Beat — single process)
"""
import logging

logger = logging.getLogger("datasentinel.tasks")

from app.tasks.celery_app import celery_app

# ── DQA run ───────────────────────────────────────────────────────────────────

@celery_app.task(name="run_dqa_task", bind=True, max_retries=3)
def run_dqa_task(self, run_id: str):
    from app.api.v1.runs import _execute_dqa
    # _execute_dqa manages its own DB session internally
    _execute_dqa(run_id)


# ── DQA XGBoost retraining ────────────────────────────────────────────────────

@celery_app.task(name="retrain_dqa_model", bind=True, max_retries=2,
                 soft_time_limit=600, time_limit=720)
def retrain_dqa_model(self):
    """
    Nightly: pull approved corrections + ai_training_feedback, retrain XGBoost,
    persist to S3, hot-reload in-memory model.
    Skips if fewer than 50 untrained samples exist.
    """
    from sqlalchemy import text

    from app.core.database import SessionLocal
    from app.ml import dqa_xgb, model_store

    MIN_SAMPLES = dqa_xgb.MIN_SAMPLES
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT f.id, f.field_name, f.error_type, f.feature_vector, f.target_value,
                   cs.correction_method
            FROM ai_training_feedback f
            LEFT JOIN approved_corrections ac ON ac.id = f.correction_id
            LEFT JOIN correction_suggestions cs ON cs.id = ac.suggestion_id
            WHERE f.used_in_training = FALSE
        """)).fetchall()

        if len(rows) < MIN_SAMPLES:
            logger.info("DQA retrain skipped — only %d samples (need %d)", len(rows), MIN_SAMPLES)
            return {"status": "skipped", "reason": f"{len(rows)} < {MIN_SAMPLES} samples"}

        feedback_records = [
            {
                "feature_vector": {"field_name": r.field_name, "error_type": r.error_type,
                                   **(r.feature_vector or {})},
                "target_value": r.target_value,
                "correction_method": r.correction_method or r.error_type or "",
            }
            for r in rows
        ]

        model, metrics = dqa_xgb.train_dqa_model(feedback_records)
        s3_path = model_store.save_model_s3("dqa_xgb", model)
        model_store.set_cached("dqa_xgb", model)
        version_id = model_store.record_model_version(
            db, "dqa_xgb", s3_path, len(rows), metrics
        )

        # Mark feedback records as used
        ids = [str(r.id) for r in rows]
        db.execute(text("""
            UPDATE ai_training_feedback SET used_in_training = TRUE
            WHERE id = ANY(:ids::uuid[])
        """), {"ids": ids})
        db.commit()

        logger.info("DQA XGBoost retrained: version=%s metrics=%s", version_id, metrics)
        return {"status": "success", "version_id": version_id,
                "sample_count": len(rows), "metrics": metrics}

    except ValueError as e:
        logger.info("DQA retrain skipped: %s", e)
        return {"status": "skipped", "reason": str(e)}
    except Exception as e:
        logger.error("DQA retrain failed: %s", e, exc_info=True)
        raise self.retry(exc=e, countdown=300)
    finally:
        db.close()


# ── Anomaly model retraining ──────────────────────────────────────────────────

@celery_app.task(name="retrain_anomaly_models", bind=True, max_retries=2,
                 soft_time_limit=900, time_limit=1020)
def retrain_anomaly_models(self):
    """
    Nightly: pull anomaly TP/FP feedback, retrain Isolation Forest + XGBoost ensemble
    classifier, update ensemble weights, persist to S3, hot-reload.
    Skips if fewer than 30 untrained labels exist.
    """

    from sqlalchemy import text

    from app.core.database import SessionLocal
    from app.ml import anomaly_xgb, model_store

    MIN_SAMPLES = anomaly_xgb.MIN_SAMPLES
    db = SessionLocal()
    try:
        # ── 1. Pull labeled feedback ──────────────────────────────────────
        rows = db.execute(text("""
            SELECT id, feature_vector, label
            FROM anomaly_feedback
            WHERE used_in_training = FALSE
            ORDER BY labeled_at DESC
        """)).fetchall()

        if len(rows) < MIN_SAMPLES:
            logger.info("Anomaly retrain skipped — only %d labels (need %d)", len(rows), MIN_SAMPLES)
            return {"status": "skipped", "reason": f"{len(rows)} < {MIN_SAMPLES} labels"}

        feedback_records = [
            {"feature_vector": r.feature_vector, "label": r.label}
            for r in rows
        ]

        # ── 2. Retrain XGBoost ensemble classifier ───────────────────────
        xgb_model, xgb_metrics = anomaly_xgb.train_anomaly_model(feedback_records)
        xgb_s3 = model_store.save_model_s3("anomaly_xgb", xgb_model)
        model_store.set_cached("anomaly_xgb", xgb_model)
        xgb_version = model_store.record_model_version(
            db, "anomaly_xgb", xgb_s3, len(rows), xgb_metrics
        )

        # ── 3. Update ensemble weights from model accuracy ───────────────
        weights = anomaly_xgb.update_ensemble_weights(feedback_records)
        w_s3 = model_store.save_model_s3("anomaly_weights", weights)
        model_store.set_cached("anomaly_weights", weights)
        model_store.record_model_version(
            db, "anomaly_weights", w_s3, len(rows),
            {"weights": weights}
        )

        # ── 4. Refit Isolation Forest on all recent detection data ───────
        try:
            recent = db.execute(text("""
                SELECT result FROM anomaly_detection_runs
                WHERE created_at > now() - interval '90 days'
                ORDER BY created_at DESC LIMIT 500
            """)).fetchall()

            all_values = []
            for run in recent:
                result = run.result or {}
                for a in result.get("anomalies", []):
                    all_values.append(float(a.get("value", 0)))
                for ps in result.get("parameter_stats", []):
                    stats = ps.get("stats") or {}
                    if stats.get("mean") is not None:
                        all_values.append(float(stats["mean"]))

            if len(all_values) >= 50:
                import numpy as np
                from sklearn.ensemble import IsolationForest
                clf = IsolationForest(contamination=0.1, random_state=42, n_estimators=150)
                clf.fit(np.array(all_values).reshape(-1, 1))
                if_s3 = model_store.save_model_s3("anomaly_if", clf)
                model_store.set_cached("anomaly_if", clf)
                model_store.record_model_version(
                    db, "anomaly_if", if_s3, len(all_values),
                    {"n_samples": len(all_values), "contamination": 0.1}
                )
                logger.info("Isolation Forest refit on %d samples", len(all_values))
        except Exception as e:
            logger.warning("Isolation Forest refit failed (non-fatal): %s", e)

        # ── 5. Mark feedback as used ─────────────────────────────────────
        ids = [str(r.id) for r in rows]
        db.execute(text("""
            UPDATE anomaly_feedback SET used_in_training = TRUE
            WHERE id = ANY(:ids::uuid[])
        """), {"ids": ids})
        db.commit()

        logger.info("Anomaly models retrained: xgb_version=%s weights=%s", xgb_version, weights)
        return {
            "status": "success",
            "xgb_version": xgb_version,
            "ensemble_weights": weights,
            "sample_count": len(rows),
            "xgb_metrics": xgb_metrics,
        }

    except ValueError as e:
        logger.info("Anomaly retrain skipped: %s", e)
        return {"status": "skipped", "reason": str(e)}
    except Exception as e:
        logger.error("Anomaly retrain failed: %s", e, exc_info=True)
        raise self.retry(exc=e, countdown=300)
    finally:
        db.close()


# ── Garbage collection tasks ──────────────────────────────────────────────────

@celery_app.task(name="gc_revoked_tokens", bind=True, max_retries=1,
                 soft_time_limit=60, time_limit=90)
def gc_revoked_tokens(self):
    """Nightly: purge expired rows from revoked_tokens table to prevent unbounded growth."""
    from sqlalchemy import text

    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        result = db.execute(text(
            "DELETE FROM revoked_tokens WHERE expires_at < NOW()"
        ))
        db.commit()
        deleted = result.rowcount
        logger.info("gc_revoked_tokens: deleted %d expired rows", deleted)
        return {"status": "ok", "deleted": deleted}
    except Exception as e:
        logger.error("gc_revoked_tokens failed: %s", e, exc_info=True)
        raise self.retry(exc=e, countdown=60)
    finally:
        db.close()


@celery_app.task(name="gc_run_progress_events", bind=True, max_retries=1,
                 soft_time_limit=60, time_limit=90)
def gc_run_progress_events(self):
    """Nightly: purge stale SSE progress events older than 24 hours."""
    from sqlalchemy import text

    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        result = db.execute(text(
            "DELETE FROM run_progress_events WHERE created_at < NOW() - INTERVAL '24 hours'"
        ))
        db.commit()
        deleted = result.rowcount
        logger.info("gc_run_progress_events: deleted %d stale rows", deleted)
        return {"status": "ok", "deleted": deleted}
    except Exception as e:
        logger.error("gc_run_progress_events failed: %s", e, exc_info=True)
        raise self.retry(exc=e, countdown=60)
    finally:
        db.close()


# ── Protocol monitor (weekly via Celery Beat — single process, no duplicate runs) ──

@celery_app.task(name="run_protocol_monitor", bind=True, max_retries=1,
                 soft_time_limit=600, time_limit=720)
def run_protocol_monitor(self):
    """Weekly: check protocol registry websites for updates."""
    import asyncio
    try:
        from app.engines.vv.protocol_monitor import run_all_protocol_monitors
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(run_all_protocol_monitors())
            logger.info("Protocol monitor complete: %s", result)
            return result
        finally:
            loop.close()
    except Exception as e:
        logger.error("Protocol monitor failed: %s", e, exc_info=True)
        raise self.retry(exc=e, countdown=300)
