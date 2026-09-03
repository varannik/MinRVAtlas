"""
Slack / Teams Webhook Integration — store per-project webhook URLs,
fire them on DQA gate events.
"""
import ipaddress
import logging
import re
import socket
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models import Project

router = APIRouter()
logger = logging.getLogger("datasentinel.webhooks")

# Fix #11: RFC 5322-compatible email regex used for alert_email validation
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


def _validate_alert_email(value: str) -> None:
    """Raise HTTPException if any address in a comma-separated list is malformed."""
    if not value:
        return
    for addr in value.split(","):
        addr = addr.strip()
        if addr and not _EMAIL_RE.match(addr):
            raise HTTPException(400, f"Invalid alert_email address: '{addr}'")

# Private/internal IP ranges that should never be reachable via user-supplied webhooks
_BLOCKED_RANGES = [
    ipaddress.ip_network("169.254.0.0/16"),   # link-local / AWS instance metadata
    ipaddress.ip_network("10.0.0.0/8"),        # RFC1918 private
    ipaddress.ip_network("172.16.0.0/12"),     # RFC1918 private
    ipaddress.ip_network("192.168.0.0/16"),    # RFC1918 private
    ipaddress.ip_network("127.0.0.0/8"),       # loopback
    ipaddress.ip_network("::1/128"),           # IPv6 loopback
    ipaddress.ip_network("fc00::/7"),          # IPv6 unique-local
]


def _validate_webhook_url(url: str) -> None:
    """Raise HTTPException if the URL is empty, non-HTTPS, or resolves to a private address."""
    if not url:
        return
    parsed = urlparse(url)
    if parsed.scheme not in ("https",):
        raise HTTPException(400, "Webhook URL must use HTTPS")
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(400, "Webhook URL has no hostname")
    try:
        ip_str = socket.gethostbyname(hostname)
        ip_obj = ipaddress.ip_address(ip_str)
        for net in _BLOCKED_RANGES:
            if ip_obj in net:
                raise HTTPException(400, f"Webhook URL resolves to a restricted address ({ip_str})")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Could not resolve webhook hostname — verify the URL is correct")


def _get_project(project_id: str, db: Session):
    p = db.query(Project).filter(Project.id == project_id, Project.is_active == True).first()
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.get("/")
def list_webhooks(project_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    p = _get_project(project_id, db)
    cfg = p.config or {}
    return {
        "project_id": str(p.id),
        "slack_webhook_url":   cfg.get("slack_webhook_url", ""),
        "teams_webhook_url":   cfg.get("teams_webhook_url", ""),
        "alert_email":         cfg.get("alert_email", ""),
        "notify_on_failure":   cfg.get("notify_on_failure", True),
        "notify_on_complete":  cfg.get("notify_on_complete", False),
    }


@router.put("/")
def update_webhooks(
    project_id: str,
    data: dict,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Update Slack/Teams webhook + email alert config for a project."""
    p = _get_project(project_id, db)
    cfg = dict(p.config or {})
    # Validate webhook URLs before storing
    for url_key in ("slack_webhook_url", "teams_webhook_url"):
        if url_key in data and data[url_key]:
            _validate_webhook_url(data[url_key])
    # Fix #11: validate alert_email format before persisting
    if "alert_email" in data and data["alert_email"]:
        _validate_alert_email(data["alert_email"])

    for key in ("slack_webhook_url", "teams_webhook_url", "alert_email",
                "notify_on_failure", "notify_on_complete"):
        if key in data:
            cfg[key] = data[key]
    p.config = cfg
    db.commit()
    return {"ok": True, "config": cfg}


@router.post("/test")
async def test_webhook(project_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Send a test message to configured webhooks."""
    from app.services.email import send_slack_webhook
    p = _get_project(project_id, db)
    cfg = p.config or {}
    results = {}

    if slack_url := cfg.get("slack_webhook_url", ""):
        ok = send_slack_webhook(slack_url, {
            "text": f"✅ DataSentinel test message from project *{p.name}*. Webhooks are configured correctly."
        })
        results["slack"] = "ok" if ok else "failed"

    if teams_url := cfg.get("teams_webhook_url", ""):
        ok = send_slack_webhook(teams_url, {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "summary": "DataSentinel test",
            "themeColor": "0078d4",
            "title": "DataSentinel Webhook Test",
            "text": f"✅ Test message from project **{p.name}**. Webhooks are configured correctly.",
        })
        results["teams"] = "ok" if ok else "failed"

    if not results:
        return {"ok": False, "message": "No webhooks configured for this project"}
    return {"ok": True, "results": results}


# ── Retry schedule (Task-31) ──────────────────────────────────────────────────
# Exponential backoff: 1m → 5m → 30m → 2h → 8h (max 5 attempts)
RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 28800]
MAX_RETRIES = 5


def _record_delivery(
    db: Session, project_id: str, run_id: str,
    webhook_type: str, url: str, payload: dict,
    status: str, http_status: int | None, error: str | None,
    retry_count: int = 0,
) -> None:
    """Persist a webhook delivery attempt to webhook_deliveries table."""
    import json as _json
    from datetime import datetime, timedelta

    from sqlalchemy import text as _text
    next_retry = None
    if status == "failed" and retry_count < MAX_RETRIES:
        delay = RETRY_DELAYS_SECONDS[min(retry_count, len(RETRY_DELAYS_SECONDS) - 1)]
        next_retry = datetime.utcnow() + timedelta(seconds=delay)

    try:
        db.execute(_text("""
            INSERT INTO webhook_deliveries
                (project_id, run_id, webhook_type, webhook_url, payload,
                 status, http_status, last_error, retry_count, next_retry_at,
                 delivered_at)
            VALUES
                (:pid, :rid, :wtype, :url, :payload::jsonb,
                 :status, :hstatus, :error, :retries, :next_retry,
                 CASE WHEN :status2 = 'ok' THEN NOW() ELSE NULL END)
        """), {
            "pid":        project_id,
            "rid":        run_id or None,
            "wtype":      webhook_type,
            "url":        url,
            "payload":    _json.dumps(payload),
            "status":     status,
            "hstatus":    http_status,
            "error":      error,
            "retries":    retry_count,
            "next_retry": next_retry,
            "status2":    status,
        })
        db.commit()
    except Exception as rec_exc:
        logger.warning("Failed to record webhook delivery: %s", rec_exc)
        try: db.rollback()
        except Exception: pass


def _fire_single_webhook(url: str, payload: dict, timeout: int = 10) -> tuple[bool, int | None, str | None]:
    """Fire one webhook. Returns (ok, http_status, error)."""
    try:
        import httpx
        resp = httpx.post(url, json=payload, timeout=timeout)
        ok = resp.status_code < 400
        return ok, resp.status_code, None if ok else f"HTTP {resp.status_code}"
    except Exception as exc:
        return False, None, str(exc)[:300]


def fire_project_webhooks(db: Session, project_id: str, gate_passed: bool,
                          project_name: str, readiness: float, violations: int,
                          run_id: str) -> None:
    """Called from run completion — fire Slack/Teams/email alerts with delivery tracking."""
    try:
        p = db.query(Project).filter(Project.id == project_id).first()
        if not p:
            return
        cfg = p.config or {}

        should_fire = (
            (not gate_passed and cfg.get("notify_on_failure", True)) or
            (gate_passed and cfg.get("notify_on_complete", False))
        )
        if not should_fire:
            return

        gate_emoji = "✅" if gate_passed else "❌"
        gate_label = "PASSED" if gate_passed else "FAILED"
        score_pct  = round(readiness * 100, 1)

        slack_payload = {
            "attachments": [{
                "color": "#27ae60" if gate_passed else "#c0392b",
                "title": f"{gate_emoji} DataSentinel — DQA Gate {gate_label}",
                "fields": [
                    {"title": "Project",    "value": project_name,         "short": True},
                    {"title": "Readiness",  "value": f"{score_pct}%",      "short": True},
                    {"title": "Violations", "value": str(violations),       "short": True},
                    {"title": "Run ID",     "value": run_id[:8] + "…",      "short": True},
                ],
                "footer": "DataSentinel DQA Platform",
            }]
        }

        if slack_url := cfg.get("slack_webhook_url", ""):
            ok, hstatus, err = _fire_single_webhook(slack_url, slack_payload)
            _record_delivery(db, project_id, run_id, "slack", slack_url, slack_payload,
                             "ok" if ok else "failed", hstatus, err)
            if not ok:
                logger.warning("Slack webhook failed for project %s: %s", project_id, err)

        if teams_url := cfg.get("teams_webhook_url", ""):
            teams_payload = {
                "@type": "MessageCard", "@context": "http://schema.org/extensions",
                "summary": f"DQA Gate {gate_label}",
                "themeColor": "27ae60" if gate_passed else "c0392b",
                "title": f"{gate_emoji} DQA Gate {gate_label}: {project_name}",
                "text": f"Readiness: **{score_pct}%** | Violations: {violations}",
            }
            ok, hstatus, err = _fire_single_webhook(teams_url, teams_payload)
            _record_delivery(db, project_id, run_id, "teams", teams_url, teams_payload,
                             "ok" if ok else "failed", hstatus, err)
            if not ok:
                logger.warning("Teams webhook failed for project %s: %s", project_id, err)

        alert_email = cfg.get("alert_email", "")
        if alert_email and not gate_passed:
            from app.services.email import send_gate_failure_alert
            send_gate_failure_alert(
                project_name=project_name,
                run_id=run_id,
                readiness=readiness,
                total_violations=violations,
                extra_recipients=[e.strip() for e in alert_email.split(",") if e.strip()],
            )
    except Exception as wh_exc:
        logger.warning("Webhook delivery failed for project %s: %s", project_id, wh_exc)


@router.get("/deliveries")
def list_deliveries(
    project_id: str,
    limit: int = 50,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Return webhook delivery history for a project (last N records)."""
    from sqlalchemy import text as _text

    # RBAC: only project members (or admins) may view delivery history
    from app.models import ProjectMember
    role = getattr(user, "role", "analyst")
    if role not in ("admin", "super_admin"):
        member = db.query(ProjectMember).filter(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        ).first()
        if not member:
            raise HTTPException(403, "You don't have access to this project")
    limit = max(1, min(limit, 200))
    rows = db.execute(_text("""
        SELECT id, webhook_type, webhook_url, status, http_status,
               last_error, retry_count, next_retry_at, delivered_at, created_at, run_id
        FROM webhook_deliveries
        WHERE project_id = :pid::uuid
        ORDER BY created_at DESC
        LIMIT :lim
    """), {"pid": project_id, "lim": limit}).fetchall()

    return {
        "items": [
            {
                "id":            str(r.id),
                "webhook_type":  r.webhook_type,
                "webhook_url":   r.webhook_url[:40] + "…" if len(r.webhook_url) > 40 else r.webhook_url,
                "status":        r.status,
                "http_status":   r.http_status,
                "last_error":    r.last_error,
                "retry_count":   r.retry_count,
                "next_retry_at": r.next_retry_at.isoformat() if r.next_retry_at else None,
                "delivered_at":  r.delivered_at.isoformat() if r.delivered_at else None,
                "created_at":    r.created_at.isoformat() if r.created_at else None,
                "run_id":        str(r.run_id) if r.run_id else None,
            }
            for r in rows
        ],
        "total": len(rows),
    }


def retry_pending_webhooks() -> None:
    """Background worker: retry failed deliveries whose next_retry_at is due.
    Called by the scheduler every 60 seconds."""
    from datetime import datetime

    from sqlalchemy import text as _text

    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        rows = db.execute(_text("""
            SELECT * FROM webhook_deliveries
            WHERE status = 'failed'
              AND retry_count < :max_retries
              AND next_retry_at <= :now
            ORDER BY next_retry_at ASC
            LIMIT 50
            FOR UPDATE SKIP LOCKED
        """), {"max_retries": MAX_RETRIES, "now": datetime.utcnow()}).fetchall()

        processed = 0
        for row in rows:
            import json as _json
            payload = row.payload if isinstance(row.payload, dict) else _json.loads(row.payload or "{}")
            ok, hstatus, err = _fire_single_webhook(row.webhook_url, payload)
            new_retry = row.retry_count + 1
            from datetime import timedelta
            next_retry = None
            if not ok and new_retry < MAX_RETRIES:
                delay = RETRY_DELAYS_SECONDS[min(new_retry, len(RETRY_DELAYS_SECONDS) - 1)]
                next_retry = datetime.utcnow() + timedelta(seconds=delay)

            # Fix: commit per row so a failure in one UPDATE does not roll back
            # already-completed deliveries and cause duplicate HTTP sends.
            try:
                db.execute(_text("""
                    UPDATE webhook_deliveries
                    SET status = :status,
                        http_status = :hstatus,
                        last_error = :err,
                        retry_count = :retries,
                        next_retry_at = :next_retry,
                        delivered_at = CASE WHEN :status2 = 'ok' THEN NOW() ELSE delivered_at END
                    WHERE id = :id::uuid
                """), {
                    "status":     "ok" if ok else "failed",
                    "hstatus":    hstatus,
                    "err":        err,
                    "retries":    new_retry,
                    "next_retry": next_retry,
                    "status2":    "ok" if ok else "failed",
                    "id":         str(row.id),
                })
                db.commit()
                processed += 1
            except Exception as update_exc:
                logger.error("Failed to update delivery %s: %s", row.id, update_exc)
                try:
                    db.rollback()
                except Exception:
                    pass
        if processed:
            logger.info("Webhook retry worker: processed %d/%d deliveries", processed, len(rows))
    except Exception as exc:
        logger.error("Webhook retry worker error: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()
