"""Write evidence links into the Cortex graph (Neptune, openCypher) from journey changes
and finished data quality runs.

A journey change record (apps/web/src/lib/journey/storage.server.ts) reaches here
through the journeys table's stream, an EventBridge Pipe and the Cortex event bus
(event JourneyChanged; the bus archive can replay it). An answer that files
documents on a task becomes:

    (:Project)-[:HAS_TASK]->(:Task)            the task carries the registry rule it answers
    (:Document)-[:SATISFIES]->(:Task)          open while the document is filed there

Links are closed, never deleted: when a task's files are replaced, the links to
documents no longer filed get open=false and valid_to (a document filed again
reopens its link). No statement deletes an element or removes a property (the
tests check). Neptune still asks for its delete permission on any SET, since a SET
may replace a value, so the writer's role has it. Every statement is a MERGE
keyed by the change's version, so a replay or a repeat changes nothing, and an
older change arriving late never undoes a newer one.

A finished data quality run (event QualityRunCompleted from the quality engine,
apps/quality-engine; its detail carries ids and keys, never the sentences) becomes:

    (:Project)-[:HAS_QUALITY_RUN]->(:QualityRun)   verdict, days checked, counts
    (:QualityRun)-[:FOUND]->(:Finding)             every finding the run reported
    (:Finding)-[:HOLDS]->(:Task)                   open while the finding is open and
                                                   the task's records are where it is fixed

A finding dismissed by a person, or gone from a later run (resolved), has its
HOLDS link closed (open=false, valid_to, closed_by). Run ids sort by time, so
statements apply a run only over older ones: a replay or a late run changes nothing.

Every node carries the tenant (and, for project nodes, the project), and every
uid starts with the tenant, so nothing is shared between tenants. Links come
only from these records, never from a model.
"""

import json
import logging
import os
import re

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


QUALITY_RUN = (
    "MERGE (p:Project {uid: $project_uid}) "
    "SET p.tenant_id = $tenant_id, p.project_id = $project_id, p.kind = 'project' "
    "MERGE (r:QualityRun {uid: $run_uid}) "
    "SET r.tenant_id = $tenant_id, r.project_id = $project_id, r.kind = 'quality_run', r.run_id = $run_id, "
    "r.verdict = $verdict, r.start = $start, r.end = $end, r.finished_at = $at, "
    "r.blocks = $blocks, r.look = $look, r.info = $info, r.dismissed = $dismissed, r.findings = $total "
    "MERGE (p)-[:HAS_QUALITY_RUN]->(r)"
)

# Only a run at least as new as the one that last wrote a finding updates it.
QUALITY_FINDINGS = (
    "MATCH (r:QualityRun {uid: $run_uid}) "
    "UNWIND $findings AS fd "
    "MERGE (f:Finding {uid: fd.uid}) "
    "MERGE (r)-[:FOUND]->(f) "
    "WITH f, fd WHERE coalesce(f.last_run, '') <= $run_id "
    "SET f.tenant_id = $tenant_id, f.project_id = $project_id, f.kind = 'finding', f.finding_id = fd.id, "
    "f.check = fd.kind, f.severity = fd.severity, f.status = fd.status, f.blocking = fd.blocking, "
    "f.metric = fd.metric, f.fixed_key = fd.fixed_key, f.task_id = fd.task, f.start = fd.start, f.end = fd.end, "
    "f.last_run = $run_id"
)

HOLD_TASKS = (
    "UNWIND $held AS fd "
    "MATCH (f:Finding {uid: fd.uid}) "
    "MERGE (t:Task {uid: fd.task_uid}) "
    "ON CREATE SET t.tenant_id = $tenant_id, t.project_id = $project_id, t.kind = 'task', t.task_id = fd.task "
    "MERGE (f)-[h:HOLDS]->(t) "
    "ON CREATE SET h.open = true, h.valid_from = $at, h.run = $run_id "
    # SET items apply in order: decide on h.open while h.run is still the old run.
    "ON MATCH SET h.open = CASE WHEN h.run < $run_id THEN true ELSE h.open END, "
    "h.run = CASE WHEN h.run < $run_id THEN $run_id ELSE h.run END"
)

RELEASE_DISMISSED = (
    "UNWIND $released AS uid "
    "MATCH (f:Finding {uid: uid})-[h:HOLDS]->(:Task) "
    "WHERE h.open = true AND h.run < $run_id "
    "SET h.open = false, h.valid_to = $at, h.closed_by = 'dismissed', h.run = $run_id"
)

# A finding the newest run no longer reports has been fixed (or its data replaced).
RELEASE_RESOLVED = (
    "MATCH (f:Finding)-[h:HOLDS]->(:Task) "
    "WHERE f.tenant_id = $tenant_id AND f.project_id = $project_id AND NOT f.uid IN $present "
    "AND h.open = true AND h.run < $run_id "
    "SET h.open = false, h.valid_to = $at, h.closed_by = 'resolved', h.run = $run_id"
)

MARK_RESOLVED = (
    "MATCH (f:Finding) "
    "WHERE f.tenant_id = $tenant_id AND f.project_id = $project_id AND NOT f.uid IN $present "
    "AND f.last_run < $run_id AND f.status <> 'resolved' "
    "SET f.status = 'resolved', f.last_run = $run_id"
)

ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
RUN_ID = re.compile(r"^\d{8}T\d{6}Z-[a-z0-9]{4,12}$")
FINDING_ID = re.compile(r"^F-[0-9a-f]{16}$")
TASK_ID = re.compile(r"^[a-z][a-z0-9-]*\.[a-z0-9-]+$")
SEVERITIES = ("blocks", "look", "info")


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


def finding_uid(tenant_id, project_id, finding_id):
    return f"{tenant_id}#finding#{project_id}#{finding_id}"


def quality_run_uid(tenant_id, project_id, run_id):
    return f"{tenant_id}#quality-run#{project_id}#{run_id}"


def quality_run(detail):
    """What a finished quality run links, or None when the event cannot be trusted to name it."""
    tenant_id, project_id, run_id = detail.get("tenant_id"), detail.get("project_id"), detail.get("run_id")
    if not (isinstance(tenant_id, str) and ID.match(tenant_id) and isinstance(project_id, str) and ID.match(project_id)
            and isinstance(run_id, str) and RUN_ID.match(run_id)):
        log.error(json.dumps({"cortex_graph": "unreadable_quality_run", "run_id": str(run_id)[:40]}))
        return None
    findings = []
    for raw in detail.get("findings") or []:
        if not isinstance(raw, dict) or not FINDING_ID.match(str(raw.get("id") or "")) or raw.get("severity") not in SEVERITIES:
            continue
        task = raw.get("task") if isinstance(raw.get("task"), str) and TASK_ID.match(raw.get("task") or "") else ""
        findings.append(
            {
                "uid": finding_uid(tenant_id, project_id, raw["id"]),
                "id": raw["id"],
                "kind": str(raw.get("kind") or "")[:40],
                "severity": raw["severity"],
                "status": str(raw.get("status") or "open")[:20],
                "blocking": bool(raw.get("blocking")),
                "metric": str(raw.get("metric") or "")[:80],
                "fixed_key": str(raw.get("fixed_key") or "")[:80],
                "task": task,
                "task_uid": task_uid(tenant_id, project_id, task) if task else "",
                "start": str(raw.get("start") or "")[:10],
                "end": str(raw.get("end") or "")[:10],
            }
        )
    counts = detail.get("counts") if isinstance(detail.get("counts"), dict) else {}
    span = detail.get("range") if isinstance(detail.get("range"), dict) else {}
    total = detail.get("findings_total")
    return {
        "tenant_id": tenant_id,
        "project_id": project_id,
        "project_uid": project_uid(tenant_id, project_id),
        "run_id": run_id,
        "run_uid": quality_run_uid(tenant_id, project_id, run_id),
        "verdict": str(detail.get("verdict") or "")[:20],
        "start": str(span.get("start") or ""),
        "end": str(span.get("end") or ""),
        "at": str(detail.get("finished_at") or ""),
        **{key: int(counts.get(key) or 0) for key in ("blocks", "look", "info", "dismissed")},
        "total": int(total) if isinstance(total, int) else len(findings),
        # Findings beyond what the event carries are unknown, so nothing is taken as resolved.
        "complete": not isinstance(total, int) or total <= len(findings),
        "findings": findings,
    }


def quality_statements(run):
    """The openCypher statements for one finished quality run, in order, with their parameters."""
    common = {key: run[key] for key in ("tenant_id", "project_id", "run_id", "run_uid", "at")}
    out = [(QUALITY_RUN, {**common, **{key: run[key] for key in ("project_uid", "verdict", "start", "end", "blocks", "look", "info", "dismissed", "total")}})]
    if run["findings"]:
        out.append((QUALITY_FINDINGS, {**common, "findings": run["findings"]}))
    held = [f for f in run["findings"] if f["task"] and f["status"] != "dismissed"]
    if held:
        out.append((HOLD_TASKS, {**common, "held": held}))
    released = [f["uid"] for f in run["findings"] if f["task"] and f["status"] == "dismissed"]
    if released:
        out.append((RELEASE_DISMISSED, {**common, "released": released}))
    if run["complete"]:
        present = [f["uid"] for f in run["findings"]]
        out.append((RELEASE_RESOLVED, {**common, "present": present}))
        out.append((MARK_RESOLVED, {**common, "present": present}))
    return out


def link_quality_run(detail):
    run = quality_run(detail or {})
    if not run:
        return {"linked": 0}
    for query, parameters in quality_statements(run):
        client().execute_open_cypher_query(openCypherQuery=query, parameters=json.dumps(parameters))
    held = sum(1 for f in run["findings"] if f["task"] and f["status"] != "dismissed")
    log.info(json.dumps({"cortex_graph": "quality_run", "tenant_id": run["tenant_id"], "project_id": run["project_id"], "run_id": run["run_id"], "findings": len(run["findings"]), "held_tasks": held}))
    return {"linked": len(run["findings"])}


def handler(event, _context):
    """EventBridge: JourneyChanged (the detail is the stream record of one change) or
    QualityRunCompleted (the detail is the run's verdict and its findings' ids)."""
    if event.get("detail-type") == "QualityRunCompleted":
        return link_quality_run(event.get("detail"))
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
