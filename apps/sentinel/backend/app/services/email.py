"""
Email alert service — SMTP-based with graceful fallback to log-only.
Configure via: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
               ALERT_EMAIL_FROM, ALERT_EMAIL_TO (comma-separated)

F032: All user-facing emails are rendered via Jinja2 templates in app/templates/emails/
      to prevent HTML injection and improve maintainability.
"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings

logger = logging.getLogger("datasentinel.email")

# F032: Jinja2 environment — auto-escaping protects against HTML injection in template variables
_TEMPLATE_DIR = Path(__file__).parent.parent / "templates" / "emails"
_jinja_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
)

def render_template(template_name: str, **context) -> str:
    """Render a Jinja2 email template with auto-escaping enabled."""
    tmpl = _jinja_env.get_template(template_name)
    return tmpl.render(**context)


def send_email(subject: str, body_html: str, to_emails: list[str] | None = None) -> bool:
    """Send an HTML email. Returns True on success, False (never raises) on error."""
    if not settings.SMTP_HOST or not settings.ALERT_EMAIL_FROM:
        logger.info(f"[EMAIL NOT CONFIGURED] Would send: {subject}")
        return False

    recipients = to_emails or [
        e.strip() for e in settings.ALERT_EMAIL_TO.split(",") if e.strip()
    ]
    if not recipients:
        logger.warning("send_email: no recipients configured")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = settings.ALERT_EMAIL_FROM
        msg["To"]      = ", ".join(recipients)
        msg.attach(MIMEText(body_html, "html"))

        # Port 465 → implicit SSL (SMTP_SSL); port 587 → explicit TLS (STARTTLS)
        if settings.SMTP_PORT == 465:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                if settings.SMTP_USER:
                    smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                smtp.sendmail(settings.ALERT_EMAIL_FROM, recipients, msg.as_string())
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
                if settings.SMTP_USER:
                    smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                smtp.sendmail(settings.ALERT_EMAIL_FROM, recipients, msg.as_string())

        logger.info(f"Email sent: '{subject}' → {recipients}")
        return True
    except Exception as exc:
        logger.error(f"Email send failed: {exc}")
        return False


def send_gate_failure_alert(
    project_name: str,
    run_id: str,
    readiness: float,
    total_violations: int,
    gate_reason: str = "",
    extra_recipients: list[str] | None = None,
) -> None:
    """Convenience: send a formatted gate-failure alert email.
    Uses Jinja2 template (autoescape enabled) to prevent HTML injection."""
    score_pct = round(readiness * 100, 1)
    subject = f"DataSentinel — Gate FAILED: {project_name} ({score_pct}% readiness)"
    body = render_template(
        "gate_failure.html",
        project_name=project_name,
        run_id=run_id,
        score_pct=score_pct,
        total_violations=total_violations,
        gate_reason=gate_reason,
    )
    send_email(subject, body, extra_recipients)


def send_slack_webhook(webhook_url: str, payload: dict) -> bool:
    """Fire a Slack-compatible webhook (works for Teams incoming webhooks too). Non-raising."""
    import json
    import urllib.request
    try:
        data = json.dumps(payload).encode()
        req  = urllib.request.Request(webhook_url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status < 300
    except Exception as exc:
        logger.error(f"Webhook send failed: {exc}")
        return False
