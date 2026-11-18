"""MCP tools in the `knowledge` target.

  search   hybrid search over shared, tenant and project knowledge

The tenant and project filter is built here from the caller block the gateway
interceptor wrote. The agent never gets bedrock:Retrieve itself, so this is the
only way to read the knowledge base.
"""

import json
import logging
import os
import time

import access
import tenancy

log = logging.getLogger()
log.setLevel(logging.INFO)

_client = None
MAX_RESULTS = 10
# The knowledge cluster pauses after 5 idle minutes and takes about 15 seconds to
# resume; Retrieve fails until then. Waits between attempts, in seconds.
RESUME_WAITS = (5, 5, 10, 10)


class Resuming(Exception):
    """The knowledge database is still waking up after the waits ran out."""


def resuming(error):
    """True for Bedrock's error while the Aurora vector store resumes from auto-pause."""
    code = (getattr(error, "response", None) or {}).get("Error", {}).get("Code")
    return code == "ValidationException" and "auto-paused" in str(error)


def retrieve(call, waits=RESUME_WAITS, sleep=time.sleep, **kwargs):
    """call(**kwargs), retried while the knowledge database resumes."""
    for wait in (*waits, None):
        try:
            return call(**kwargs)
        except Exception as error:  # botocore ClientError; not imported so tests need no AWS libs
            if not resuming(error):
                raise
            if wait is None:
                raise Resuming() from error
            log.info(json.dumps({"cortex_knowledge": "database_resuming", "retry_in_s": wait}))
            sleep(wait)


def client():
    global _client
    if _client is None:
        import boto3

        _client = boto3.client("bedrock-agent-runtime")
    return _client


def tool_name(context):
    custom = getattr(getattr(context, "client_context", None), "custom", None) or {}
    return str(custom.get("bedrockAgentCoreToolName", "")).split("___")[-1]


def search(event, caller):
    query = str(event.get("query") or "").strip()
    if not query:
        return {"error": "Ask a question to search for."}
    top_k = max(1, min(int(event.get("top_k") or 5), MAX_RESULTS))
    project = tenancy.project(caller["tenant_id"], caller.get("project_id"))
    try:
        response = retrieve(
            client().retrieve,
            knowledgeBaseId=os.environ["KNOWLEDGE_BASE_ID"],
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": top_k,
                    "overrideSearchType": "HYBRID",
                    "filter": access.retrieval_filter(caller, project),
                }
            },
        )
    except Resuming:
        return {"error": "The knowledge store is waking up after being idle. Try again in a few seconds."}
    results, dropped = [], 0
    for item in response.get("retrievalResults", []):
        metadata = item.get("metadata") or {}
        if not access.visible(caller, metadata):
            dropped += 1
            continue
        results.append(
            {
                "text": item.get("content", {}).get("text", ""),
                "score": item.get("score"),
                "scope": metadata.get("scope"),
                "doc_id": metadata.get("doc_id"),
                "clause_ref": metadata.get("clause_ref"),
                "source": item.get("location", {}).get("s3Location", {}).get("uri"),
            }
        )
    if dropped:
        # A filter let something through that the second check stopped. Alarm on this.
        log.error(json.dumps({"cortex_security": "result_outside_scope", "tenant_id": caller["tenant_id"], "dropped": dropped}))
    return {"results": results, "project_id": caller.get("project_id")}


def handler(event, context):
    try:
        caller = access.require_caller(event)
        name = tool_name(context) or "search"
        if name == "search":
            return search(event, caller)
        return {"error": f"Unknown tool {name}."}
    except access.Denied as error:
        return {"error": str(error)}
