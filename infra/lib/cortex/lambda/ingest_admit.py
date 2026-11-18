"""Step Functions task: admit one scanned upload into the knowledge bucket.

Runs after GuardDuty reports NO_THREATS_FOUND on an intake object. The scope
(shared, tenant or project) comes from where the file was uploaded, and is
checked against the tenancy table. The document and its metadata file are
written by this function only; nobody else can write the knowledge bucket.
"""

import hashlib
import json
import os
import uuid

import access
import tenancy

_s3 = None


class Rejected(Exception):
    """The upload is not admitted. Step Functions catches this by name."""


def s3():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def handler(event, _context):
    bucket, key = event["bucket"], event["key"]
    try:
        scope = access.key_scope(key)
    except ValueError as error:
        raise Rejected(str(error)) from None

    if scope["scope"] != "shared":
        meta = tenancy.tenant(scope["tenant_id"]) or {}
        if meta.get("status") != "active":
            raise Rejected(f"Tenant {scope['tenant_id']} is not active on Cortex.")
        if scope["scope"] == "project" and not tenancy.project(scope["tenant_id"], scope["project_id"]):
            raise Rejected(f"Project {scope['project_id']} is not registered for tenant {scope['tenant_id']}.")

    version = {"VersionId": event["versionId"]} if event.get("versionId") else {}
    head = s3().head_object(Bucket=bucket, Key=key, ChecksumMode="ENABLED", **version)
    # Same file uploaded again gives the same doc id; a changed file gives a new one.
    fingerprint = head.get("ChecksumSHA256") or hashlib.sha256(head.get("ETag", "").encode()).hexdigest()
    doc_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"s3://{bucket}/{key}#{fingerprint}"))
    target = os.environ["KNOWLEDGE_BUCKET"]
    s3().copy_object(
        Bucket=target,
        Key=key,
        CopySource={"Bucket": bucket, "Key": key, **version},
        MetadataDirective="COPY",
    )
    metadata = {**scope, "doc_id": doc_id, "source_key": key, "checksum_sha256": head.get("ChecksumSHA256")}
    s3().put_object(
        Bucket=target,
        Key=f"{key}.metadata.json",
        Body=json.dumps(access.sidecar(metadata)).encode(),
        ContentType="application/json",
    )
    return {"doc_id": doc_id, "key": key, **scope}
