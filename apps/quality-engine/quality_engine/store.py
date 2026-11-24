"""How runs, findings and decisions sit in the quality table.

One partition per project, so the web's tenant session (IAM leading keys
TENANT#<t>#PROJECT#<p>) reaches only its own project:

  RUN#<run id>                 the run: status, source, data hash, versions, verdict, counts
  FINDING#<run id>#<finding>   one worded finding of that run (JSON)
  REVIEW#<finding id>          a person's decision on a finding; outlives runs, since
                               the same problem in the same data keeps its id

Run ids start with the UTC start time, so RUN# items sort oldest first.
"""

import json
import re
from datetime import datetime, timezone

TENANT = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
PROJECT = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
RUN_ID = re.compile(r"^\d{8}T\d{6}Z-[a-z0-9]{4,12}$")
# Findings of a run are kept this long; the run record and decisions are kept.
FINDING_DAYS = 400


def project_key(tenant_id, project_id):
    return f"TENANT#{tenant_id}#PROJECT#{project_id}"


def check_ids(tenant_id, project_id, run_id=None):
    if not TENANT.match(tenant_id or ""):
        raise ValueError("tenant_id is not a tenant id")
    if not PROJECT.match(project_id or ""):
        raise ValueError("project_id is not a project id")
    if run_id is not None and not RUN_ID.match(run_id or ""):
        raise ValueError("run_id is not a run id")


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def s(value):
    return {"S": str(value)}


def n(value):
    return {"N": str(value)}


def run_started(run):
    return {
        "pk": s(project_key(run["tenant_id"], run["project_id"])),
        "sk": s(f"RUN#{run['run_id']}"),
        "runId": s(run["run_id"]),
        "status": s("running"),
        "startedAt": s(now()),
        "requestedBy": s(run.get("requested_by") or "system"),
        "registry": s(run.get("registry_slug") or ""),
    }


def run_finished(source, data_hash, result):
    """Attribute updates for a finished run (an UpdateItem SET expression's values)."""
    return {
        ":status": s("done"),
        ":finished": s(now()),
        ":source": s(source),
        ":hash": s(data_hash or ""),
        ":verdict": s(result["verdict"]),
        ":result": s(json.dumps(result, separators=(",", ":"))),
    }


def finding_item(run, finding_json, finished_epoch):
    return {
        "pk": s(project_key(run["tenant_id"], run["project_id"])),
        "sk": s(f"FINDING#{run['run_id']}#{finding_json['id']}"),
        "severity": s(finding_json["severity"]),
        "kind": s(finding_json["kind"]),
        "start": s(finding_json["start"]),
        "end": s(finding_json["end"]),
        "finding": s(json.dumps(finding_json, separators=(",", ":"), ensure_ascii=False)),
        "expiresAt": n(int(finished_epoch) + FINDING_DAYS * 86400),
    }


def review_from_item(item):
    """A decision item as the judge reads it."""
    raw = item.get("review", {}).get("S")
    review = json.loads(raw) if raw else {}
    review.setdefault("finding_id", item["sk"]["S"].split("#", 1)[1])
    return review
