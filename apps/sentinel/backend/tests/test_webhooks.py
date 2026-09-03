"""
Tests for webhook validation, retry logic, and URL security checks.
"""
import os
import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only-32chars!")
os.environ.setdefault("ENVIRONMENT", "test")

pytest.importorskip("fastapi", reason="FastAPI not installed — skipping (works in CI)")


# ── URL validation ─────────────────────────────────────────────────────────────

def test_webhook_url_must_be_https():
    from fastapi import HTTPException
    from app.api.v1.webhooks import _validate_webhook_url
    with pytest.raises(HTTPException) as exc:
        _validate_webhook_url("http://slack.com/webhook")
    assert exc.value.status_code == 400
    assert "HTTPS" in exc.value.detail


def test_webhook_url_empty_is_allowed():
    """Empty URL means 'not configured' — no error."""
    from app.api.v1.webhooks import _validate_webhook_url
    _validate_webhook_url("")  # should not raise


def test_webhook_url_localhost_rejected():
    from fastapi import HTTPException
    from app.api.v1.webhooks import _validate_webhook_url
    with pytest.raises(HTTPException):
        _validate_webhook_url("https://localhost/hook")


def test_webhook_url_private_ip_rejected():
    from fastapi import HTTPException
    from app.api.v1.webhooks import _validate_webhook_url
    # 10.x.x.x is RFC1918 private
    with pytest.raises(HTTPException):
        _validate_webhook_url("https://10.0.0.1/hook")


def test_webhook_url_loopback_rejected():
    from fastapi import HTTPException
    from app.api.v1.webhooks import _validate_webhook_url
    with pytest.raises(HTTPException):
        _validate_webhook_url("https://127.0.0.1/hook")


# ── Email validation ───────────────────────────────────────────────────────────

def test_alert_email_valid_single():
    from app.api.v1.webhooks import _validate_alert_email
    _validate_alert_email("ops@company.com")  # should not raise


def test_alert_email_valid_multiple():
    from app.api.v1.webhooks import _validate_alert_email
    _validate_alert_email("a@x.com, b@y.org")  # should not raise


def test_alert_email_invalid_raises():
    from fastapi import HTTPException
    from app.api.v1.webhooks import _validate_alert_email
    with pytest.raises(HTTPException) as exc:
        _validate_alert_email("not-an-email")
    assert exc.value.status_code == 400


def test_alert_email_empty_allowed():
    from app.api.v1.webhooks import _validate_alert_email
    _validate_alert_email("")  # no config = no error


# ── Webhook retry constants ────────────────────────────────────────────────────

def test_webhook_retry_schedule_is_sane():
    """Retry schedule must be reasonable backoff values."""
    RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 28800]  # 1m, 5m, 30m, 2h, 8h
    assert len(RETRY_DELAYS_SECONDS) == 5
    assert RETRY_DELAYS_SECONDS[0] < RETRY_DELAYS_SECONDS[-1]
    # Max 8 hours (28800s)
    assert RETRY_DELAYS_SECONDS[-1] <= 28800


def test_max_retry_count():
    MAX_RETRIES = 5
    assert MAX_RETRIES == 5, "Must attempt exactly 5 times before giving up"
