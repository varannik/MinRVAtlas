"""Step Functions task: take one project document out of Cortex.

Started by the web app (cortex-removal state machine) for a user who may add
to the project. Deletes the admitted document and its metadata file, the intake
copy, the rule passages and the Data Automation output; the index sync that
follows drops the passages from search. Both buckets with originals are
versioned, so the deleted file survives as a noncurrent version for its
retention period (and under Object Lock on prod) for audit.
"""

import json
import os

import access

_s3 = None


class NotAllowed(Exception):
    """The request is not for this project's own document. Step Functions catches this by name."""


def s3():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def check(event):
    """The key must be a project document of the tenant and project named in the request."""
    key = event.get("key")
    try:
        scope = access.key_scope(key)
    except ValueError as error:
        raise NotAllowed(str(error)) from None
    if (
        scope["scope"] != "project"
        or scope["tenant_id"] != event.get("tenant_id")
        or scope["project_id"] != event.get("project_id")
    ):
        raise NotAllowed(f"{key} is not a document of project {event.get('project_id')}.")
    return key


def _sidecar(bucket, key):
    try:
        body = s3().get_object(Bucket=bucket, Key=f"{key}.metadata.json")["Body"].read()
    except s3().exceptions.NoSuchKey:
        return {}
    return (json.loads(body) or {}).get("metadataAttributes") or {}


def _delete_prefix(bucket, prefix):
    deleted = 0
    for page in s3().get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
        if keys:
            s3().delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})
            deleted += len(keys)
    return deleted


def handler(event, _context):
    key = check(event)
    knowledge, intake, parsed = (
        os.environ["KNOWLEDGE_BUCKET"],
        os.environ["INTAKE_BUCKET"],
        os.environ["PARSED_BUCKET"],
    )
    doc_id = _sidecar(knowledge, key).get("doc_id")
    # Metadata first: a run still parsing this document checks it before writing passages.
    s3().delete_object(Bucket=knowledge, Key=f"{key}.metadata.json")
    s3().delete_object(Bucket=knowledge, Key=key)
    s3().delete_object(Bucket=intake, Key=key)
    passages = _delete_prefix(parsed, f"chunks/{key}/") // 2  # each passage has a .metadata.json
    if doc_id:
        _delete_prefix(parsed, f"bda/{doc_id}/")
    return {
        "key": key,
        "doc_id": doc_id,
        "tenant_id": event["tenant_id"],
        "project_id": event["project_id"],
        "requested_by": event.get("requested_by"),
        "passages_removed": passages,
    }
