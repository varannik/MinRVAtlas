"""Whether an ingestion run still speaks for its document.

A person can remove a document, or upload a new file at the same name, while an
earlier upload is still being parsed or labelled. That run must then write
nothing: no passages, no label. A removal also deletes the parsed output, so a
run that finds it gone checks here before calling it an error.
"""

import json
import os


def metadata(s3, key):
    """The admitted document's metadata as it is now; {} once it is removed."""
    try:
        body = s3.get_object(Bucket=os.environ["KNOWLEDGE_BUCKET"], Key=f"{key}.metadata.json")["Body"].read()
    except s3.exceptions.NoSuchKey:
        return {}
    return (json.loads(body) or {}).get("metadataAttributes") or {}


def superseded(document, current):
    """Why this run must not write for the document, or None.

    current is the admitted document's metadata as it is now. A removal deletes
    it; a newer upload of the same file rewrites it with a new doc_id. Either
    way this run's output would bring back what the user no longer has.
    """
    if not current:
        return "it was removed from Cortex while it was being read"
    if current.get("doc_id") != document.get("doc_id"):
        return "a newer upload of the same file replaced it while it was being read"
    return None
