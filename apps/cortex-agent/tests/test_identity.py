import asyncio
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from cortex_agent.identity import Unauthorized, Verifier, bearer, caller_from_claims

ISSUER = "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_test"
CLIENTS = frozenset({"web-client"})
CLAIMS = {
    "token_use": "access",
    "client_id": "web-client",
    "tenant_id": "fourfourone",
    "sub": "user-1",
    "role": "operator",
    "iss": ISSUER,
}


def test_bearer_reads_the_authorization_header_in_any_case():
    assert bearer({"authorization": "Bearer a.b.c"}) == "a.b.c"
    assert bearer({"Authorization": "bearer a.b.c"}) == "a.b.c"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Basic x"}, {"Authorization": "Bearer nodots"}])
def test_bearer_refuses_a_missing_or_malformed_token(headers):
    with pytest.raises(Unauthorized):
        bearer(headers)


def test_caller_comes_from_the_tenant_claims():
    caller = caller_from_claims(CLAIMS, "tok", CLIENTS)
    assert (caller.tenant_id, caller.sub, caller.role, caller.token) == ("fourfourone", "user-1", "operator", "tok")


def test_an_unknown_role_reads_as_viewer():
    assert caller_from_claims({**CLAIMS, "role": "admin"}, "tok", CLIENTS).role == "viewer"


@pytest.mark.parametrize(
    "change",
    [
        {"token_use": "id"},
        {"client_id": "other-app"},
        {"tenant_id": None},
        {"tenant_id": "Bad Tenant"},
        {"sub": ""},
    ],
)
def test_claims_that_do_not_identify_a_tenant_user_are_refused(change):
    with pytest.raises(Unauthorized):
        caller_from_claims({**CLAIMS, **change}, "tok", CLIENTS)


def _verifier_with(key):
    verifier = Verifier(ISSUER, CLIENTS)
    verifier._keys = SimpleNamespace(get_signing_key_from_jwt=lambda token: SimpleNamespace(key=key.public_key()))
    return verifier


def test_a_token_signed_by_the_pool_is_accepted():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode({**CLAIMS, "exp": int(time.time()) + 300}, key, algorithm="RS256")
    caller = asyncio.run(_verifier_with(key).caller({"Authorization": f"Bearer {token}"}))
    assert caller.tenant_id == "fourfourone"
    assert caller.token == token


@pytest.mark.parametrize(
    "claims",
    [
        {**CLAIMS, "exp": int(time.time()) - 600},  # expired
        {**CLAIMS, "exp": int(time.time()) + 300, "iss": "https://elsewhere"},  # another pool
    ],
)
def test_expired_or_foreign_tokens_are_refused(claims):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(claims, key, algorithm="RS256")
    with pytest.raises(Unauthorized):
        asyncio.run(_verifier_with(key).caller({"Authorization": f"Bearer {token}"}))


def test_a_token_signed_by_another_key_is_refused():
    pool_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode({**CLAIMS, "exp": int(time.time()) + 300}, other_key, algorithm="RS256")
    with pytest.raises(Unauthorized):
        asyncio.run(_verifier_with(pool_key).caller({"Authorization": f"Bearer {token}"}))
