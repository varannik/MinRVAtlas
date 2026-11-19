"""Step Functions task: turn BDA output for one admitted document into rule passages.

Writes chunks/<source key>/<nnnn>.md and its .metadata.json to the parsed
bucket. The document's previous passages are removed first, so a re-uploaded
document replaces its passages instead of adding to them. Each passage carries
the document's scope (so the tenant filter still applies) plus clause_ref,
section and page for citations.
"""

import json
import os
from urllib.parse import urlparse

import access
import clauses

_s3 = None

# Fields of the admitted document that every passage inherits.
SCOPE_FIELDS = ("scope", "registry", "methodology", "edition", "tenant_id", "project_id", "doc_id")


class NoText(Exception):
    """BDA found no readable text. Step Functions catches this by name."""


def s3():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def _split_uri(uri):
    parsed = urlparse(uri)
    return parsed.netloc, parsed.path.lstrip("/")


def _read_json(uri):
    bucket, key = _split_uri(uri)
    return json.loads(s3().get_object(Bucket=bucket, Key=key)["Body"].read())


def result_paths(value):
    """Every standard_output_path in BDA's job_metadata.json, in order."""
    if isinstance(value, dict):
        for key, inner in value.items():
            if key == "standard_output_path" and isinstance(inner, str):
                yield inner
            else:
                yield from result_paths(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from result_paths(inner)


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


def handler(event, _context):
    document = event["document"]
    job = _read_json(event["jobMetadata"])
    elements = []
    for path in result_paths(job):
        elements.extend(_read_json(path).get("elements") or [])
    found = clauses.passages(elements)
    if not found:
        raise NoText(f"No readable text in {document['key']}")

    bucket = os.environ["PARSED_BUCKET"]
    prefix = f"chunks/{document['key']}/"
    _delete_prefix(bucket, prefix)
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
    return {"doc_id": document["doc_id"], "passages": len(found), "rules": len(rules)}
