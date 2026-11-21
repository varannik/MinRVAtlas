"""Step Functions task: turn BDA output for one admitted document into rule passages.

Writes chunks/<source key>/<nnnn>.md and its .metadata.json to the parsed
bucket. The document's previous passages are removed first, so a re-uploaded
document replaces its passages instead of adding to them. Each passage carries
the document's scope (so the tenant filter still applies) plus clause_ref,
section and page for citations.

A document the label step held (not MRV material, or the same document as one
its searchers already have) gets its passages under held/ instead. The index
reads chunks/ only, so search does not see them until someone keeps the
document (ingest_review.py moves them to chunks/).
"""

import json
import os

import access
import bda
import clauses
from bda import result_paths  # noqa: F401  (re-exported for tests)

_s3 = None

# Fields of the admitted document that every passage inherits.
SCOPE_FIELDS = ("scope", "registry", "methodology", "edition", "tenant_id", "project_id", "doc_id")


class NoText(Exception):
    """BDA found no readable text. Step Functions catches this by name."""


class Superseded(Exception):
    """The document was removed or replaced while it was parsed. Step Functions catches this by name."""


def superseded(document, current):
    """Why this run must not write passages, or None.

    current is the admitted document's metadata as it is now. A removal deletes
    it; a newer upload of the same file rewrites it with a new doc_id. Either
    way this run's passages would bring back what the user no longer has.
    """
    if not current:
        return "it was removed from Cortex while it was being parsed"
    if current.get("doc_id") != document.get("doc_id"):
        return "a newer upload of the same file replaced it while it was being parsed"
    return None


def s3():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def _current_metadata(key):
    try:
        body = s3().get_object(Bucket=os.environ["KNOWLEDGE_BUCKET"], Key=f"{key}.metadata.json")["Body"].read()
    except s3().exceptions.NoSuchKey:
        return {}
    return (json.loads(body) or {}).get("metadataAttributes") or {}


def _delete_prefix(bucket, prefix):
    pages = s3().get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix)
    for page in pages:
        keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
        if keys:
            s3().delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})


def passage_metadata(document, passage, number):
    metadata = {field: document.get(field) for field in SCOPE_FIELDS}
    metadata.update(
        source_key=document["key"],
        clause_ref=passage["clause_ref"],
        section=passage["section"],
        page=passage["page"],
        part=passage["part"],
        chunk=number,
    )
    return access.sidecar(metadata)


def passage_area(label):
    """Where passages go: chunks/ (searched) or held/ (kept out of search until someone decides)."""
    return "held" if (label or {}).get("held") else "chunks"


def handler(event, _context):
    document = event["document"]
    found = clauses.passages(bda.elements(s3(), event["jobMetadata"]))
    if not found:
        raise NoText(f"No readable text in {document['key']}")

    reason = superseded(document, _current_metadata(document["key"]))
    if reason:
        raise Superseded(f"Passages for {document['key']} not written: {reason}.")

    bucket = os.environ["PARSED_BUCKET"]
    area = passage_area(event.get("label"))
    # Both areas: an earlier upload of this file may have been searched or held.
    _delete_prefix(bucket, f"chunks/{document['key']}/")
    _delete_prefix(bucket, f"held/{document['key']}/")
    prefix = f"{area}/{document['key']}/"
    for number, passage in enumerate(found, 1):
        key = f"{prefix}{number:04d}.md"
        s3().put_object(Bucket=bucket, Key=key, Body=passage["text"].encode(), ContentType="text/markdown")
        s3().put_object(
            Bucket=bucket,
            Key=f"{key}.metadata.json",
            Body=json.dumps(passage_metadata(document, passage, number)).encode(),
            ContentType="application/json",
        )
    rules = {p["clause_ref"] for p in found if clauses.is_rule(p["clause_ref"])}
    return {"doc_id": document["doc_id"], "passages": len(found), "rules": len(rules), "held": area == "held"}
