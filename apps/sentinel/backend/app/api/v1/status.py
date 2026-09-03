"""
Platform Health & Status Page — checks Backend, DB, S3, LLM, last ingest.
GET /api/v1/status/
"""
import logging
import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user

router = APIRouter()
logger = logging.getLogger("datasentinel.status")


def _check_db(db: Session) -> dict:
    t0 = time.perf_counter()
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"status": "ok", "response_ms": ms}
    except Exception as exc:
        return {"status": "error", "error": str(exc)[:120]}


def _check_s3() -> dict:
    from app.core.config import settings
    if not settings.AWS_S3_BUCKET:
        return {"status": "not_configured", "note": "Using local storage"}
    t0 = time.perf_counter()
    try:
        import boto3
        s3 = boto3.client("s3", region_name=settings.AWS_REGION)
        s3.head_bucket(Bucket=settings.AWS_S3_BUCKET)
        ms = round((time.perf_counter() - t0) * 1000, 1)
        return {"status": "ok", "bucket": settings.AWS_S3_BUCKET, "response_ms": ms}
    except Exception as exc:
        return {"status": "error", "error": str(exc)[:120]}


def _check_llm() -> dict:
    from app.core.config import settings

    def _mask(val: str) -> str:
        if not val: return "❌ NOT SET"
        return f"✅ {val[:6]}…{val[-4:]}" if len(val) > 10 else "✅ (set)"

    provider = (settings.LLM_PROVIDER or "anthropic").lower()

    if provider == "anthropic":
        key_ok = bool(settings.ANTHROPIC_API_KEY)
        return {
            "status": "ok" if key_ok else "not_configured",
            "provider": "anthropic",
            "model": settings.LLM_MODEL or "claude-opus-4-5 (default)",
            "ANTHROPIC_API_KEY": _mask(settings.ANTHROPIC_API_KEY),
        }

    elif provider == "openai":
        key_ok = bool(settings.OPENAI_API_KEY)
        return {
            "status": "ok" if key_ok else "not_configured",
            "provider": "openai",
            "model": settings.LLM_MODEL or "gpt-4o (default)",
            "OPENAI_API_KEY": _mask(settings.OPENAI_API_KEY),
        }

    elif provider == "azure_openai":
        key_ok      = bool(settings.AZURE_OPENAI_API_KEY)
        endpoint_ok = bool(settings.AZURE_OPENAI_ENDPOINT)
        deploy_ok   = bool(settings.AZURE_OPENAI_DEPLOYMENT)
        all_ok = key_ok and endpoint_ok and deploy_ok
        return {
            "status": "ok" if all_ok else "not_configured",
            "provider": "azure_openai",
            "AZURE_OPENAI_API_KEY":      _mask(settings.AZURE_OPENAI_API_KEY),
            "AZURE_OPENAI_ENDPOINT":     settings.AZURE_OPENAI_ENDPOINT or "❌ NOT SET",
            "AZURE_OPENAI_DEPLOYMENT":   settings.AZURE_OPENAI_DEPLOYMENT or "❌ NOT SET",
            "AZURE_OPENAI_API_VERSION":  settings.AZURE_OPENAI_API_VERSION or "2024-02-15-preview (default)",
            "LLM_MODEL_OVERRIDE":        settings.LLM_MODEL or "(none — uses deployment name)",
            "missing": [k for k, ok in [
                ("AZURE_OPENAI_API_KEY", key_ok),
                ("AZURE_OPENAI_ENDPOINT", endpoint_ok),
                ("AZURE_OPENAI_DEPLOYMENT", deploy_ok),
            ] if not ok],
        }

    else:
        return {
            "status": "not_configured",
            "provider": provider,
            "note": f"Unknown LLM_PROVIDER '{provider}' — use anthropic / openai / azure_openai",
        }


def _last_ingest(db: Session) -> dict:
    try:
        from sqlalchemy import text
        row = db.execute(
            text("SELECT ingested_at FROM datasets ORDER BY ingested_at DESC LIMIT 1")
        ).fetchone()
        return {"last_ingest_at": row[0].isoformat() if row else None}
    except Exception:
        return {"last_ingest_at": None}


@router.get("/")
def platform_status(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Comprehensive health check — full detail for admin, basic status for others."""
    # Non-admin users get a simple operational check (no internal infrastructure details)
    if user.role not in ("admin", "super_admin"):
        return {"overall": "healthy", "status": "operational"}

    t_start = time.perf_counter()

    db_check   = _check_db(db)
    s3_check   = _check_s3()
    llm_check  = _check_llm()
    ingest_info = _last_ingest(db)

    total_ms = round((time.perf_counter() - t_start) * 1000, 1)

    # Count key entities
    try:
        from sqlalchemy import text
        counts = {}
        for tbl in ("projects", "datasets", "dqa_runs", "dqa_violations", "users"):
            try:
                row = db.execute(text(f"SELECT COUNT(*) FROM {tbl}")).fetchone()
                counts[tbl] = row[0] if row else 0
            except Exception:
                counts[tbl] = None
    except Exception:
        counts = {}

    services = {
        "backend": {"status": "ok", "note": "API server running"},
        "database": db_check,
        "storage":  s3_check,
        "llm":      llm_check,
    }
    all_ok = all(
        s.get("status") in ("ok", "not_configured")
        for s in services.values()
    )

    return {
        "overall": "healthy" if all_ok else "degraded",
        "check_duration_ms": total_ms,
        "services":          services,
        "platform_counts":   counts,
        "last_ingest_at":    ingest_info.get("last_ingest_at"),
        "version":           "1.0.0",
        "environment":       __import__("os").environ.get("ENVIRONMENT", "development"),
    }
