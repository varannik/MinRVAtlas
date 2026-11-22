"""MCP tool in the `journey` target: where a project stands on its registry journey.

  status   the saved journey: each step's progress, the work left in the current
           step and everything Cortex flagged; with `step`, that step's tasks in
           full (answers, files, Cortex's notes)

It reads the summary the web saves with every change to a journey
(apps/web/src/lib/journey/summary.ts), so the journey's rules live in one place.
The item is the caller's tenant and the project the gateway checked they may
work on; nothing else is read.
"""

import json
import logging
import os

import access

log = logging.getLogger()
log.setLevel(logging.INFO)

_dynamodb = None

# Fields of a task shown in the overview (the step view shows them all).
OVERVIEW_TASK = ("id", "label", "status", "blocks", "note")


def dynamodb():
    global _dynamodb
    if _dynamodb is None:
        import boto3

        _dynamodb = boto3.client("dynamodb")
    return _dynamodb


def journey_key(tenant_id, project_id):
    return f"TENANT#{tenant_id}#PROJECT#{project_id}"


def _brief(task, step):
    brief = {field: task[field] for field in OVERVIEW_TASK if field in task}
    return {**brief, "step": step["label"]}


def overview(summary):
    """Every step's progress, what the current step still needs, and every flag."""
    steps = summary.get("steps") or []
    current = next((step for step in steps if step.get("place") == "current"), None)
    left = []
    if current:
        left = [
            _brief(task, current)
            for task in current.get("tasks") or []
            if task.get("status") != "done" and not task.get("optional")
        ]
    flagged = [_brief(task, step) for step in steps for task in step.get("tasks") or [] if task.get("status") == "flagged"]
    return {
        "current_step": current and {"id": current["id"], "label": current["label"], "gate": current.get("gate")},
        "steps": [
            {key: step.get(key) for key in ("id", "label", "phase", "place", "done", "total", "flagged")} for step in steps
        ],
        "left_in_current_step": left,
        "flagged": flagged,
    }


def find_step(summary, wanted):
    """A step by id ("monitor") or by its name, ignoring case ("Registry onboarding")."""
    wanted = str(wanted or "").strip().lower()
    steps = summary.get("steps") or []
    return next(
        (step for step in steps if wanted in (str(step.get("id", "")).lower(), str(step.get("label", "")).lower())),
        None,
    )


def describe(item, step=None):
    """What the tool answers for a stored journey item (None: nothing saved)."""
    if not item or "summary" not in item:
        return {
            "saved": False,
            "message": "This project's journey has not been saved yet: nobody has answered anything on its journey page.",
        }
    summary = json.loads(item["summary"]["S"])
    answer = {
        "saved": True,
        "saved_at": (item.get("updatedAt") or {}).get("S"),
        "version": int((item.get("version") or {}).get("N", "0")),
        "journey_definition": summary.get("definition"),
        "registry": summary.get("registry"),
        "methodology": summary.get("methodology"),
        "monitoring_periods_closed": summary.get("periods_closed", 0),
    }
    if step:
        found = find_step(summary, step)
        if not found:
            names = ", ".join(f"{s['id']} ({s['label']})" for s in summary.get("steps") or [])
            return {**answer, "error": f"No step called {step!r}. The steps are: {names}."}
        return {**answer, "step": found}
    return {**answer, **overview(summary)}


def status(event, caller):
    project_id = caller.get("project_id")
    if not project_id:
        return {"error": "Name the project (project_id) whose journey to read."}
    if project_id not in caller.get("project_ids", []):
        raise access.Denied("You have no access to that project.")
    item = dynamodb().get_item(
        TableName=os.environ["JOURNEY_TABLE"],
        Key={"pk": {"S": journey_key(caller["tenant_id"], project_id)}, "sk": {"S": "JOURNEY"}},
        ProjectionExpression="summary, version, updatedAt",
    ).get("Item")
    return describe(item, event.get("step"))


def handler(event, context):
    try:
        caller = access.require_caller(event)
        custom = getattr(getattr(context, "client_context", None), "custom", None) or {}
        name = str(custom.get("bedrockAgentCoreToolName", "status")).split("___")[-1]
        if name == "status":
            return status(event, caller)
        return {"error": f"Unknown tool {name}."}
    except access.Denied as error:
        return {"error": str(error)}
