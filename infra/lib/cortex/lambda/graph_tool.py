"""MCP tools in the `graph` target (Neptune Database, openCypher).

  trace   follow links out from one node: claim -> term -> stream -> evidence -> requirement

Queries are fixed templates with the tenant as a parameter; the model never
writes Cypher. Every row is checked again so a node from another tenant or an
ungranted project is never returned.
"""

import json
import logging
import os

import access

log = logging.getLogger()
log.setLevel(logging.INFO)

_client = None

TRACE = (
    "MATCH (start {uid: $uid, tenant_id: $tenant_id}) "
    "MATCH path = (start)-[*1..4]->(n {tenant_id: $tenant_id}) "
    "RETURN path LIMIT 200"
)


def client():
    global _client
    if _client is None:
        import boto3

        _client = boto3.client("neptunedata", endpoint_url=f"https://{os.environ['NEPTUNE_ENDPOINT']}:8182")
    return _client


def trace(event, caller):
    uid = str(event.get("uid") or "").strip()
    if not uid:
        return {"error": "Give the id of the node to trace from."}
    response = client().execute_open_cypher_query(
        openCypherQuery=TRACE,
        parameters=json.dumps({"uid": uid, "tenant_id": caller["tenant_id"]}),
    )
    rows = response.get("results", [])
    kept = [row for row in rows if access.graph_row_visible(caller, row)]
    if len(kept) != len(rows):
        log.error(json.dumps({"cortex_security": "graph_row_outside_scope", "tenant_id": caller["tenant_id"], "dropped": len(rows) - len(kept)}))
    return {"paths": kept}


def handler(event, context):
    try:
        caller = access.require_caller(event)
        custom = getattr(getattr(context, "client_context", None), "custom", None) or {}
        name = str(custom.get("bedrockAgentCoreToolName", "trace")).split("___")[-1]
        if name == "trace":
            return trace(event, caller)
        return {"error": f"Unknown tool {name}."}
    except access.Denied as error:
        return {"error": str(error)}
