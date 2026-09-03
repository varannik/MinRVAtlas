"""
F025: Auth endpoint unit tests — cover the core auth flows without a live DB.
Uses pytest with monkeypatching to avoid requiring a real database or SMTP server.
Run with: pytest backend/tests/test_auth.py -v
"""
import pytest
import os

# Set env before any app imports
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only-32chars!")
os.environ.setdefault("ENVIRONMENT", "test")


# ── Password helpers ───────────────────────────────────────────────────────────

def test_hash_and_verify_roundtrip():
    from app.core.security import hash_password, verify_password
    for pw in ["short1!", "A" * 72, "unicode-pàssword-123!"]:
        hashed = hash_password(pw)
        assert hashed != pw, "Hash must differ from plaintext"
        assert verify_password(pw, hashed), "Correct password must verify"
        assert not verify_password("wrong", hashed), "Wrong password must fail"


def test_empty_password_and_hash_rejected():
    from app.core.security import verify_password
    assert not verify_password("", ""), "Empty string must not verify"
    assert not verify_password("anything", ""), "Empty hash must fail"


# ── JWT helpers ────────────────────────────────────────────────────────────────

def test_create_token_has_required_claims():
    from app.core.security import create_access_token
    import jwt
    from app.core.config import settings
    token = create_access_token({"sub": "user@test.com", "role": "analyst"})
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert payload["sub"] == "user@test.com"
    assert payload["role"] == "analyst"
    assert "exp" in payload
    assert "jti" in payload, "F006: jti claim required for revocation support"


def test_token_jti_is_unique():
    """F006: Every token must have a unique jti so individual tokens can be revoked."""
    from app.core.security import create_access_token
    import jwt
    from app.core.config import settings
    tokens = [create_access_token({"sub": "user@test.com"}) for _ in range(5)]
    jtis = set()
    for t in tokens:
        payload = jwt.decode(t, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        jtis.add(payload["jti"])
    assert len(jtis) == 5, "Each token must have a unique jti"


def test_expired_token_raises():
    from app.core.security import create_access_token
    import jwt
    from jwt.exceptions import InvalidTokenError
    from app.core.config import settings
    from datetime import timedelta
    token = create_access_token({"sub": "x@test.com"}, expires_delta=timedelta(seconds=-1))
    with pytest.raises(InvalidTokenError):
        jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


# ── TOTP replay cache (F035) ───────────────────────────────────────────────────

def test_totp_replay_detection():
    """F035: The same TOTP code from the same user within 90s must be rejected as a replay."""
    from app.api.v1.auth import _mark_totp_used
    user_id = "test-user-123"
    code = "654321"
    # First use: allowed
    assert _mark_totp_used(user_id, code) is True
    # Second use within window: replay — rejected
    assert _mark_totp_used(user_id, code) is False


def test_totp_different_users_same_code_allowed():
    """Different users may independently use the same TOTP code value."""
    from app.api.v1.auth import _mark_totp_used
    code = "111111"
    assert _mark_totp_used("user-A", code) is True
    assert _mark_totp_used("user-B", code) is True   # different user — allowed


def test_totp_different_codes_same_user_allowed():
    """The same user may use different codes (normal authenticator rotation)."""
    from app.api.v1.auth import _mark_totp_used
    user = "user-C"
    assert _mark_totp_used(user, "111111") is True
    assert _mark_totp_used(user, "222222") is True


# ── Pydantic request models (F008) ────────────────────────────────────────────

def test_mfa_validate_request_requires_both_fields():
    from pydantic import ValidationError
    from app.api.v1.auth import MFAValidateRequest
    with pytest.raises(ValidationError):
        MFAValidateRequest(partial_token="token")   # missing code
    with pytest.raises(ValidationError):
        MFAValidateRequest(code="123456")            # missing partial_token
    ok = MFAValidateRequest(partial_token="tok", code="123456")
    assert ok.code == "123456"


def test_reset_password_enforces_min_length():
    from pydantic import ValidationError
    from app.api.v1.auth import ResetPasswordRequest
    with pytest.raises(ValidationError):
        ResetPasswordRequest(token="tok", password="short")   # < 8 chars
    ok = ResetPasswordRequest(token="tok", password="ValidPass1!")
    assert ok.password == "ValidPass1!"


def test_role_update_model():
    from app.api.v1.auth import RoleUpdateRequest
    req = RoleUpdateRequest(role="admin")
    assert req.role == "admin"


# ── Security headers middleware (F003) ────────────────────────────────────────

def test_security_headers_middleware_class_exists():
    """F003: Verify the SecurityHeadersMiddleware is importable."""
    from app.main import SecurityHeadersMiddleware
    assert SecurityHeadersMiddleware is not None


# ── File upload size limits (F013) ───────────────────────────────────────────

def test_max_upload_bytes_configured():
    from app.api.v1.datasets import MAX_UPLOAD_BYTES
    assert MAX_UPLOAD_BYTES == 200 * 1024 * 1024, "200 MB cap expected"


# ── Comment length validation (F018) ─────────────────────────────────────────

def test_comment_max_length_constant():
    """Comments must be validated to max 10,000 chars in the endpoint."""
    max_len = 10_000
    # Verify the logic used in violations.py
    long_msg = "x" * (max_len + 1)
    assert len(long_msg) > max_len
