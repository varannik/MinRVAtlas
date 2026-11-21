"""Reading Bedrock Data Automation output: the elements of one parsed document.

BDA writes a job_metadata.json that points at one result.json per segment; each
result holds the document's elements (text, tables, figures) with their pages.
"""

import json
from urllib.parse import urlparse


def split_uri(uri):
    parsed = urlparse(uri)
    return parsed.netloc, parsed.path.lstrip("/")


def read_json(s3, uri):
    bucket, key = split_uri(uri)
    return json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())


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


def elements(s3, job_metadata_uri):
    """Every element of the parsed document, segment by segment."""
    found = []
    for path in result_paths(read_json(s3, job_metadata_uri)):
        found.extend(read_json(s3, path).get("elements") or [])
    return found
