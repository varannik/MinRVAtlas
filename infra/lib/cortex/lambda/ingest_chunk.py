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
import current
from bda import result_paths  # noqa: F401  (re-exported for tests)
from current import superseded  # noqa: F401  (re-exported for tests)

_s3 = None

# Fields of the admitted document that every passage inherits.
SCOPE_FIELDS = ("scope", "registry", "methodology", "edition", "tenant_id", "project_id", "doc_id")


class NoText(Exception):
    """BDA found no readable text. Step Functions catches this by name."""


class Superseded(Exception):
    """The document was removed or replaced while it was parsed. Step Functions catches this by name."""


def s3():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def _check_current(document):
    reason = current.superseded(document, current.metadata(s3(), document["key"]))
    if reason:
        raise Superseded(f"Passages for {document['key']} not written: {reason}.")


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
    try:
        found = clauses.passages(bda.elements(s3(), event["jobMetadata"]))
    except s3().exceptions.NoSuchKey:
        _check_current(document)  # a removal deletes the parsed output with the document
        raise
    if not found:
        raise NoText(f"No readable text in {document['key']}")
    _check_current(document)

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
