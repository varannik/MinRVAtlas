"""Tenant and project access rules for Cortex tools.

Pure functions only (no AWS calls), so the rules run in unit tests. The Lambdas
pass in what they read from the verified token and the tenancy table.

Knowledge has three scopes:
  shared   registry and methodology documents every tenant may read
  tenant   one tenant's own material (procedures, policies)
  project  one project's material (site documents, monitoring plan, evidence)
"""

import base64
import json
import re

TENANT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
ROLES = ("platform_admin", "tenant_admin", "quality_engineer", "operator", "verifier", "viewer")
# Roles that see every project inside their own tenant (never another tenant).
TENANT_WIDE_ROLES = frozenset({"platform_admin", "tenant_admin"})
SCOPES = ("shared", "tenant", "project")
# Where a shared (registry) document is filed: shared/<registry>/<methodology>/<edition>/<file>.
# A project searches those filed under its own values or under "any" (shared/any/any/any/
# holds public references every project searches).
SHARED_PLACE = ("registry", "methodology", "edition")
# The argument the gateway interceptor sets on every tool call. Whatever a
# client sends under this name is thrown away first.
CALLER_ARG = "caller"
DENIED_CODE = -32003


class Denied(Exception):
    """The caller may not make this request. The message is safe to return."""


# ── Identity ────────────────────────────────────────────────────────────────


def bearer_claims(headers):
    """Claims of the access token. The gateway has already verified its
    signature, expiry and client before the interceptor runs."""
    auth = next((v for k, v in (headers or {}).items() if k.lower() == "authorization"), "")
    if not isinstance(auth, str) or not auth.lower().startswith("bearer "):
        raise Denied("Sign in to use Cortex tools.")
    parts = auth.split(" ", 1)[1].strip().split(".")
    if len(parts) != 3:
        raise Denied("The access token is malformed.")
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, TypeError):
        raise Denied("The access token is malformed.") from None
    if not isinstance(claims, dict):
        raise Denied("The access token is malformed.")
    return claims


def identity(claims):
    """Tenant, role and user from the claims the pre-token trigger adds."""
    if claims.get("token_use") != "access":
        raise Denied("Use an access token, not an ID token.")
    tenant = claims.get("tenant_id")
    if not isinstance(tenant, str) or not TENANT_ID.match(tenant):
        raise Denied("Your account is not linked to a tenant.")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise Denied("The access token has no user.")
    role = claims.get("role") if claims.get("role") in ROLES else "viewer"
    return {"tenant_id": tenant, "role": role, "sub": sub}


def allowed_projects(role, tenant_projects, member_projects):
    """Projects this user may work on inside their tenant. A grant for a
    project the tenant no longer has does not count."""
    tenant_projects = set(tenant_projects)
    if role in TENANT_WIDE_ROLES:
        return sorted(tenant_projects)
    return sorted(set(member_projects) & tenant_projects)


def caller_for(ident, tenant_status, projects, requested_project):
    """The caller block every tool receives."""
    if tenant_status != "active":
        raise Denied("Your tenant is not active on Cortex.")
    if requested_project is not None:
        if not isinstance(requested_project, str) or not TENANT_ID.match(requested_project):
            raise Denied("Unknown project.")
        if requested_project not in projects:
            raise Denied("You have no access to that project.")
    return {**ident, "project_ids": list(projects), "project_id": requested_project}


# ── Gateway interceptor ─────────────────────────────────────────────────────


def passthrough(body):
    return {"interceptorOutputVersion": "1.0", "mcp": {"transformedGatewayRequest": {"body": body}}}


def deny(rpc_id, reason):
    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayResponse": {
                "statusCode": 200,
                "body": {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": DENIED_CODE, "message": reason}},
            }
        },
    }


def intercept(event, lookup):
    """Decide one MCP request.

    lookup(tenant_id, sub) -> (tenant_status, tenant_project_ids, member_project_ids)

    Returns (interceptor_output, decision). Every request needs a tenant on the
    token; tools/call also gets the caller block, checked against the tenancy
    table, in its arguments.
    """
    request = (event.get("mcp") or {}).get("gatewayRequest") or {}
    body = request.get("body") or {}
    rpc_id = body.get("id")
    method = body.get("method")
    decision = {"method": method, "tool": None, "tenant_id": None, "sub": None, "project_id": None}
    try:
        ident = identity(bearer_claims(request.get("headers")))
        decision.update(tenant_id=ident["tenant_id"], sub=ident["sub"])
        if method != "tools/call":
            return passthrough(body), {**decision, "allowed": True}
        params = dict(body.get("params") or {})
        args = dict(params.get("arguments") or {})
        args.pop(CALLER_ARG, None)
        decision.update(tool=params.get("name"), project_id=args.get("project_id"))
        status, tenant_projects, member_projects = lookup(ident["tenant_id"], ident["sub"])
        projects = allowed_projects(ident["role"], tenant_projects, member_projects)
        args[CALLER_ARG] = caller_for(ident, status, projects, args.get("project_id"))
        params["arguments"] = args
        return passthrough({**body, "params": params}), {**decision, "allowed": True}
    except Denied as error:
        return deny(rpc_id, str(error)), {**decision, "allowed": False, "reason": str(error)}


def require_caller(event):
    """Tools refuse anything that did not come through the interceptor."""
    caller = event.get(CALLER_ARG) if isinstance(event, dict) else None
    if (
        not isinstance(caller, dict)
        or not TENANT_ID.match(str(caller.get("tenant_id", "")))
        or not isinstance(caller.get("project_ids"), list)
    ):
        raise Denied("Call this tool through the Cortex gateway.")
    return caller


# ── Knowledge scope ─────────────────────────────────────────────────────────


def _eq(key, value):
    return {"equals": {"key": key, "value": value}}


def retrieval_filter(caller, project=None):
    """Bedrock Knowledge Bases filter: shared documents (for the project's
    registry, methodology and edition when a project is given, or filed under
    "any"), the tenant's own documents, and the requested project's documents.
    Nothing else."""
    tenant = caller["tenant_id"]
    shared = _eq("scope", "shared")
    narrowing = [
        {"in": {"key": field, "value": [project[field], "any"]}}
        for field in SHARED_PLACE
        if project and project.get(field)
    ]
    if narrowing:
        shared = {"andAll": [shared, *narrowing]}
    clauses = [shared, {"andAll": [_eq("scope", "tenant"), _eq("tenant_id", tenant)]}]
    project_id = caller.get("project_id")
    if project_id:
        if project_id not in caller.get("project_ids", []):
            raise Denied("You have no access to that project.")
        clauses.append({"andAll": [_eq("scope", "project"), _eq("tenant_id", tenant), _eq("project_id", project_id)]})
    return {"orAll": clauses}


def visible(caller, metadata):
    """Second check on every search result, in case a filter is ever wrong."""
    scope = metadata.get("scope")
    if scope == "shared":
        return not metadata.get("tenant_id") and not metadata.get("project_id")
    if metadata.get("tenant_id") != caller["tenant_id"]:
        return False
    if scope == "tenant":
        return not metadata.get("project_id")
    if scope == "project":
        project_id = metadata.get("project_id")
        return project_id == caller.get("project_id") and project_id in caller.get("project_ids", [])
    return False


def key_scope(key):
    """Scope of an object from where it was uploaded.

    shared/<registry>/<methodology>/<edition>/<file>
    tenants/<tenant>/tenant/<file>
    tenants/<tenant>/projects/<project>/<file>
    """
    if not isinstance(key, str) or ".." in key or key.endswith("/") or key.endswith(".metadata.json"):
        raise ValueError(f"Not an accepted document key: {key}")
    parts = key.split("/")
    if parts[0] == "shared" and len(parts) >= 5:
        registry, methodology, edition = parts[1:4]
        return {"scope": "shared", "registry": registry, "methodology": methodology, "edition": edition}
    if parts[0] == "tenants" and len(parts) >= 4 and TENANT_ID.match(parts[1]):
        if parts[2] == "tenant":
            return {"scope": "tenant", "tenant_id": parts[1]}
        if parts[2] == "projects" and len(parts) >= 5 and TENANT_ID.match(parts[3]):
            return {"scope": "project", "tenant_id": parts[1], "project_id": parts[3]}
    raise ValueError(f"Not an accepted document key: {key}")


def sidecar(metadata):
    """Bedrock Knowledge Bases metadata file for one document."""
    return {"metadataAttributes": {k: v for k, v in metadata.items() if v not in (None, "")}}


# ── Graph ───────────────────────────────────────────────────────────────────


def graph_nodes(value):
    """Every node dict in an openCypher result, however deeply nested."""
    if isinstance(value, dict):
        if value.get("~entityType") == "node":
            yield value
        for inner in value.values():
            yield from graph_nodes(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from graph_nodes(inner)


def graph_row_visible(caller, row):
    """Keep a result row only if every node in it belongs to the caller's tenant
    and to a project they may see."""
    for node in graph_nodes(row):
        props = node.get("~properties") or {}
        if props.get("tenant_id") != caller["tenant_id"]:
            return False
        project_id = props.get("project_id")
        if project_id and project_id not in caller.get("project_ids", []):
            return False
    return True
