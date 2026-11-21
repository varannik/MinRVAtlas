"""Step Functions task: start moving a document to another pin, or to or from the whole organisation.

Started by the web app (cortex-move state machine), usually from Cortex's own
suggestion ("looks like registry rules: move to Protocols"). The admitted file is
copied into the intake bucket at its new key, with its SHA-256 and metadata, so
it goes through the same scan, admission, parsing and labelling as any upload.
The state machine then removes the document from its old place (ingest_remove).
"""

import os

from ownership import NotAllowed, move_target

_s3 = None


def s3():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def _exists(bucket, key):
    try:
        s3().head_object(Bucket=bucket, Key=key)
    except s3().exceptions.ClientError as error:
        if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise
    return True


def handler(event, _context):
    source, target = move_target(event)
    knowledge, intake = os.environ["KNOWLEDGE_BUCKET"], os.environ["INTAKE_BUCKET"]
    if not _exists(knowledge, source):
        raise NotAllowed(f"{source} is not in Cortex.")
    if _exists(knowledge, target) or _exists(intake, target):
        raise NotAllowed(f"There is already a document at {target}.")
    s3().copy_object(
        Bucket=intake,
        Key=target,
        CopySource={"Bucket": knowledge, "Key": source},
        MetadataDirective="COPY",
        # The copy gets the file's SHA-256 as its checksum, as a browser upload does.
        ChecksumAlgorithm="SHA256",
    )
    return {
        "key": source,
        "to_key": target,
        "tenant_id": event["tenant_id"],
        "project_id": event["project_id"],
        "requested_by": event.get("requested_by"),
    }
