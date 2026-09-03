
import os as _os

_sentry_dsn = _os.environ.get("SENTRY_DSN", "")
if _sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    sentry_sdk.init(
        dsn=_sentry_dsn,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=0.1,
        environment=_os.environ.get("ENVIRONMENT", "production"),
    )

# Single logging setup — avoid double-initialization (FINDING-016)
from app.core.logging_config import logger, setup_logging

setup_logging()

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from app.api.v1 import (
    ai_engine,
    audit,
    auth,
    corrections,
    datasets,
    projects,
    rules,
    runs,
    violations,
)
from app.api.v1.anomaly import router as anomaly_router
from app.api.v1.rule_studio import router as rule_studio_router
from app.api.v1.api_keys import router as api_keys_router
from app.api.v1.calibration import router as calibration_router
from app.api.v1.chat import router as chat_router
from app.api.v1.connectors import router as connectors_router
from app.api.v1.digest import router as digest_router
from app.api.v1.ingest import router as ingest_router
from app.api.v1.knowledge_base import router as kb_router
from app.api.v1.microsoft_auth import router as microsoft_auth_router
from app.api.v1.ml_hub import router as ml_hub_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.reports import router as reports_router
from app.api.v1.retention import router as retention_router
from app.api.v1.schedules import router as schedules_router
from app.api.v1.status import router as status_router
from app.api.v1.submission import router as submission_router
from app.api.v1.webhooks import router as webhooks_router
from app.api.v2.protocols import router as protocols_router
from app.api.v2.reviewer import router as reviewer_router
from app.api.v2.vv import router as vv_router
from app.core.config import settings
from app.core.limiter import limiter


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan — replaces deprecated on_event (FINDING-020)."""
    logger.info("DataSentinel DQA Platform starting up")
    from app.core.startup import create_default_admin, run_migrations
    run_migrations()   # legacy idempotent SQL (safety net for cold starts)
    # F019: run Alembic migrations so incremental schema changes are applied
    try:
        import os

        from alembic.config import Config as AlembicConfig

        from alembic import command as alembic_cmd
        alembic_cfg = AlembicConfig(
            os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
        )
        alembic_cmd.upgrade(alembic_cfg, "head")
        logger.info("Alembic migrations applied (or already at head)")
    except Exception as exc:
        logger.warning("Alembic upgrade skipped: %s", exc)
    create_default_admin()
    from app.core.scheduler import start_scheduler
    start_scheduler()
    logger.info("Startup complete")
    yield
    from app.core.scheduler import stop_scheduler
    stop_scheduler()
    logger.info("Shutdown complete")


app = FastAPI(
    title="DataSentinel DQA Platform",
    description="Data Quality Assessment & Error Correction API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── F003: Security headers middleware ──────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: StarletteResponse = await call_next(request)
        is_prod = settings.ENVIRONMENT == "production"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "font-src 'self' data:; "
            "frame-ancestors 'none';"
        )
        if is_prod:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── F016: CORS — restrict to configured origins and explicit methods ───────────
_raw_origins = settings.ALLOWED_ORIGINS or "http://localhost:3000"
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
# Reject wildcard in production
if settings.ENVIRONMENT == "production" and "*" in _allowed_origins:
    import sys
    logger.critical("ALLOWED_ORIGINS contains '*' in production — refusing to start")
    sys.exit(1)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

# Configurable upload directory (FINDING-035)
# Wrapped in try/except so importing app.main in test environments (where
# the default /app/uploads cannot be created) does not blow up the import chain.
upload_dir = Path(settings.UPLOAD_DIR)
try:
    upload_dir.mkdir(parents=True, exist_ok=True)
except OSError as _mkdir_exc:
    import logging as _log_
    _log_.getLogger("datasentinel").warning(
        "Could not create upload dir %s — file uploads will fail at runtime: %s",
        upload_dir, _mkdir_exc,
    )

app.include_router(auth.router,        prefix="/api/v1/auth",        tags=["Auth"])
app.include_router(microsoft_auth_router, prefix="/api/v1/auth/microsoft", tags=["Auth"])
app.include_router(projects.router,    prefix="/api/v1/projects",    tags=["Projects"])
app.include_router(datasets.router,    prefix="/api/v1/datasets",    tags=["Datasets"])
app.include_router(rules.router,       prefix="/api/v1/rules",       tags=["Rules"])
app.include_router(runs.router,        prefix="/api/v1/runs",        tags=["Runs"])
app.include_router(violations.router,  prefix="/api/v1/violations",  tags=["Violations"])
app.include_router(corrections.router, prefix="/api/v1/corrections", tags=["Corrections"])
app.include_router(ai_engine.router,   prefix="/api/v1/ai",          tags=["AI Engine"])
app.include_router(audit.router,       prefix="/api/v1/audit",       tags=["Audit"])
app.include_router(schedules_router,   prefix="/api/v1/schedules",   tags=["Schedules"])
app.include_router(kb_router,          prefix="/api/v1/knowledge-base", tags=["KnowledgeBase"])
app.include_router(anomaly_router,     prefix="/api/v1/anomaly",       tags=["Anomaly"])
app.include_router(rule_studio_router, prefix="/api/v1/rule-studio",   tags=["Rule Studio"])
app.include_router(vv_router,           prefix="/api/v2/vv",          tags=["V&V"])
app.include_router(protocols_router,    prefix="/api/v2/protocols",   tags=["Protocol Registry"])
app.include_router(reviewer_router,     prefix="/api/v2/reviewer",    tags=["Reviewer Platform"])
app.include_router(chat_router,          prefix="/api/v1/chat",          tags=["AI Chat"])
app.include_router(notifications_router, prefix="/api/v1/notifications", tags=["Notifications"])
app.include_router(api_keys_router,      prefix="/api/v1/api-keys",      tags=["API Keys"])
app.include_router(ingest_router,        prefix="/api/v1/ingest",        tags=["Ingest"])
app.include_router(webhooks_router,      prefix="/api/v1/webhooks",      tags=["Webhooks"])
app.include_router(calibration_router,   prefix="/api/v1/calibration",   tags=["Calibration"])
app.include_router(submission_router,    prefix="/api/v1/submission",    tags=["Submission"])
app.include_router(status_router,        prefix="/api/v1/status",        tags=["Status"])
app.include_router(retention_router,     prefix="/api/v1/retention",     tags=["Retention"])
app.include_router(digest_router,        prefix="/api/v1/digest",         tags=["Digest"])
app.include_router(ml_hub_router,        prefix="/api/v1",               tags=["ML Hub"])
app.include_router(connectors_router,    prefix="/api/v1/connectors",    tags=["Connectors"])
app.include_router(reports_router,       prefix="/api/v1/reports",       tags=["Reports"])


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "DataSentinel"}
