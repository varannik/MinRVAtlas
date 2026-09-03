"""
Microsoft Entra ID (Azure AD) SSO endpoints.

Flow:
  1. Frontend calls GET /login  → gets auth_url + state token
  2. Frontend stores state in sessionStorage, redirects browser to auth_url
  3. Microsoft redirects to {FRONTEND_URL}/auth/callback?code=...&state=...
  4. Callback page verifies state matches, POSTs the code + state to POST /callback
  5. We verify state, exchange code → Microsoft token → Graph profile → JWT
"""
import logging
import os
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.models import User

logger = logging.getLogger("datasentinel.sso")
router = APIRouter()

SESSION_COOKIE = "ds_session"
COOKIE_MAX_AGE = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60


def _authority() -> str:
    return f"https://login.microsoftonline.com/{settings.MICROSOFT_TENANT_ID}"


def _redirect_uri() -> str:
    return f"{settings.FRONTEND_URL}/auth/callback"


@router.get("/config")
def microsoft_config():
    """Return SSO config status — no secrets exposed, safe to call from browser."""
    return {
        "client_id_set": bool(settings.MICROSOFT_CLIENT_ID),
        "client_secret_set": bool(settings.MICROSOFT_CLIENT_SECRET),
        "tenant_id": settings.MICROSOFT_TENANT_ID or "(not set)",
        "frontend_url": settings.FRONTEND_URL,
        "redirect_uri": _redirect_uri(),
        "environment": settings.ENVIRONMENT,
    }


def _get_redis():
    """Return a Redis client for SSO state storage. Non-raising — returns None if unavailable."""
    try:
        import redis as _redis
        return _redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


@router.get("/login")
def microsoft_login():
    """Return the Microsoft OAuth2 URL (with state for CSRF protection)."""
    if not settings.MICROSOFT_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Microsoft SSO is not configured on this server")

    # Generate a cryptographically random state value to prevent CSRF (RFC 6749 §10.12)
    state = secrets.token_urlsafe(32)

    # Store state server-side with 5-minute TTL so callback can verify it
    r = _get_redis()
    if r:
        try:
            r.setex(f"sso:state:{state}", 300, "1")
        except Exception as exc:
            logger.warning("Could not store SSO state in Redis: %s", exc)

    params = {
        "client_id": settings.MICROSOFT_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": _redirect_uri(),
        "scope": "openid email profile User.Read",
        "response_mode": "query",
        "state": state,
    }
    auth_url = f"{_authority()}/oauth2/v2.0/authorize?{urlencode(params)}"
    logger.info("Microsoft SSO login initiated, redirect_uri=%s", _redirect_uri())
    # Return state so the frontend can store it and verify in the callback
    return {"auth_url": auth_url, "state": state}


class CallbackBody(BaseModel):
    code: str
    state: str   # echoed back from Microsoft; verified server-side below


@router.post("/callback")
async def microsoft_callback(body: CallbackBody, response: Response,
                              db: Session = Depends(get_db)):
    """
    Exchange Microsoft auth code for a DataSentinel JWT.
    Creates the user record on first sign-in (role: analyst).
    CSRF state is verified server-side via Redis (falls back to client-only check if Redis
    is unavailable — logs a warning so operators can investigate).
    """
    if not settings.MICROSOFT_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Microsoft SSO is not configured on this server")

    # Server-side CSRF state verification — consume the one-time state token
    r = _get_redis()
    if r:
        try:
            consumed = r.getdel(f"sso:state:{body.state}")
            if not consumed:
                logger.warning("SSO callback received invalid or expired state token")
                raise HTTPException(400, "Invalid or expired OAuth state — please start the login process again")
        except HTTPException:
            raise
        except Exception as exc:
            # Redis down: degrade gracefully but log loudly so ops knows
            logger.error("Redis unavailable during SSO state check — falling back to client-only verification: %s", exc)
    else:
        logger.warning("Redis not available — SSO CSRF state cannot be verified server-side")

    # ── Exchange code for Microsoft access token ──────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            token_resp = await client.post(
                f"{_authority()}/oauth2/v2.0/token",
                data={
                    "client_id": settings.MICROSOFT_CLIENT_ID,
                    "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                    "code": body.code,
                    "redirect_uri": _redirect_uri(),
                    "grant_type": "authorization_code",
                    "scope": "openid email profile User.Read",
                },
            )
    except Exception as exc:
        logger.error("httpx error calling Microsoft token endpoint: %s", exc)
        raise HTTPException(status_code=502, detail=f"Could not reach Microsoft login servers: {exc}")

    if token_resp.status_code != 200:
        try:
            ms_err = token_resp.json()
            ms_error_code = ms_err.get("error", "unknown")
            ms_error_desc = ms_err.get("error_description", token_resp.text)
        except Exception:
            ms_error_code = "parse_error"
            ms_error_desc = token_resp.text
        logger.error(
            "Microsoft token exchange failed [%s]: %s | redirect_uri=%s",
            ms_error_code, ms_error_desc, _redirect_uri()
        )
        # Surface the Microsoft error code so it's diagnosable without CloudWatch access
        raise HTTPException(
            status_code=401,
            detail=f"Microsoft authentication failed ({ms_error_code}) — check ECS env vars MICROSOFT_CLIENT_SECRET and FRONTEND_URL. Redirect URI used: {_redirect_uri()}"
        )

    ms_access_token = token_resp.json().get("access_token")

    # ── Fetch user profile from Microsoft Graph ───────────────────────────────
    async with httpx.AsyncClient(timeout=15) as client:
        profile_resp = await client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {ms_access_token}"},
        )

    if profile_resp.status_code != 200:
        logger.warning("Microsoft Graph profile fetch failed: %s", profile_resp.text)
        raise HTTPException(status_code=401, detail="Could not retrieve your Microsoft profile")

    profile = profile_resp.json()
    email = (profile.get("mail") or profile.get("userPrincipalName") or "").lower().strip()
    full_name = profile.get("displayName") or email.split("@")[0]

    if not email:
        raise HTTPException(status_code=400, detail="Your Microsoft account has no email address")

    # ── Find or create the DataSentinel user ──────────────────────────────────
    raw_sa = os.environ.get("SUPER_ADMIN_EMAILS", "")
    ADMIN_EMAILS = {e.strip() for e in raw_sa.split(",") if e.strip()}
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # SSO users: set a random hashed_password so verify_password always fails for local login
        import secrets as _secrets
        is_admin_email = email in ADMIN_EMAILS
        # Non-admin SSO users start with NO platform access — an admin must explicitly
        # grant access via User Management before they can use any platform bucket.
        # Admin/super_admin emails get full access immediately.
        sso_platform_access = None if is_admin_email else {
            "dqa": False, "anomaly": False, "vv": False, "reviewer": False,
        }
        user = User(
            email=email,
            full_name=full_name,
            hashed_password=hash_password(_secrets.token_urlsafe(32)),  # unguessable; discarded
            role="admin" if is_admin_email else "analyst",
            is_active=True,
            platform_access=sso_platform_access,
        )
        db.add(user)
        db.commit()   # Fix: persist the new SSO user before refresh; without this the row is never written
        db.refresh(user)
        logger.info("New SSO user created: %s (platform_access restricted until admin assigns)", email)

        # Notify all admins so they can assign platform access
        if not is_admin_email:
            try:
                from app.api.v1.notifications import create_notification
                admins = db.query(User).filter(
                    User.role.in_(["admin", "super_admin"]),
                    User.is_active == True,
                    User.id != user.id,
                ).all()
                for admin in admins:
                    create_notification(
                        db,
                        title="New SSO user joined",
                        message=(
                            f"{full_name or email} signed in via Microsoft SSO for the first time. "
                            f"Their account has no platform access yet — assign platforms in User Management."
                        ),
                        event_type="new_sso_user",
                        entity_id=str(user.id),
                        entity_type="user",
                        user_id=admin.id,
                    )
            except Exception as _notif_err:
                logger.warning("Could not send new-SSO-user notification: %s", _notif_err)

    elif not user.is_active:
        raise HTTPException(status_code=403, detail="Your account has been disabled — contact your administrator")

    jwt_token = create_access_token({"sub": user.email, "role": user.role})

    # Set HttpOnly session cookie
    response.set_cookie(
        key=SESSION_COOKIE,
        value=jwt_token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=(settings.ENVIRONMENT == "production"),
        samesite="lax",
        path="/",
    )

    logger.info("SSO login successful: %s", email)
    return {
        "access_token": jwt_token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "platform_access": getattr(user, "platform_access", None),
        },
    }
