"""MCP tools in the `graph` target (Neptune Database, openCypher).

  trace     follow links out from one node: claim -> term -> stream -> evidence -> requirement
  evidence  a project's evidence links: which documents are filed for which journey
            tasks (each with the registry rule it answers), since when, and which were
            replaced; for one task, or for the tasks one document is filed against.
            Written by graph_writer.py from journey changes.

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


EVIDENCE = (
    "MATCH (p:Project {uid: $project_uid})-[:HAS_TASK]->(t:Task) "
    "WHERE $task_id = '' OR t.task_id = $task_id "
    "OPTIONAL MATCH (d:Document)-[r:SATISFIES]->(t) "
    "RETURN t.tenant_id AS tenant_id, t.project_id AS project_id, t.task_id AS task_id, "
    "t.label AS label, t.step AS step, t.rule AS rule, "
    "d.tenant_id AS doc_tenant_id, d.project_id AS doc_project_id, d.name AS name, d.key AS key, "
    "d.scope AS scope, r.open AS open, r.valid_from AS since, r.valid_to AS until "
    "LIMIT 2000"
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


def _row_in_scope(caller, project_id, row):
    """Second check on every row: the task is the requested project's, the document the tenant's."""
    if row.get("tenant_id") != caller["tenant_id"] or row.get("project_id") != project_id:
        return False
    if row.get("key") is None:
        return True  # a task with no document linked
    doc_project = row.get("doc_project_id") or ""
    return row.get("doc_tenant_id") == caller["tenant_id"] and (not doc_project or doc_project == project_id)


def group_evidence(rows, caller, project_id, document=""):
    """Rows (one per task and document) as tasks with their open and replaced documents."""
    wanted = document.strip().lower()
    tasks = {}
    dropped = 0
    for row in rows:
        if not _row_in_scope(caller, project_id, row):
            dropped += 1
            continue
        task = tasks.setdefault(
            row["task_id"],
            {key: row.get(key) or "" for key in ("task_id", "label", "step", "rule")} | {"documents": [], "replaced": []},
        )
        if row.get("key") is None:
            continue
        if wanted and wanted not in (str(row.get("name") or "").lower(), str(row.get("key") or "").lower()):
            continue
        if row.get("open"):
            task["documents"].append({"name": row.get("name"), "key": row.get("key"), "scope": row.get("scope"), "since": row.get("since")})
        else:
            task["replaced"].append({"name": row.get("name"), "since": row.get("since"), "until": row.get("until")})
    if dropped:
        log.error(json.dumps({"cortex_security": "evidence_row_outside_scope", "tenant_id": caller["tenant_id"], "dropped": dropped}))
    found = list(tasks.values())
    if wanted:
        found = [task for task in found if task["documents"] or task["replaced"]]
    return sorted(found, key=lambda task: (task["step"], task["task_id"]))


def evidence(event, caller):
    project_id = caller.get("project_id")
    if not project_id:
        return {"error": "Name the project (project_id) whose evidence links to read."}
    if project_id not in caller.get("project_ids", []):
        raise access.Denied("You have no access to that project.")
    task_id = str(event.get("task_id") or "").strip()
    document = str(event.get("document") or "").strip()
    response = client().execute_open_cypher_query(
        openCypherQuery=EVIDENCE,
        parameters=json.dumps({"project_uid": f"{caller['tenant_id']}#project#{project_id}", "task_id": task_id}),
    )
    tasks = group_evidence(response.get("results", []), caller, project_id, document)
    answer = {"project_id": project_id, "tasks": tasks}
    if not tasks:
        answer["message"] = (
            "No evidence links match. Links are made when a document is filed on a journey task of a saved project."
        )
    return answer


def handler(event, context):
    try:
        caller = access.require_caller(event)
        custom = getattr(getattr(context, "client_context", None), "custom", None) or {}
        name = str(custom.get("bedrockAgentCoreToolName", "trace")).split("___")[-1]
        if name == "trace":
            return trace(event, caller)
        if name == "evidence":
            return evidence(event, caller)
        return {"error": f"Unknown tool {name}."}
    except access.Denied as error:
        return {"error": str(error)}
