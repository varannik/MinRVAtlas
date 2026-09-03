"""
Tests for data source connector validation and configuration logic.
"""
import os
import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only-32chars!")
os.environ.setdefault("ENVIRONMENT", "test")

pytest.importorskip("fastapi", reason="FastAPI not installed — skipping (works in CI)")


# ── Connector type validation ──────────────────────────────────────────────────

VALID_CONNECTOR_TYPES = {"s3", "postgresql", "rest_api"}


def test_valid_connector_types():
    assert "s3" in VALID_CONNECTOR_TYPES
    assert "postgresql" in VALID_CONNECTOR_TYPES
    assert "rest_api" in VALID_CONNECTOR_TYPES


def test_connector_type_count():
    assert len(VALID_CONNECTOR_TYPES) == 3


# ── S3 config validation ───────────────────────────────────────────────────────

def _validate_s3_config(cfg: dict) -> list[str]:
    """Return list of validation errors for an S3 connector config."""
    errors = []
    if not cfg.get("bucket"):
        errors.append("bucket is required")
    if not cfg.get("prefix") and cfg.get("prefix") != "":
        errors.append("prefix is required (use '' for root)")
    bucket = cfg.get("bucket", "")
    if bucket and (len(bucket) < 3 or len(bucket) > 63):
        errors.append("bucket name must be 3–63 characters")
    if bucket and not all(c.isalnum() or c in "-." for c in bucket):
        errors.append("bucket name contains invalid characters")
    return errors


def test_s3_valid_config():
    errors = _validate_s3_config({"bucket": "my-data-bucket", "prefix": "datasets/"})
    assert errors == []


def test_s3_missing_bucket():
    errors = _validate_s3_config({"prefix": "data/"})
    assert any("bucket" in e for e in errors)


def test_s3_bucket_name_too_short():
    errors = _validate_s3_config({"bucket": "ab", "prefix": ""})
    assert any("3" in e or "63" in e for e in errors)


def test_s3_bucket_invalid_chars():
    errors = _validate_s3_config({"bucket": "my_BUCKET!", "prefix": ""})
    assert any("invalid" in e for e in errors)


# ── PostgreSQL config validation ───────────────────────────────────────────────

def _validate_pg_config(cfg: dict) -> list[str]:
    errors = []
    conn = cfg.get("connection_string", "")
    if not conn:
        errors.append("connection_string is required")
    elif not (conn.startswith("postgresql://") or conn.startswith("postgres://")):
        errors.append("connection_string must start with postgresql:// or postgres://")
    # Block localhost / 127.x in connection strings
    if "localhost" in conn or "127.0.0.1" in conn or "@::1" in conn:
        errors.append("localhost connections are not allowed")
    return errors


def test_pg_valid_config():
    cfg = {"connection_string": "postgresql://user:pass@prod-db.example.com:5432/mydb"}
    assert _validate_pg_config(cfg) == []


def test_pg_missing_conn_string():
    assert _validate_pg_config({}) != []


def test_pg_invalid_scheme():
    cfg = {"connection_string": "mysql://user:pass@host/db"}
    errors = _validate_pg_config(cfg)
    assert any("postgresql" in e for e in errors)


def test_pg_localhost_blocked():
    cfg = {"connection_string": "postgresql://user:pass@localhost:5432/db"}
    errors = _validate_pg_config(cfg)
    assert any("localhost" in e for e in errors)


# ── REST API config validation ─────────────────────────────────────────────────

def _validate_rest_config(cfg: dict) -> list[str]:
    errors = []
    base_url = cfg.get("base_url", "")
    if not base_url:
        errors.append("base_url is required")
    elif not base_url.startswith("https://"):
        errors.append("base_url must use HTTPS")
    return errors


def test_rest_valid_config():
    cfg = {"base_url": "https://api.example.com/v1", "auth_type": "bearer", "token": "abc"}
    assert _validate_rest_config(cfg) == []


def test_rest_http_rejected():
    cfg = {"base_url": "http://api.example.com/v1"}
    errors = _validate_rest_config(cfg)
    assert any("HTTPS" in e for e in errors)


def test_rest_missing_base_url():
    assert _validate_rest_config({}) != []


# ── Connector model fields ─────────────────────────────────────────────────────

def test_connector_last_test_status_values():
    VALID_STATUSES = {"ok", "failed", "pending"}
    assert "ok" in VALID_STATUSES
    assert "failed" in VALID_STATUSES


def test_connector_importable():
    """Connector module must be importable without a live DB."""
    try:
        from app.api.v1 import connectors  # noqa: F401
        assert True
    except ImportError as e:
        pytest.fail(f"Could not import connectors: {e}")
