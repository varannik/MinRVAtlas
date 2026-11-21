"""Step Functions task: record a person's decision on a document Cortex labelled.

Started by the web app (cortex-review state machine) for a user who may change
the document (an organisation admin for an organisation document):

  keep  the document is held (not MRV material, or the same as another one) and
        the person wants it searched: its passages move from held/ to chunks/,
        and the index sync that follows makes them searchable.
  stay  Claude suggested another place and the person keeps it where it is: the
        suggestion is not shown again while Claude suggests the same place.

Who decided and when is kept on the label, and the decision is announced on the
Cortex event bus.
"""

import json
import os
from datetime import datetime, timezone

import labels
from ownership import NotAllowed, check

ACTIONS = ("keep", "stay")
_s3 = None


def s3():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def _move_prefix(bucket, source, target):
    """Move every object under source to the same place under target; how many passages moved."""
    moved = 0
    for page in s3().get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=source):
        keys = [item["Key"] for item in page.get("Contents", [])]
        for key in keys:
            s3().copy_object(Bucket=bucket, Key=target + key[len(source) :], CopySource={"Bucket": bucket, "Key": key})
            moved += 0 if key.endswith(".metadata.json") else 1
        if keys:
            s3().delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True})
    return moved


def handler(event, _context):
    key = check(event)
    action = event.get("action")
    if action not in ACTIONS:
        raise NotAllowed(f"Unknown decision {action!r}.")
    bucket = os.environ["PARSED_BUCKET"]
    try:
        label = json.loads(s3().get_object(Bucket=bucket, Key=labels.label_key(key))["Body"].read())
    except s3().exceptions.NoSuchKey:
        raise NotAllowed(f"{key} has no label to decide on.") from None
    decision = {"by": event.get("requested_by"), "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}

    released = 0
    if action == "keep":
        if not labels.held_now(label):
            raise NotAllowed(f"{key} is not held.")
        released = _move_prefix(bucket, f"held/{key}/", f"chunks/{key}/")
        label["released"] = decision
    else:
        label["placement_kept"] = decision
    s3().put_object(Bucket=bucket, Key=labels.label_key(key), Body=json.dumps(label).encode(), ContentType="application/json")
    return {
        "key": key,
        "action": action,
        "tenant_id": event["tenant_id"],
        "project_id": event["project_id"],
        "requested_by": event.get("requested_by"),
        "passages_released": released,
        "reindex": action == "keep",
    }
