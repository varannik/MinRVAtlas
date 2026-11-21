"""Step Functions task: label one parsed document before its passages are written.

Claude (through the EU inference profile, so the text stays in EU regions) reads
the document's opening pages and says what it is. The label goes to
labels/<document key>.json in the parsed bucket, where the web reads it to show
the title, suggest a better place and say why a document is held. The chunk task
then writes the passages to held/ instead of chunks/ when the document is held.

Labelling never blocks ingestion: if Claude cannot be reached or gives no usable
answer, the document is labelled unchecked and searched as before.
"""

import json
import logging
import os
from datetime import datetime, timezone

import bda
import labels
import tenancy

log = logging.getLogger()
log.setLevel(logging.INFO)

MAX_TOKENS = 1024
_s3 = None
_claude = None


def s3():
    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def claude():
    global _claude
    if _claude is None:
        import anthropic

        _claude = anthropic.AnthropicBedrock(aws_region=os.environ["AWS_REGION"], timeout=60.0, max_retries=2)
    return _claude


def classify(prompt_text):
    """Claude's label for one document, as a dict matching labels.SCHEMA, and the usage."""
    response = claude().messages.create(
        model=os.environ["LABEL_MODEL"],
        max_tokens=MAX_TOKENS,
        system=labels.SYSTEM,
        messages=[{"role": "user", "content": prompt_text}],
        output_config={"format": {"type": "json_schema", "schema": labels.SCHEMA}},
    )
    if response.stop_reason != "end_turn":
        raise labels.Unlabelled(f"Claude stopped with {response.stop_reason}.")
    text = next((block.text for block in response.content if block.type == "text"), None)
    if not text:
        raise labels.Unlabelled("Claude gave no answer.")
    return json.loads(text), response.usage


def _read_label(key):
    try:
        body = s3().get_object(Bucket=os.environ["PARSED_BUCKET"], Key=key)["Body"].read()
    except s3().exceptions.NoSuchKey:
        return None
    return json.loads(body)


def neighbours(place, project):
    """Labels of the other documents this one is searched with."""
    bucket = os.environ["PARSED_BUCKET"]
    found = []
    for prefix in labels.neighbour_prefixes(place):
        for page in s3().get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                key = labels.document_key(item["Key"])
                if key == place["key"]:
                    continue
                if prefix == "labels/shared/" and place["scope"] == "project" and not labels.searches_shared(project, key):
                    continue
                other = _read_label(item["Key"])
                if other:
                    found.append(other)
    return found


def handler(event, _context):
    document = event["document"]
    place = labels.place_of(document["key"])
    project = tenancy.project(place.get("tenant_id"), place.get("project_id")) if place["scope"] == "project" else None
    model = os.environ["LABEL_MODEL"]
    usage = None
    try:
        text, pages = labels.excerpt(bda.elements(s3(), event["jobMetadata"]))
        if not text:
            raise labels.Unlabelled("No readable text.")
        output, usage = classify(labels.prompt(place, project, text, pages))
        label = labels.label_from(output)
    except Exception as error:  # Bedrock refused or throttled, no text, an unusable answer: search it unlabelled
        log.error(json.dumps({"cortex_label": "unlabelled", "key": document["key"], "error": type(error).__name__}))
        label = {"checked": False, "error": type(error).__name__}

    previous = _read_label(labels.label_key(document["key"]))
    others = neighbours(place, project) if label["checked"] else []
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    record = labels.record(document, place, label, previous, others, model, now)
    s3().put_object(
        Bucket=os.environ["PARSED_BUCKET"],
        Key=labels.label_key(document["key"]),
        Body=json.dumps(record).encode(),
        ContentType="application/json",
    )
    held = record["held"] if labels.held_now(record) else None
    log.info(
        json.dumps(
            {
                "cortex_label": "labelled" if label["checked"] else "unchecked",
                "key": document["key"],
                "kind": label.get("kind"),
                "pin": label.get("pin"),
                "placed_on": place.get("pin"),
                "held": held,
                "input_tokens": getattr(usage, "input_tokens", None),
                "output_tokens": getattr(usage, "output_tokens", None),
            }
        )
    )
    return {"checked": label["checked"], "kind": label.get("kind"), "held": held}
