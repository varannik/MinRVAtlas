"""MCP tool in the `quality` target: what the data quality engine found for a project.

  findings  the latest finished run: its verdict (for the whole history, or for the
            dates asked about) and its findings, most severe first, each in the
            engine's own words (what's wrong, what we saw, why it matters, what to do)

It reads the quality table (apps/quality-engine/quality_engine/store.py) in the
caller's tenant and the project the gateway checked they may work on; nothing else.
Verdicts come from the engine's checks; this tool only reports them.
"""

import json
import logging
import os
import re

import access

log = logging.getLogger()
log.setLevel(logging.INFO)

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SEVERITIES = ("blocks", "look", "info")
MAX_FINDINGS = 30
# Fields of a finding the agent sees.
SHOWN = ("id", "severity", "status", "blocking", "kind", "metric", "fixedKey", "start", "end", "review")

_dynamodb = None


def dynamodb():
    global _dynamodb
    if _dynamodb is None:
        import boto3

        _dynamodb = boto3.client("dynamodb")
    return _dynamodb


def project_key(tenant_id, project_id):
    return f"TENANT#{tenant_id}#PROJECT#{project_id}"


def query(pk, prefix, newest_first=False, limit=None):
    items, start = [], None
    while True:
        page = dynamodb().query(
            TableName=os.environ["QUALITY_TABLE"],
            KeyConditionExpression="pk = :pk AND begins_with(sk, :prefix)",
            ExpressionAttributeValues={":pk": {"S": pk}, ":prefix": {"S": prefix}},
            ScanIndexForward=not newest_first,
            **({"Limit": limit} if limit else {}),
            **({"ExclusiveStartKey": start} if start else {}),
        )
        items.extend(page.get("Items", []))
        start = page.get("LastEvaluatedKey")
        if not start or (limit and len(items) >= limit):
            return items


def brief(finding):
    out = {field: finding.get(field) for field in SHOWN if finding.get(field) is not None}
    text = finding.get("text") or {}
    for part in ("headline", "saw", "matters", "todo"):
        if text.get(part):
            out[part] = text[part]
    return out


def touches(finding, start, end):
    return (not start or finding["end"] >= start) and (not end or finding["start"] <= end)


def verdict(findings):
    if any(f.get("blocking") for f in findings):
        return "blocked"
    if any(f.get("status") == "open" and (f.get("severity") == "look" or f.get("advisory")) for f in findings):
        return "needs_look"
    return "clear"


def describe(runs, finding_items, start=None, end=None, severity=None):
    """What the tool answers, from the project's newest runs and the findings of its latest finished one."""
    running = any(run.get("status", {}).get("S") == "running" for run in runs)
    done = next((run for run in runs if run.get("status", {}).get("S") == "done"), None)
    if not done:
        return {
            "checked": False,
            "running": running,
            "message": "The quality engine has not finished a run on this project yet."
            + (" One is running now." if running else " A run starts when someone opens the project's calculation tree."),
        }
    result = json.loads(done.get("result", {}).get("S") or "{}")
    findings = [json.loads(item["finding"]["S"]) for item in finding_items]
    picked = [f for f in findings if touches(f, start, end)]
    if severity:
        picked = [f for f in picked if f.get("severity") == severity]
    return {
        "checked": True,
        "running": running,
        "run": {
            "id": done["runId"]["S"],
            "finished_at": done.get("finishedAt", {}).get("S"),
            "data_source": done.get("source", {}).get("S"),
            "data_range": result.get("range"),
            "versions": result.get("versions"),
        },
        "verdict": verdict([f for f in findings if touches(f, start, end)]),
        "verdict_for": {"start": start, "end": end} if start or end else "the whole history",
        "counts": result.get("counts"),
        "findings": [brief(f) for f in picked[:MAX_FINDINGS]],
        "showing": min(len(picked), MAX_FINDINGS),
        "matching": len(picked),
    }


def findings(event, caller):
    project_id = caller.get("project_id")
    if not project_id:
        return {"error": "Name the project (project_id) whose data quality to read."}
    if project_id not in caller.get("project_ids", []):
        raise access.Denied("You have no access to that project.")
    start, end = event.get("from"), event.get("to")
    for value in (start, end):
        if value and not DAY.match(str(value)):
            return {"error": "Give dates as YYYY-MM-DD."}
    severity = event.get("severity")
    if severity and severity not in SEVERITIES:
        return {"error": f"severity is one of {', '.join(SEVERITIES)}."}
    pk = project_key(caller["tenant_id"], project_id)
    runs = query(pk, "RUN#", newest_first=True, limit=10)
    done = next((run for run in runs if run.get("status", {}).get("S") == "done"), None)
    items = query(pk, f"FINDING#{done['runId']['S']}#") if done else []
    return describe(runs, items, start, end, severity)


def handler(event, context):
    try:
        caller = access.require_caller(event)
        custom = getattr(getattr(context, "client_context", None), "custom", None) or {}
        name = str(custom.get("bedrockAgentCoreToolName", "findings")).split("___")[-1]
        if name == "findings":
            return findings(event, caller)
        return {"error": f"Unknown tool {name}."}
    except access.Denied as error:
        return {"error": str(error)}
