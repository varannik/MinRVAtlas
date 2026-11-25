"""Lambda handlers for one quality run (the state machine in infra/lib/quality).

  plan   record the run, find the project's data, split stream days into batches
  fold   read a batch of days' raw readings: daily cells and intraday notes, to S3
  judge      every check and detector over the whole history; findings and the verdict
  summarise  optional, after the run is announced: Claude's summary for operators
  fail       mark the run failed, with a message safe to show

Each step gets {"run": {run_id, tenant_id, project_id, registry_slug, requested_by,
site_tz?}}. Ids are checked before any key is built from them.
"""

import hashlib
import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

from . import run_summary, store
from .data import Cell, Dataset, finish, fixed_from_attributes, from_mrv_json
from .intraday import fold_day
from .judge import judge as judge_findings
from .judge import summary

log = logging.getLogger()
log.setLevel(logging.INFO)

REGISTRY_SLUGS = ("isometric", "puro", "verra", "gold-standard")
DAY_KEY = re.compile(r"/dt=(\d{4}-\d{2}-\d{2})/observations\.csv$")
# Newest days a run reads, as the web's calculation does (lib/mrv/data/stream.ts).
MAX_DAYS = 1100
BATCH_DAYS = 31
READERS = 8
# Findings the QualityRunCompleted event carries for the graph (EventBridge takes 256 KB).
MAX_EVENT_FINDINGS = 200

_clients = {}


def client(name):
    if name not in _clients:
        import boto3

        _clients[name] = boto3.client(name)
    return _clients[name]


class NotAllowed(Exception):
    """The request names something this run may not touch."""


def checked_run(event):
    run = dict(event.get("run") or {})
    try:
        store.check_ids(run.get("tenant_id"), run.get("project_id"), run.get("run_id"))
    except ValueError as error:
        raise NotAllowed(str(error)) from None
    if run.get("registry_slug") not in REGISTRY_SLUGS:
        raise NotAllowed("registry_slug is not a registry")
    return run


def stream_prefix(run):
    return f"{run['tenant_id']}/{run['registry_slug']}/{run['project_id']}/"


def seeded_key(run):
    return f"mrv/{run['tenant_id']}/{run['registry_slug']}/{run['project_id']}.json"


def part_prefix(run):
    return f"runs/{run['tenant_id']}/{run['project_id']}/{run['run_id']}/"


def batches(listed):
    """The newest MAX_DAYS day files, in batches of BATCH_DAYS."""
    keys = [key for _, key, _ in sorted(listed)][-MAX_DAYS:]
    return [{"keys": keys[i : i + BATCH_DAYS]} for i in range(0, len(keys), BATCH_DAYS)]


def data_hash(listed):
    lines = "\n".join(f"{key}:{etag}" for _, key, etag in sorted(listed))
    return hashlib.sha256(lines.encode()).hexdigest()


# ── plan ────────────────────────────────────────────────────────────────────


def list_days(run):
    s3 = client("s3")
    listed = []
    token = None
    while True:
        page = s3.list_objects_v2(
            Bucket=os.environ["STREAM_BUCKET"], Prefix=stream_prefix(run), **({"ContinuationToken": token} if token else {})
        )
        for item in page.get("Contents", []):
            match = DAY_KEY.search(item["Key"])
            if match:
                listed.append((match.group(1), item["Key"], item.get("ETag", "").strip('"')))
        if not page.get("IsTruncated"):
            return listed
        token = page["NextContinuationToken"]


def seeded_etag(run):
    try:
        head = client("s3").head_object(Bucket=os.environ["ATLAS_BUCKET"], Key=seeded_key(run))
    except Exception as error:  # noqa: BLE001
        if _missing(error):
            return None
        raise
    return head.get("ETag", "").strip('"')


def _missing(error):
    code = str(getattr(error, "response", {}).get("Error", {}).get("Code", ""))
    return code in ("404", "NoSuchKey", "NotFound")


def plan(event, _context=None):
    run = checked_run(event)
    try:
        client("dynamodb").put_item(
            TableName=os.environ["QUALITY_TABLE"],
            Item=store.run_started(run),
            ConditionExpression="attribute_not_exists(sk)",
        )
    except Exception as error:  # noqa: BLE001 — a retried step finds its own record
        if "ConditionalCheckFailed" not in type(error).__name__ and "ConditionalCheckFailed" not in str(error):
            raise
    listed = list_days(run) if os.environ.get("STREAM_BUCKET") else []
    if listed:
        return {"source": "stream", "batches": batches(listed), "dataHash": data_hash(listed)}
    etag = seeded_etag(run) if os.environ.get("ATLAS_BUCKET") else None
    if etag:
        return {"source": "seeded", "batches": [], "dataHash": etag}
    return {"source": "none", "batches": [], "dataHash": ""}


# ── fold ────────────────────────────────────────────────────────────────────


def _read_day(key):
    body = client("s3").get_object(Bucket=os.environ["STREAM_BUCKET"], Key=key)["Body"].read()
    return key, body.decode("utf-8", errors="replace")


def fold(event, _context=None):
    run = checked_run(event)
    prefix = stream_prefix(run)
    keys = [key for key in event.get("keys") or [] if key.startswith(prefix) and ".." not in key and DAY_KEY.search(key)]
    days, notes = {}, []
    with ThreadPoolExecutor(max_workers=READERS) as pool:
        for key, body in pool.map(_read_day, keys):
            day = DAY_KEY.search(key).group(1)
            cells, day_notes = fold_day(day, body)
            merged = days.setdefault(day, {})
            merged.update(cells)
            notes.extend(day_notes)
    if not keys:
        return {"part": None}
    part = f"{part_prefix(run)}part-{DAY_KEY.search(keys[0]).group(1)}.json"
    client("s3").put_object(
        Bucket=os.environ["QUALITY_BUCKET"],
        Key=part,
        Body=json.dumps({"days": days, "notes": notes}, separators=(",", ":")).encode(),
        ContentType="application/json",
    )
    return {"part": part}


# ── judge ───────────────────────────────────────────────────────────────────


def _json_object(bucket, key):
    return json.loads(client("s3").get_object(Bucket=bucket, Key=key)["Body"].read())


def load_dataset(run, plan_result, parts):
    """The dataset and intraday notes the plan pointed at."""
    source = plan_result.get("source")
    if source == "seeded":
        return from_mrv_json(_json_object(os.environ["ATLAS_BUCKET"], seeded_key(run))), []
    dataset = Dataset(source=source or "none")
    notes = []
    if source != "stream":
        return dataset, notes
    own = part_prefix(run)
    for entry in parts or []:
        key = (entry or {}).get("part")
        if not key or not key.startswith(own):
            continue
        part = _json_object(os.environ["QUALITY_BUCKET"], key)
        for day, cells in part.get("days", {}).items():
            if cells:
                dataset.days.setdefault(day, {}).update({m: Cell.from_json(c) for m, c in cells.items()})
        notes.extend(part.get("notes", []))
    try:
        attributes = _json_object(os.environ["STREAM_BUCKET"], f"{stream_prefix(run)}attributes.json")
    except Exception as error:  # noqa: BLE001
        if not _missing(error):
            raise
        attributes = None
    dataset.fixed = fixed_from_attributes(attributes)
    return finish(dataset), notes


def reviews(run):
    dynamodb = client("dynamodb")
    items, start = [], None
    while True:
        page = dynamodb.query(
            TableName=os.environ["QUALITY_TABLE"],
            KeyConditionExpression="pk = :pk AND begins_with(sk, :review)",
            ExpressionAttributeValues={":pk": store.s(store.project_key(run["tenant_id"], run["project_id"])), ":review": store.s("REVIEW#")},
            **({"ExclusiveStartKey": start} if start else {}),
        )
        items.extend(page.get("Items", []))
        start = page.get("LastEvaluatedKey")
        if not start:
            return [store.review_from_item(item) for item in items]


def write_findings(run, findings):
    finished = time.time()
    requests = [{"PutRequest": {"Item": store.finding_item(run, f.to_json(), finished)}} for f in findings]
    dynamodb = client("dynamodb")
    table = os.environ["QUALITY_TABLE"]
    for i in range(0, len(requests), 25):
        pending = {table: requests[i : i + 25]}
        for attempt in range(6):
            left = dynamodb.batch_write_item(RequestItems=pending).get("UnprocessedItems") or {}
            if not left:
                break
            pending = left
            time.sleep(0.2 * 2**attempt)
        else:
            raise RuntimeError("DynamoDB kept refusing finding writes")


def judge(event, _context=None):
    run = checked_run(event)
    plan_result = event.get("plan") or {}
    dataset, notes = load_dataset(run, plan_result, event.get("parts"))
    findings = judge_findings(dataset, notes, reviews(run), site_tz=run.get("site_tz") or None)
    result = summary(dataset, findings)
    result["findings"] = len(findings)
    write_findings(run, findings)
    client("dynamodb").update_item(
        TableName=os.environ["QUALITY_TABLE"],
        Key={"pk": store.s(store.project_key(run["tenant_id"], run["project_id"])), "sk": store.s(f"RUN#{run['run_id']}")},
        UpdateExpression="SET #status = :status, finishedAt = :finished, #source = :source, dataHash = :hash, verdict = :verdict, #result = :result",
        ExpressionAttributeNames={"#status": "status", "#source": "source", "#result": "result"},
        ExpressionAttributeValues=store.run_finished(dataset.source, plan_result.get("dataHash"), result),
    )
    log.info(json.dumps({"quality_run": run["run_id"], "project": run["project_id"], "verdict": result["verdict"], "counts": result["counts"]}))
    # The event detail: the graph links each finding to its project, run and journey
    # task from it, so it carries ids and keys only, never the sentences.
    return {
        "tenant_id": run["tenant_id"],
        "project_id": run["project_id"],
        "run_id": run["run_id"],
        "finished_at": store.now(),
        "source": dataset.source,
        "verdict": result["verdict"],
        "counts": result["counts"],
        "range": result["range"],
        "findings_total": len(findings),
        "findings": [finding.link() for finding in findings[:MAX_EVENT_FINDINGS]],
    }


# ── summarise ───────────────────────────────────────────────────────────────


def run_findings(run):
    dynamodb = client("dynamodb")
    items, start = [], None
    while True:
        page = dynamodb.query(
            TableName=os.environ["QUALITY_TABLE"],
            KeyConditionExpression="pk = :pk AND begins_with(sk, :found)",
            ExpressionAttributeValues={
                ":pk": store.s(store.project_key(run["tenant_id"], run["project_id"])),
                ":found": store.s(f"FINDING#{run['run_id']}#"),
            },
            **({"ExclusiveStartKey": start} if start else {}),
        )
        items.extend(page.get("Items", []))
        start = page.get("LastEvaluatedKey")
        if not start:
            return [json.loads(item["finding"]["S"]) for item in items if item.get("finding", {}).get("S")]


_claude = None


def claude():
    global _claude
    if _claude is None:
        import anthropic  # the Anthropic SDK layer; only this step has it

        _claude = anthropic.AnthropicBedrock(aws_region=os.environ["AWS_REGION"], timeout=60.0, max_retries=2)
    return _claude


def ask_claude(asked):
    """Claude's answer to one run's facts, as a dict, and the tokens it used."""
    response = claude().messages.create(
        model=os.environ["SUMMARY_MODEL"],
        max_tokens=run_summary.MAX_TOKENS,
        system=run_summary.SYSTEM,
        messages=[{"role": "user", "content": run_summary.prompt(asked)}],
        output_config={"format": {"type": "json_schema", "schema": run_summary.SCHEMA}},
    )
    if response.stop_reason != "end_turn":
        raise ValueError(f"Claude stopped with {response.stop_reason}")
    text = next((block.text for block in response.content if block.type == "text"), None)
    if not text:
        raise ValueError("Claude gave no answer")
    return json.loads(text), response.usage


def summarise(event, _context=None):
    """Claude's summary of a finished run, on its run record. Never touches the verdict;
    when Claude cannot help, the record says the summary is unavailable."""
    run = checked_run(event)
    findings = run_findings(run)
    if not run_summary.needs_summary(findings):
        return {"summary": "none"}
    asked = run_summary.facts(str(event.get("verdict") or ""), findings)
    record = {"status": "unavailable", "model": os.environ["SUMMARY_MODEL"], "at": store.now()}
    try:
        answer, usage = ask_claude(asked)
        written = run_summary.checked(answer, {finding["id"] for finding in findings})
        if written:
            record = {**record, "status": "written", **written}
        log.info(json.dumps({"quality_summary": run["run_id"], "status": record["status"], "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens}))
    except Exception as error:  # noqa: BLE001 - the summary is optional; the run stands without it
        log.warning(json.dumps({"quality_summary": run["run_id"], "status": "unavailable", "error": type(error).__name__}))
    client("dynamodb").update_item(
        TableName=os.environ["QUALITY_TABLE"],
        Key={"pk": store.s(store.project_key(run["tenant_id"], run["project_id"])), "sk": store.s(f"RUN#{run['run_id']}")},
        UpdateExpression="SET #summary = :summary",
        ConditionExpression="attribute_exists(sk)",
        ExpressionAttributeNames={"#summary": "summary"},
        ExpressionAttributeValues={":summary": store.s(json.dumps(record, separators=(",", ":"), ensure_ascii=False))},
    )
    return {"summary": record["status"]}


# ── fail ────────────────────────────────────────────────────────────────────


def fail(event, _context=None):
    run = checked_run(event)
    cause = (event.get("error") or {}).get("Error") or "Error"
    client("dynamodb").update_item(
        TableName=os.environ["QUALITY_TABLE"],
        Key={"pk": store.s(store.project_key(run["tenant_id"], run["project_id"])), "sk": store.s(f"RUN#{run['run_id']}")},
        UpdateExpression="SET #status = :status, finishedAt = :finished, #error = :error",
        ExpressionAttributeNames={"#status": "status", "#error": "error"},
        ExpressionAttributeValues={":status": store.s("failed"), ":finished": store.s(store.now()), ":error": store.s(str(cause)[:200])},
    )
    return {"failed": True}
