import secrets
from datetime import datetime, timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.models import User
from app.schemas import UserCreate, UserOut

router = APIRouter()

# CR-001 fix: TOTP replay-attack prevention — Redis-backed, shared across all workers/ECS tasks.
# Falls back to process-local dict only when Redis is unreachable (dev environments).
import logging as _logging
import threading as _threading
import time as _time

_auth_logger = _logging.getLogger("datasentinel.auth")
_totp_lock = _threading.Lock()
_used_totp: dict[str, float] = {}          # process-local fallback for dev
_totp_redis_cache: dict = {"client": None, "checked": False, "pid": None}

def _totp_redis():
    # Fix #12: detect Gunicorn fork — re-initialise if PID changed so forked
    # workers don't share inherited socket file descriptors with the parent.
    import os as _os
    current_pid = _os.getpid()
    if _totp_redis_cache["pid"] != current_pid:
        # New process (post-fork): reset and re-probe Redis
        _totp_redis_cache["client"] = None
        _totp_redis_cache["checked"] = False
        _totp_redis_cache["pid"] = current_pid
    if not _totp_redis_cache["checked"]:
        try:
            import redis as _redis_lib

            from app.core.config import settings
            c = _redis_lib.from_url(
                settings.REDIS_URL, decode_responses=True,
                socket_connect_timeout=0.5, socket_timeout=0.5,
            )
            c.ping()
            _totp_redis_cache["client"] = c
        except Exception:
            _totp_redis_cache["client"] = None
        _totp_redis_cache["checked"] = True
    return _totp_redis_cache["client"]

def _mark_totp_used(user_id: str, code: str) -> bool:
    """Return True and record code if not seen within 90 s; False = replay detected.
    Uses Redis SET NX EX for atomicity across all workers (CR-001).
    """
    key = f"totp_used:{user_id}:{code}"
    r = _totp_redis()
    if r is not None:
        try:
            result = r.set(key, 1, nx=True, ex=90)
            return result is not None   # None → key already existed → replay
        except Exception as exc:
            _auth_logger.warning("Redis TOTP check failed, falling back to local dict: %s", exc)
    # In-process fallback (single-worker / no Redis)
    now = _time.monotonic()
    with _totp_lock:
        expired = [k for k, ts in _used_totp.items() if now - ts > 90]
        for k in expired:
            del _used_totp[k]
        if key in _used_totp:
            return False
        _used_totp[key] = now
        return True

# F008: Pydantic request models for previously untyped endpoints

class MFAValidateRequest(BaseModel):
    partial_token: str
    code: str

class MFACodeRequest(BaseModel):
    code: str

class MFADisableRequest(BaseModel):
    password: str
    code: str = ""

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

class RoleUpdateRequest(BaseModel):
    role: str

class InviteUserRequest(BaseModel):
    email: str
    name: str
    role: str = "analyst"

SESSION_COOKIE = "ds_session"
COOKIE_MAX_AGE = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60


def _set_session_cookie(response: Response, token: str) -> None:
    """Attach an HttpOnly Secure SameSite=Lax session cookie."""
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=(settings.ENVIRONMENT == "production"),
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE, path="/")


# ── Login (rate-limited: 10 attempts/minute per IP) ───────────────────────────

@router.post("/token")
@limiter.limit("10/minute")
def login(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # ── MFA gate: issue partial token; client must call /mfa/validate ─────────
    if user.mfa_enabled:
        import uuid as _uuid_mod
        # Fix #14: include jti so partial tokens can be individually revoked
        partial_data = {
            "sub": user.email,
            "mfa_pending": True,
            "jti": str(_uuid_mod.uuid4()),
            "exp": datetime.utcnow() + timedelta(minutes=5),
        }
        partial_token = jwt.encode(partial_data, settings.SECRET_KEY,
                                   algorithm=settings.ALGORITHM)
        return {
            "requires_mfa": True,
            "partial_token": partial_token,
            "access_token": None,
            "token_type": "bearer",
            "user": None,
        }

    user.last_login = datetime.utcnow()
    token = create_access_token({"sub": user.email, "role": user.role})
    _set_session_cookie(response, token)
    return {
        "requires_mfa": False,
        "partial_token": None,
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id), "email": user.email,
            "full_name": user.full_name, "role": user.role,
            "platform_access": getattr(user, "platform_access", None),
        },
    }


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Clear the session cookie and revoke the JWT so it cannot be reused (F006)."""
    from app.core.security import revoke_token
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        revoke_token(token, db)
    _clear_session_cookie(response)
    return {"message": "Logged out successfully"}


# ── MFA: step-2 validation ─────────────────────────────────────────────────────

@router.post("/mfa/validate")
@limiter.limit("5/minute")
def mfa_validate(request: Request, response: Response, data: MFAValidateRequest,
                 db: Session = Depends(get_db)):
    """Exchange a partial login token + TOTP code for a full JWT."""
    partial_token = data.partial_token.strip()
    code = data.code.strip()

    try:
        payload = jwt.decode(partial_token, settings.SECRET_KEY,
                             algorithms=[settings.ALGORITHM])
        email = payload.get("sub")
        if not payload.get("mfa_pending") or not email:
            raise HTTPException(400, "Invalid MFA session token")
    except InvalidTokenError:
        raise HTTPException(400, "MFA session token is invalid or has expired")

    user = db.query(User).filter(User.email == email).first()
    if not user or not user.mfa_enabled or not user.mfa_secret:
        raise HTTPException(400, "MFA not configured for this account")
    # Fix: check is_active — a disabled user must not be able to complete login
    # via the MFA step even if they have a valid partial token.
    if not user.is_active:
        raise HTTPException(403, "Account is disabled — contact your administrator")

    import pyotp
    totp = pyotp.TOTP(user.mfa_secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Invalid MFA code — check your authenticator app")
    # F035: prevent TOTP code replay within the 90-second valid window
    if not _mark_totp_used(str(user.id), code):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "MFA code already used — please wait for the next code")

    user.last_login = datetime.utcnow()
    token = create_access_token({"sub": user.email, "role": user.role})
    _set_session_cookie(response, token)
    return {
        "requires_mfa": False,
        "partial_token": None,
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id), "email": user.email,
            "full_name": user.full_name, "role": user.role,
            "platform_access": getattr(user, "platform_access", None),
        },
    }


# ── MFA: setup (generate secret + provisioning URI) ───────────────────────────

@router.get("/mfa/setup")
def mfa_setup(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.mfa_enabled:
        raise HTTPException(400, "MFA is already enabled. Disable it first.")
    import pyotp
    secret = pyotp.random_base32()
    user.mfa_secret = secret
    db.commit()   # F007: persist the provisional secret so verify-setup can read it
    uri = pyotp.TOTP(secret).provisioning_uri(
        name=f"DataSentinel:{user.email}",
        issuer_name="DataSentinel DQA",
    )
    return {"secret": secret, "otpauth_uri": uri}


@router.post("/mfa/verify-setup")
def mfa_verify_setup(data: MFACodeRequest, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    code = data.code.strip()
    if not user.mfa_secret:
        raise HTTPException(400, "No MFA setup in progress — call GET /mfa/setup first")
    import pyotp
    if not pyotp.TOTP(user.mfa_secret).verify(code, valid_window=1):
        raise HTTPException(400, "Invalid code — open your authenticator app and try again")
    if not _mark_totp_used(str(user.id), code):
        raise HTTPException(400, "MFA code already used — please wait for the next code")
    user.mfa_enabled = True
    db.commit()   # F026: persist mfa_enabled flag
    return {"message": "MFA enabled successfully", "mfa_enabled": True}


@router.post("/mfa/disable")
@limiter.limit("5/minute")   # F017: rate-limit brute-force MFA disable attempts
def mfa_disable(request: Request, data: MFADisableRequest, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    password = data.password
    code = data.code.strip()
    if not verify_password(password, user.hashed_password):
        raise HTTPException(400, "Incorrect password")
    if user.mfa_enabled and user.mfa_secret:
        import pyotp
        if not pyotp.TOTP(user.mfa_secret).verify(code, valid_window=1):
            raise HTTPException(400, "Invalid MFA code")
        # Fix #07: mark code as used to prevent replay within the 90-second window
        if not _mark_totp_used(str(user.id), code):
            raise HTTPException(400, "MFA code already used — please wait for the next code")
    user.mfa_enabled = False
    user.mfa_secret = None
    db.commit()
    return {"message": "MFA disabled", "mfa_enabled": False}


# ── Forgot password (rate-limited: 3/minute) ──────────────────────────────────

@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(request: Request, data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user:
        from app.models import PasswordResetToken
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used == False,
        ).update({"used": True})

        token = secrets.token_urlsafe(32)
        expires = datetime.utcnow() + timedelta(hours=2)
        db.add(PasswordResetToken(user_id=user.id, token=token, expires_at=expires))
        # Fix (same as Fix #04 in invite_user): commit so the token row is
        # persisted before the email is sent — otherwise the reset link is always broken.
        db.commit()

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        from app.services.email import render_template, send_email
        send_email(
            subject="DataSentinel — Password Reset",
            body_html=render_template(
                "forgot_password.html",
                subject="DataSentinel — Password Reset",
                name=user.full_name or user.email,
                reset_url=reset_url,
            ),
            to_emails=[email],
        )
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    token = data.token.strip()
    new_password = data.password.strip()

    if not token or not new_password:
        raise HTTPException(400, "token and password are required")

    from app.models import PasswordResetToken
    prt = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == token,
        PasswordResetToken.used == False,
    ).first()

    if not prt:
        raise HTTPException(400, "Reset link is invalid or has already been used")

    exp = prt.expires_at.replace(tzinfo=None) if prt.expires_at.tzinfo else prt.expires_at
    if exp < datetime.utcnow():
        raise HTTPException(400, "Reset link has expired — please request a new one")

    user = db.query(User).filter(User.id == prt.user_id).first()
    if not user:
        raise HTTPException(400, "User not found")

    user.hashed_password = hash_password(new_password)
    prt.used = True
    db.commit()

    # CR-002: Invalidate all active JWTs for this user by recording the reset timestamp in
    # Redis. get_current_user() rejects any token whose iat is older than this value.
    try:
        import redis as _redis_lib
        r = _redis_lib.from_url(
            settings.REDIS_URL, decode_responses=True,
            socket_connect_timeout=0.5, socket_timeout=0.5,
        )
        ttl_secs = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        r.set(f"pwd_reset_at:{user.id}", int(_time.time()), ex=ttl_secs)
    except Exception as exc:
        # Non-fatal: log but don't block the successful password reset
        _auth_logger.warning("Could not write pwd_reset_at to Redis: %s", exc)

    return {"message": "Password updated successfully. You can now sign in."}


# ── Register (admin-only creation) ───────────────────────────────────────────

@router.post("/register", response_model=UserOut)
@limiter.limit("10/minute")
def register(
    request: Request,
    data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new account. Admin/super_admin only — callers cannot self-assign roles."""
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Only admins can create accounts")
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    # Restrict assignable roles — admins cannot be created via this endpoint
    allowed_roles = {"analyst", "viewer", "engineer"}
    role = data.role if data.role in allowed_roles else "analyst"
    user = User(
        email=data.email, full_name=data.full_name,
        hashed_password=hash_password(data.password), role=role,
    )
    db.add(user)
    db.commit()   # F002: persist row before refresh
    db.refresh(user)
    return user


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me/theme")
def update_theme(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """B1-#12: Persist the user's theme preference (dark/light) across sessions."""
    theme = (data.get("theme") or "").strip()
    if theme not in ("dark", "light"):
        raise HTTPException(400, "theme must be 'dark' or 'light'")
    current_user.theme = theme
    db.commit()
    return {"theme": theme}


# ── User management (admin only) ─────────────────────────────────────────────

def _user_to_dict(u: User) -> dict:
    """Serialise a User model to a safe dict (no password hash)."""
    initials = "".join(p[0].upper() for p in (u.full_name or u.email).split()[:2]) or "??"
    # Use portable date formatting (no %-d Linux-only flag)
    if u.last_login:
        d = u.last_login
        last_str = f"{d.day} {d.strftime('%b %Y %H:%M')}"
    else:
        last_str = "Never"
    return {
        "id": str(u.id),
        "name": u.full_name or u.email.split("@")[0],
        "email": u.email,
        "role": u.role,
        "status": "active" if u.is_active else "inactive",
        "avatar": initials[:2],
        "last": last_str,
        "joined": u.created_at.strftime("%b %Y") if u.created_at else "—",
        "mfa_enabled": u.mfa_enabled,
        "platform_access": getattr(u, "platform_access", None),
    }


@router.get("/users")
def list_users(offset: int = 0, limit: int = 200,
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """List all users (admin/super_admin only). F021: returns paginated envelope."""
    if user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin required")
    from app.core.pagination import paginate
    q = db.query(User).order_by(User.created_at.asc())
    total = q.count()
    items = [_user_to_dict(u) for u in q.offset(offset).limit(limit).all()]
    return paginate(items, total=total, offset=offset, limit=limit)


@router.patch("/users/{user_id}/role")
def update_user_role(user_id: str, body: RoleUpdateRequest, db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin required")
    # F011: prevent admins from modifying their own role
    if str(current_user.id) == str(user_id):
        raise HTTPException(status_code=400, detail="Cannot modify your own role")
    new_role = body.role
    allowed = {"super_admin", "admin", "engineer", "analyst", "viewer"}
    if new_role not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {allowed}")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.role = new_role
    db.commit()
    return _user_to_dict(u)


@router.patch("/users/{user_id}/platform-access")
def update_platform_access(user_id: str, body: dict, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    """
    Set which platform buckets a user can access.
    Super Admin and Admin always have full access regardless of this field.
    Body: {"dqa": bool, "anomaly": bool, "vv": bool, "reviewer": bool}
    """
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin required")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    # Admins and super_admins always get everything — don't restrict them
    if u.role in ("admin", "super_admin"):
        raise HTTPException(status_code=400, detail="Cannot restrict platform access for admin users")
    valid_keys = {"dqa", "anomaly", "vv", "reviewer"}
    access = {k: bool(v) for k, v in body.items() if k in valid_keys}
    if not access:
        raise HTTPException(status_code=400, detail="Provide at least one of: dqa, anomaly, vv, reviewer")
    # Build a NEW dict (never mutate in place — SQLAlchemy JSONB change tracking
    # uses object identity; mutating the existing dict leaves the column unmarked
    # as dirty so the UPDATE is silently skipped at commit time).
    existing = getattr(u, "platform_access", None) or {}
    u.platform_access = {**existing, **access}
    # Explicitly tell SQLAlchemy the JSONB column is dirty
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(u, "platform_access")
    db.commit()
    db.refresh(u)
    return _user_to_dict(u)


@router.patch("/users/{user_id}/status")
def toggle_user_status(user_id: str, db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin required")
    # F011: prevent admins from disabling their own account
    if str(current_user.id) == str(user_id):
        raise HTTPException(status_code=400, detail="Cannot disable your own account")
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.is_active = not u.is_active
    db.commit()
    return _user_to_dict(u)


@router.post("/users/invite")
def invite_user(body: InviteUserRequest, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    """Create a new user via invite email. Admin only. Temp password is NOT returned."""
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin required")
    email = body.email.strip().lower()
    name = body.name.strip()
    role = body.role
    if not email or not name:
        raise HTTPException(status_code=400, detail="name and email are required")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    # Generate a random password — store hashed, never returned in response
    temp_pw = secrets.token_urlsafe(16)
    allowed_roles = {"analyst", "viewer", "engineer"}
    new_user = User(
        email=email, full_name=name,
        hashed_password=hash_password(temp_pw),
        role=role if role in allowed_roles else "analyst",
        is_active=True,
    )
    db.add(new_user)
    db.commit()   # persist user before adding reset token
    db.refresh(new_user)

    # Send invite email with reset link so user sets their own password
    from app.models import PasswordResetToken
    reset_token = secrets.token_urlsafe(32)
    from datetime import timedelta
    token_obj = PasswordResetToken(
        user_id=new_user.id, token=reset_token,
        expires_at=datetime.utcnow() + timedelta(hours=72)
    )
    db.add(token_obj)
    # Fix #04: commit so the token row is persisted before the email is sent;
    # without this commit the invite link always returns invalid-token.
    db.commit()
    db.refresh(token_obj)
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
    from app.services.email import render_template, send_email
    send_email(
        subject="You've been invited to DataSentinel",
        body_html=render_template(
            "invite.html",
            subject="You've been invited to DataSentinel",
            name=name,
            invited_by=current_user.full_name or current_user.email,
            role=role,
            invite_url=reset_url,
        ),
        to_emails=[email],
    )
    return {"user": _user_to_dict(new_user), "invite_sent": True}
