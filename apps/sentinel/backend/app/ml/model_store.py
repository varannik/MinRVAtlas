"""
ML Model Store — persist/load XGBoost and Isolation Forest models via S3 + joblib.
Provides versioned model registry backed by the ml_models DB table.
"""
import io
import logging
import os
from typing import Any, Optional

import joblib

logger = logging.getLogger("datasentinel.ml.model_store")

# In-memory model cache  {model_key: (model_object, version_id)}
_cache: dict = {}

MODEL_KEYS = {
    "dqa_xgb":        "dqa/correction_xgb.joblib",
    "anomaly_if":     "anomaly/isolation_forest.joblib",
    "anomaly_xgb":    "anomaly/ensemble_xgb.joblib",
    "anomaly_weights":"anomaly/ensemble_weights.joblib",
}


# ── S3 helpers ────────────────────────────────────────────────────────────────

def _s3_client():
    import boto3
    return boto3.client("s3", region_name=os.environ.get("AWS_REGION", ""))


def _bucket() -> str:
    return os.environ.get("AWS_S3_BUCKET", "")


def save_model_s3(model_key: str, obj: Any) -> Optional[str]:
    """Serialize model with joblib, upload to S3, and write SHA-256 checksum."""
    import hashlib
    bucket = _bucket()
    if not bucket:
        logger.warning("AWS_S3_BUCKET not set — skipping S3 save for %s", model_key)
        return None
    s3_key = f"ml-models/{MODEL_KEYS.get(model_key, model_key)}"
    buf = io.BytesIO()
    joblib.dump(obj, buf, compress=3)
    model_bytes = buf.getvalue()
    sha256 = hashlib.sha256(model_bytes).hexdigest()
    try:
        s3 = _s3_client()
        s3.put_object(Bucket=bucket, Key=s3_key, Body=model_bytes)
        # Write checksum alongside model for integrity verification on load
        s3.put_object(Bucket=bucket, Key=s3_key + ".sha256", Body=sha256.encode())
        logger.info("Model saved to s3://%s/%s (sha256=%s…)", bucket, s3_key, sha256[:12])
        return s3_key
    except Exception as e:
        logger.error("S3 save failed for %s: %s", model_key, e)
        return None


def load_model_s3(model_key: str) -> Optional[Any]:
    """Download, integrity-verify, and deserialize model from S3. Returns None if not found."""
    import hashlib
    bucket = _bucket()
    if not bucket:
        return None
    s3_key = f"ml-models/{MODEL_KEYS.get(model_key, model_key)}"
    sha_key = s3_key + ".sha256"
    try:
        s3 = _s3_client()
        resp = s3.get_object(Bucket=bucket, Key=s3_key)
        model_bytes = resp["Body"].read()

        # Verify SHA-256 checksum if available (prevents model poisoning via pickle)
        try:
            sha_resp = s3.get_object(Bucket=bucket, Key=sha_key)
            expected_sha = sha_resp["Body"].read().decode().strip()
            actual_sha = hashlib.sha256(model_bytes).hexdigest()
            if actual_sha != expected_sha:
                logger.error(
                    "Model integrity check FAILED for %s: expected=%s actual=%s",
                    model_key, expected_sha, actual_sha,
                )
                return None
            logger.debug("Model integrity verified for %s", model_key)
        except Exception:
            # No checksum file — log warning but allow load (backward compatible)
            logger.warning("No SHA-256 checksum found for %s — consider regenerating", model_key)

        buf = io.BytesIO(model_bytes)
        obj = joblib.load(buf)
        logger.info("Model loaded from s3://%s/%s", bucket, s3_key)
        return obj
    except Exception as e:
        logger.debug("S3 load miss for %s: %s", model_key, e)
        return None


# ── Local cache helpers ───────────────────────────────────────────────────────

def get_cached(model_key: str) -> Optional[Any]:
    entry = _cache.get(model_key)
    return entry[0] if entry else None


def set_cached(model_key: str, obj: Any, version_id: str = ""):
    _cache[model_key] = (obj, version_id)


def load_or_none(model_key: str) -> Optional[Any]:
    """Return cached model, or try S3, or return None."""
    cached = get_cached(model_key)
    if cached is not None:
        return cached
    from_s3 = load_model_s3(model_key)
    if from_s3 is not None:
        set_cached(model_key, from_s3)
    return from_s3


# ── DB model registry ─────────────────────────────────────────────────────────

def record_model_version(db, model_key: str, s3_path: Optional[str],
                          sample_count: int, metrics: dict) -> str:
    """Insert a row into ml_models and return the version ID."""
    import uuid

    from sqlalchemy import text
    vid = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO ml_models (id, model_key, s3_path, sample_count, metrics, trained_at, is_active)
        VALUES (:id, :key, :s3, :sc, :m::jsonb, now(), true)
    """), {"id": vid, "key": model_key, "s3": s3_path, "sc": sample_count,
           "m": __import__("json").dumps(metrics)})
    # Deactivate older versions
    db.execute(text("""
        UPDATE ml_models SET is_active = false
        WHERE model_key = :key AND id != :id
    """), {"key": model_key, "id": vid})
    db.commit()
    return vid


def get_model_status(db) -> list:
    """Return status of all model versions for the Model Hub."""
    from sqlalchemy import text
    rows = db.execute(text("""
        SELECT model_key, sample_count, metrics, trained_at, is_active
        FROM ml_models ORDER BY trained_at DESC
    """)).fetchall()
    seen = set()
    result = []
    for r in rows:
        if r.model_key not in seen:
            seen.add(r.model_key)
            result.append({
                "model_key":    r.model_key,
                "sample_count": r.sample_count,
                "metrics":      r.metrics or {},
                "trained_at":   r.trained_at.isoformat() if r.trained_at else None,
                "is_active":    r.is_active,
            })
    return result
