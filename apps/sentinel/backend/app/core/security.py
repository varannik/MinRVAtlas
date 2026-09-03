import hashlib
import hmac
import logging
import secrets
import time as _time_mod
import uuid as _uuid
from datetime import datetime, timedelta
from typing import Optional

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db

_sec_logger = logging.getLogger("datasentinel.security")

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
# Keep OAuth2PasswordBearer for Swagger UI compatibility (auto_error=False allows cookie fallback)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    # F006: include a unique jti so individual tokens can be revoked
    # CR-002: include iat so we can compare against pwd_reset_at
    to_encode.update({
        "exp": expire,
        "iat": int(_time_mod.time()),
        "jti": str(_uuid.uuid4()),
    })
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def revoke_token(token: str, db: Session) -> None:
    """Add a JWT's jti to the denylist so it cannot be reused after logout."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        jti = payload.get("jti")
        exp = payload.get("exp")
        if jti and exp:
            from app.models import RevokedToken
            db.add(RevokedToken(
                jti=jti,
                expires_at=datetime.utcfromtimestamp(exp),
            ))
            db.commit()
    except InvalidTokenError:
        # CR-007: expired / malformed token — nothing to revoke, silently skip
        pass
    except Exception:
        # CR-007: DB / unexpected error — log it so it doesn't disappear silently
        _sec_logger.exception("revoke_token: unexpected error writing to denylist")


M2M_EMAIL = "m2m@3dminrv.internal"


def _extract_token(
    bearer: Optional[str],
    cookie: Optional[str],
) -> Optional[str]:
    """Extract JWT from cookie first, then Authorization header."""
    if cookie:
        return cookie
    if bearer and bearer.startswith("Bearer "):
        return bearer[7:]
    return None


def _service_token_matches(token: str) -> bool:
    """Constant-time compare against SENTINEL_SERVICE_TOKEN (3DMinRV BFF)."""
    expected = (getattr(settings, "SENTINEL_SERVICE_TOKEN", None) or "").strip()
    if not expected or not token:
        return False
    key = settings.SECRET_KEY.encode("utf-8")
    left = hmac.new(key, token.encode("utf-8"), hashlib.sha256).digest()
    right = hmac.new(key, expected.encode("utf-8"), hashlib.sha256).digest()
    return hmac.compare_digest(left, right)


def _get_or_create_m2m_user(db: Session):
    from app.models import User

    user = db.query(User).filter(User.email == M2M_EMAIL).first()
    if user is not None:
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user
    user = User(
        email=M2M_EMAIL,
        full_name="3DMinRV BFF",
        hashed_password=hash_password(secrets.token_hex(32)),
        role="admin",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _sec_logger.info("Created Sentinel M2M user %s", M2M_EMAIL)
    return user


def get_current_user(
    request: Request,
    bearer: Optional[str] = Header(None, alias="Authorization"),
    ds_session: Optional[str] = Cookie(None),
    db: Session = Depends(get_db),
):
    from app.models import User
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = _extract_token(bearer, ds_session)
    if not token:
        raise credentials_exception
    if _service_token_matches(token):
        return _get_or_create_m2m_user(db)
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        jti: str | None = payload.get("jti")
        iat: int | None = payload.get("iat")
        if email is None:
            raise credentials_exception
        # CR-003: tokens issued without jti cannot be revoked — reject them
        if not jti:
            raise credentials_exception
        # Fix (MFA bypass): partial tokens (mfa_pending=True) issued during the
        # MFA login flow must NOT be accepted by real endpoints.  They are only
        # valid for /mfa/validate.  Adding jti in Fix #14 made partial tokens
        # pass the jti check above; this guard closes that regression.
        if payload.get("mfa_pending"):
            raise credentials_exception
    except InvalidTokenError:
        raise credentials_exception

    # Fix #06: fail closed on denylist DB error — a DB outage must not allow
    # revoked tokens through. Raise 503 so the client knows to retry.
    from app.models import RevokedToken
    try:
        if db.query(RevokedToken).filter(RevokedToken.jti == jti).first():
            raise credentials_exception
    except HTTPException:
        raise
    except Exception as exc:
        _sec_logger.error("get_current_user: denylist check failed — failing closed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable — please retry",
        )

    user = db.query(User).filter(User.email == email).first()
    if user is None or not user.is_active:
        raise credentials_exception

    # Fix #08 / #13: reject tokens issued before a password reset.
    # Use an in-process TTL cache as fallback so a brief Redis outage does not
    # silently allow stale tokens through.
    # Fix #13: use >= (not >) to close the same-second edge case.
    if iat is not None:
        _check_pwd_reset_at(user.id, iat, credentials_exception)

    return user


# ── pwd_reset_at helpers (module-level so the in-process cache persists) ──────
import threading as _sec_threading

_pra_cache: dict = {}          # {user_id_str: (reset_at_int, cached_at_monotonic)}
_pra_lock = _sec_threading.Lock()
_PRA_TTL = 120                 # seconds to keep cached value after a Redis read


def _check_pwd_reset_at(user_id, iat: int, credentials_exception) -> None:
    """
    Check whether the token was issued before a password reset.
    Redis is the authoritative source; a short in-process TTL cache is used as
    fallback so a transient Redis outage does not silently skip the check.
    Fix #08: on Redis failure use cached value if available; log at ERROR level.
    Fix #13: comparison is >= so same-second resets also block old tokens.
    """
    import time as _time
    uid = str(user_id)
    reset_at: int | None = None
    now_mono = _time.monotonic()

    # 1. Try Redis (authoritative)
    try:
        import redis as _redis_lib
        _r = _redis_lib.from_url(
            settings.REDIS_URL, decode_responses=True,
            socket_connect_timeout=0.3, socket_timeout=0.3,
        )
        raw = _r.get(f"pwd_reset_at:{uid}")
        if raw is not None:
            reset_at = int(raw)
            # Populate / refresh the in-process cache
            with _pra_lock:
                _pra_cache[uid] = (reset_at, now_mono)
        else:
            # Key absent → no password reset recorded; clear stale cache entry
            with _pra_lock:
                _pra_cache.pop(uid, None)
    except Exception as exc:
        _sec_logger.error(
            "get_current_user: Redis pwd_reset_at check failed — using in-process cache: %s", exc
        )
        # 2. Fall back to in-process cache
        with _pra_lock:
            cached = _pra_cache.get(uid)
        if cached is not None:
            cached_val, cached_at = cached
            if now_mono - cached_at <= _PRA_TTL:
                reset_at = cached_val
            # else: cache expired — treat as no reset recorded (fail open for
            # availability, but log so ops know Redis needs attention)

    if reset_at is not None and reset_at >= iat:   # Fix #13: >= closes same-second edge
        raise credentials_exception


def require_role(*roles):
    def checker(current_user=Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return checker
