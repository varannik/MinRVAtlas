"""Who is asking: the signed-in user's Cognito access token.

The AgentCore Runtime verifies the token before a request reaches this
container. The agent checks it again because it acts on the claims: the tenant
tags the session that reads and writes the conversation, and the token itself
goes on to the tool gateway, which checks it a third time.
"""

import asyncio
import re
from dataclasses import dataclass

import jwt

# Same rules as infra/lib/cortex/lambda/access.py and the web (CORTEX_ID).
TENANT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
ROLES = ("platform_admin", "tenant_admin", "quality_engineer", "operator", "verifier", "viewer")


class Unauthorized(Exception):
    """The request carries no usable sign-in. The message is safe to show."""


@dataclass(frozen=True)
class Caller:
    tenant_id: str
    sub: str
    role: str
    token: str


def bearer(headers: dict[str, str]) -> str:
    value = next((v for k, v in (headers or {}).items() if k.lower() == "authorization"), "")
    if not isinstance(value, str) or not value.lower().startswith("bearer "):
        raise Unauthorized("Sign in to ask Cortex.")
    token = value.split(" ", 1)[1].strip()
    if token.count(".") != 2:
        raise Unauthorized("Your sign-in could not be read. Sign in again.")
    return token


def caller_from_claims(claims: dict, token: str, client_ids: frozenset[str]) -> Caller:
    """The caller from verified claims (the pre-token trigger adds tenant_id and role)."""
    if claims.get("token_use") != "access":
        raise Unauthorized("Cortex needs an access token, not an ID token.")
    if client_ids and claims.get("client_id") not in client_ids:
        raise Unauthorized("This sign-in is for another application.")
    tenant = claims.get("tenant_id")
    if not isinstance(tenant, str) or not TENANT_ID.match(tenant):
        raise Unauthorized("Your account is not linked to an organisation in Cortex.")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise Unauthorized("Your sign-in has no user id. Sign in again.")
    role = claims.get("role") if claims.get("role") in ROLES else "viewer"
    return Caller(tenant_id=tenant, sub=sub, role=role, token=token)


class Verifier:
    """Checks access tokens against the user pool's published signing keys."""

    def __init__(self, issuer: str, client_ids: frozenset[str]):
        self.issuer = issuer
        self.client_ids = client_ids
        self._keys = jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", cache_keys=True, lifespan=3600)

    async def caller(self, headers: dict[str, str]) -> Caller:
        token = bearer(headers)
        try:
            # The key fetch is blocking (and cached after the first request).
            key = await asyncio.to_thread(self._keys.get_signing_key_from_jwt, token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                issuer=self.issuer,
                options={"require": ["exp", "iss", "sub"], "verify_aud": False},
                leeway=30,
            )
        except jwt.ExpiredSignatureError:
            raise Unauthorized("Your sign-in has expired. Sign in again.") from None
        except (jwt.PyJWTError, jwt.PyJWKClientError):
            raise Unauthorized("Your sign-in could not be checked. Sign in again.") from None
        return caller_from_claims(claims, token, self.client_ids)
