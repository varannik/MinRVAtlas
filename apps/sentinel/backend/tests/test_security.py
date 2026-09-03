"""
Security unit tests — auth helpers, JWT, password hashing.
Run with: pytest backend/tests/
"""
import pytest
from datetime import datetime, timedelta

# ── Password hashing ──────────────────────────────────────────────────────────

def test_hash_and_verify_password():
    from app.core.security import hash_password, verify_password
    pw = "MySuperSecret123!"
    hashed = hash_password(pw)
    assert hashed != pw
    assert verify_password(pw, hashed) is True
    assert verify_password("wrong_password", hashed) is False


def test_verify_empty_hash_returns_false():
    """SSO users have an unguessable hash — verify against empty string must fail."""
    from app.core.security import verify_password
    assert verify_password("", "") is False
    assert verify_password("anything", "") is False


# ── JWT creation and decoding ─────────────────────────────────────────────────

def test_create_access_token_contains_sub():
    from app.core.security import create_access_token
    import jwt
    from app.core.config import settings
    token = create_access_token({"sub": "test@example.com", "role": "analyst"})
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert payload["sub"] == "test@example.com"
    assert payload["role"] == "analyst"
    assert "exp" in payload


def test_create_access_token_custom_expiry():
    from app.core.security import create_access_token
    import jwt
    from app.core.config import settings
    token = create_access_token({"sub": "user@test.com"}, expires_delta=timedelta(minutes=1))
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    # Should expire in roughly 1 minute
    exp = datetime.utcfromtimestamp(payload["exp"])
    assert exp > datetime.utcnow()
    assert exp < datetime.utcnow() + timedelta(minutes=2)


def test_expired_token_raises():
    from app.core.security import create_access_token
    import jwt
    from jwt.exceptions import InvalidTokenError
    from app.core.config import settings
    token = create_access_token({"sub": "user@test.com"}, expires_delta=timedelta(seconds=-1))
    with pytest.raises(InvalidTokenError):
        jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
