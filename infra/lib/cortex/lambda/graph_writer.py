"""Write evidence links into the Cortex graph (Neptune, openCypher) from journey changes.

A journey change record (apps/web/src/lib/journey/storage.server.ts) reaches here
through the journeys table's stream, an EventBridge Pipe and the Cortex event bus
(event JourneyChanged; the bus archive can replay it). An answer that files
documents on a task becomes:

    (:Project)-[:HAS_TASK]->(:Task)            the task carries the registry rule it answers
    (:Document)-[:SATISFIES]->(:Task)          open while the document is filed there

Links are closed, never deleted: when a task's files are replaced, the links to
documents no longer filed get open=false and valid_to (a document filed again
reopens its link). No statement removes a property or an element, so the writer
needs Neptune's write permission only. Every statement is a MERGE
keyed by the change's version, so a replay or a repeat changes nothing, and an
older change arriving late never undoes a newer one.

Every node carries the tenant (and, for project nodes, the project), and every
uid starts with the tenant, so nothing is shared between tenants. Links come
only from these records, never from a model.
"""

import json
import logging
import os

log = logging.getLogger()
log.setLevel(logging.INFO)

_client = None

# Spreadsheets stay out of Cortex (kept by name on the journey), so they are not linked.
TASK_AND_PROJECT = (
    "MERGE (p:Project {uid: $project_uid}) "
    "SET p.tenant_id = $tenant_id, p.project_id = $project_id, p.kind = 'project' "
    "MERGE (t:Task {uid: $task_uid}) "
    "SET t.tenant_id = $tenant_id, t.project_id = $project_id, t.kind = 'task', "
    "t.task_id = $task_id, t.label = $label, t.step = $step, t.rule = $rule "
    "MERGE (p)-[:HAS_TASK]->(t)"
)

LINK_DOCUMENTS = (
    "MATCH (t:Task {uid: $task_uid}) "
    "UNWIND $documents AS doc "
    "MERGE (d:Document {uid: doc.uid}) "
    "SET d.tenant_id = $tenant_id, d.project_id = doc.project_id, d.kind = 'document', "
    "d.key = doc.key, d.name = doc.name, d.scope = doc.scope, d.pin = doc.pin "
    "MERGE (d)-[r:SATISFIES]->(t) "
    "ON CREATE SET r.open = true, r.valid_from = $at, r.made_by = $by, r.change = $version "
    # SET items apply in order: decide on r.open while r.change is still the old version.
    "ON MATCH SET r.open = CASE WHEN r.change < $version THEN true ELSE r.open END, "
    "r.change = CASE WHEN r.change < $version THEN $version ELSE r.change END"
)

CLOSE_REPLACED = (
    "MATCH (d:Document)-[r:SATISFIES]->(t:Task {uid: $task_uid}) "
    "WHERE NOT d.uid IN $keep AND r.open = true AND r.change < $version "
    "SET r.open = false, r.valid_to = $at, r.closed_by = $by, r.change = $version"
)


def client():
    global _client
    if _client is None:
        import boto3

        _client = boto3.client("neptunedata", endpoint_url=f"https://{os.environ['NEPTUNE_ENDPOINT']}:8182")
    return _client


def _text(image, field):
    return ((image or {}).get(field) or {}).get("S") or ""


def project_uid(tenant_id, project_id):
    return f"{tenant_id}#project#{project_id}"


def task_uid(tenant_id, project_id, task_id):
    return f"{tenant_id}#task#{project_id}#{task_id}"


def document_uid(tenant_id, key):
    return f"{tenant_id}#document#{key}"


def document_place(key, tenant_id, project_id):
    """Scope, pin and owning project of a Cortex key; None for a key this project cannot have filed."""
    parts = key.split("/")
    if ".." in parts:
        return None
    if parts[:2] == ["tenants", tenant_id] and parts[2:4] == ["projects", project_id] and len(parts) >= 6:
        return {"scope": "project", "pin": parts[4], "project_id": project_id}
    if parts[:3] == ["tenants", tenant_id, "tenant"] and len(parts) >= 5:
        return {"scope": "tenant", "pin": parts[3], "project_id": ""}
    if parts[0] == "shared" and len(parts) >= 5:
        return {"scope": "shared", "pin": "", "project_id": ""}
    return None


def filing(image):
    """What a journey change record files, or None when it files nothing.

    Only answers that carry a files list do: an answer without one keeps the
    files given before (and their links)."""
    if _text(image, "action") != "answer" or "files" not in (image or {}):
        return None
    parts = _text(image, "pk").split("#")
    if len(parts) != 4 or parts[0] != "TENANT" or parts[2] != "PROJECT" or not _text(image, "taskId"):
        log.error(json.dumps({"cortex_graph": "unreadable_change", "pk": _text(image, "pk")}))
        return None
    tenant_id, project_id = parts[1], parts[3]
    try:
        files = json.loads(_text(image, "files") or "[]")
    except ValueError:
        files = []
    documents = []
    for file in files if isinstance(files, list) else []:
        key = (file or {}).get("key")
        if not isinstance(key, str) or not key:
            continue  # a spreadsheet kept by name
        place = document_place(key, tenant_id, project_id)
        if place is None:
            log.error(json.dumps({"cortex_security": "filing_outside_scope", "tenant_id": tenant_id, "project_id": project_id}))
            continue
        documents.append({"uid": document_uid(tenant_id, key), "key": key, "name": str(file.get("name") or key.rsplit("/", 1)[-1]), **place})
    task_id = _text(image, "taskId")
    return {
        "tenant_id": tenant_id,
        "project_id": project_id,
        "project_uid": project_uid(tenant_id, project_id),
        "task_uid": task_uid(tenant_id, project_id, task_id),
        "task_id": task_id,
        "label": _text(image, "label") or task_id,
        "step": _text(image, "step"),
        "rule": _text(image, "rule"),
        "version": int(((image.get("version") or {}).get("N")) or 0),
        "at": _text(image, "at"),
        "by": _text(image, "by"),
        "documents": documents,
    }


def statements(filed):
    """The openCypher statements for one filing, in order, with their parameters."""
    common = {key: filed[key] for key in ("tenant_id", "project_id", "task_uid", "version", "at", "by")}
    out = [(TASK_AND_PROJECT, {**common, **{key: filed[key] for key in ("project_uid", "task_id", "label", "step", "rule")}})]
    if filed["documents"]:
        out.append((LINK_DOCUMENTS, {**common, "documents": filed["documents"]}))
    out.append((CLOSE_REPLACED, {**common, "keep": [doc["uid"] for doc in filed["documents"]]}))
    return out


def handler(event, _context):
    """EventBridge JourneyChanged: the detail is the stream record of one change."""
    image = ((event.get("detail") or {}).get("dynamodb") or {}).get("NewImage")
    filed = filing(image)
    if not filed:
        return {"linked": 0}
    for query, parameters in statements(filed):
        client().execute_open_cypher_query(openCypherQuery=query, parameters=json.dumps(parameters))
    log.info(
        json.dumps(
            {
                "cortex_graph": "linked",
                "tenant_id": filed["tenant_id"],
                "project_id": filed["project_id"],
                "task_id": filed["task_id"],
                "documents": len(filed["documents"]),
                "version": filed["version"],
            }
        )
    )
    return {"linked": len(filed["documents"])}
