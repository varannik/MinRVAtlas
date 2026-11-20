"""Cortex agent on Amazon Bedrock AgentCore Runtime.

POST /invocations with the signed-in user's access token and
  {"question": "...", "project_id": "fujairah-mineral", "conversation_id": "<uuid>"}
answers as a stream of server-sent events, each one JSON object:
  {"type": "status",  "text": "Searching: crediting period"}
  {"type": "sources", "query": "...", "sources": [{id, document, clause_ref, section, page, scope, excerpt}]}
  {"type": "text",    "text": "..."}                text of the answer as Claude writes it
  {"type": "reset"}                                  drop the text so far (it preceded a search)
  {"type": "done",    "turn": 3, "cited": ["<source id>", ...]}
  {"type": "error",   "message": "..."}              safe to show; the stream ends after it

The browser never calls this directly: the web app's /api/cortex/ask checks the
project grant and forwards the user's token (apps/web/src/lib/cortex/agent.server.ts).
"""

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass

import anthropic
import httpx
from bedrock_agentcore.runtime import BedrockAgentCoreApp

from . import knowledge, prompt
from .checkpoints import Checkpoints, thread_id
from .gateway import Gateway, ToolError
from .graph import MAX_TOOL_ROUNDS, answer_text, build, not_run, unanswered_tool_uses
from .identity import TENANT_ID, Unauthorized, Verifier
from .settings import Settings, load

log = logging.getLogger("cortex")
logging.basicConfig(level=logging.INFO, format="%(message)s")

MAX_QUESTION_CHARS = 4000
# A conversation grows with every search it ran; past this, start a new one.
MAX_TURNS = 30
CONVERSATION_ID = re.compile(r"^[A-Za-z0-9-]{16,64}$")


class BadRequest(Exception):
    """The request cannot be answered as sent. The message is safe to show."""


@dataclass(frozen=True)
class Ask:
    question: str
    project_id: str
    conversation_id: str


def parse(payload) -> Ask:
    if not isinstance(payload, dict):
        raise BadRequest("Send a question as JSON.")
    question = str(payload.get("question") or "").strip()
    project_id = str(payload.get("project_id") or "").strip()
    conversation_id = str(payload.get("conversation_id") or "").strip()
    if not question:
        raise BadRequest("Ask a question.")
    if len(question) > MAX_QUESTION_CHARS:
        raise BadRequest(f"Keep the question under {MAX_QUESTION_CHARS} characters.")
    if not TENANT_ID.match(project_id):
        raise BadRequest("Choose one of your projects.")
    if not CONVERSATION_ID.match(conversation_id):
        raise BadRequest("Start a new conversation.")
    return Ask(question, project_id, conversation_id)


class ProjectKnowledge:
    """knowledge___search for one project, as the signed-in user."""

    def __init__(self, gateway: Gateway, project_id: str):
        self.gateway = gateway
        self.project_id = project_id
        self.calls: list[dict] = []

    async def search(self, query: str) -> list[dict]:
        payload = await self.gateway.call_tool(
            "knowledge___search", {"query": query, "project_id": self.project_id, "top_k": knowledge.TOP_K}
        )
        results = payload.get("results") or []
        self.calls.append({"query": query, "results": len(results)})
        return results


def _model_failure(error: anthropic.APIError) -> str:
    if isinstance(error, anthropic.RateLimitError):
        return "Cortex is busy. Try again in a minute."
    if isinstance(error, (anthropic.PermissionDeniedError, anthropic.NotFoundError)):
        return "Cortex's language model is not available on this account yet."
    if isinstance(error, anthropic.APIConnectionError):
        return "Cortex could not reach its language model. Try again."
    return "Cortex could not finish the answer. Try again."


class Cortex:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.verifier = Verifier(settings.cognito_issuer, settings.cognito_client_ids)
        self.checkpoints = Checkpoints(settings)
        # Claude on Bedrock through the EU inference profile (bedrock-runtime), so prompts stay in the EU.
        self.model = anthropic.AsyncAnthropicBedrock(aws_region=settings.region, timeout=120.0, max_retries=2)
        self.transport: httpx.AsyncBaseTransport | None = None  # tests replace the network

    async def answer(self, payload, headers: dict[str, str]):
        started = time.time()
        record: dict = {"model": self.settings.model_id}
        try:
            ask = parse(payload)
            caller = await self.verifier.caller(headers)
            record.update(tenant_id=caller.tenant_id, sub=caller.sub, project_id=ask.project_id,
                          conversation=hashlib.sha256(ask.conversation_id.encode()).hexdigest()[:16])
            async with httpx.AsyncClient(transport=self.transport, timeout=httpx.Timeout(30.0, connect=10.0)) as http:
                gateway = Gateway(self.settings.gateway_url, caller.token, http)
                me = await gateway.call_tool("tenancy___whoami", {})
                project = next((p for p in me.get("projects") or [] if p.get("project_id") == ask.project_id), None)
                if project is None:
                    raise BadRequest("You do not have access to that project in Cortex.")

                tools = ProjectKnowledge(gateway, ask.project_id)
                saver = await self.checkpoints.saver(caller, ask.project_id)
                graph = build(self.model, self.settings.model_id, self.settings.effort, tools).compile(checkpointer=saver)
                config = {
                    "configurable": {"thread_id": thread_id(caller, ask.project_id, ask.conversation_id)},
                    # think + act per search, then the answer.
                    "recursion_limit": 2 * MAX_TOOL_ROUNDS + 4,
                }
                before = (await graph.aget_state(config)).values
                if (before.get("turns") or 0) >= MAX_TURNS:
                    raise BadRequest("This conversation is long. Start a new one to keep answers quick.")

                # A turn that failed half-way may have left tool calls without results; close them first.
                dangling = unanswered_tool_uses(before.get("messages") or [])
                content = [*not_run(dangling, "Not run: the request ended early."), {"type": "text", "text": ask.question}]
                start = {"messages": [{"role": "user", "content": content}], "turns": 1, "rounds": 0}
                if not before.get("system"):
                    start["system"] = prompt.system_prompt(project, me.get("tenant_name"))

                sources: dict[str, knowledge.Source] = {}
                usage = {"input": 0, "output": 0, "cache_read": 0}
                async for event in graph.astream(start, config, stream_mode="custom"):
                    if event.get("type") == "_usage":
                        for key in usage:
                            usage[key] += event.get(key, 0)
                        continue
                    if event.get("type") == "sources":
                        sources.update({source["id"]: source for source in event["sources"]})
                    yield event

                after = (await graph.aget_state(config)).values
                if after.get("stop_reason") == "refusal":
                    yield {"type": "error", "message": "Cortex can't help with that request."}
                    record.update(outcome="refusal")
                    return
                # Cite against everything the conversation has read: a follow-up may rely on earlier searches.
                known = {**(after.get("sources") or {}), **sources}
                cited = knowledge.cited(answer_text(after.get("messages") or []), list(known.values()))
                earlier = [known[source_id] for source_id in cited if source_id not in sources]
                if earlier:
                    yield {"type": "sources", "sources": earlier}
                record.update(outcome="answered", stop_reason=after.get("stop_reason"), searches=tools.calls,
                              read=list(sources), cited=cited, usage=usage)
                yield {"type": "done", "turn": after.get("turns") or 1, "cited": cited}
        except (BadRequest, Unauthorized, ToolError) as error:
            record.update(outcome="refused", reason=type(error).__name__)
            yield {"type": "error", "message": str(error)}
        except anthropic.APIError as error:
            record.update(outcome="model_error", reason=type(error).__name__, status=getattr(error, "status_code", None))
            yield {"type": "error", "message": _model_failure(error)}
        except Exception as error:  # never let an internal message reach the browser
            record.update(outcome="failed", reason=type(error).__name__)
            log.exception("cortex answer failed")
            yield {"type": "error", "message": "Cortex could not answer. Try again."}
        finally:
            # The answer log: what Cortex read and cited for whom, never the question or the answer text.
            record["seconds"] = round(time.time() - started, 2)
            log.info(json.dumps({"cortex_answer": record}, default=str))


app = BedrockAgentCoreApp()
_cortex: Cortex | None = None


def cortex() -> Cortex:
    global _cortex
    if _cortex is None:
        _cortex = Cortex(load())
    return _cortex


@app.entrypoint
async def invoke(payload, context):
    async for event in cortex().answer(payload, context.request_headers or {}):
        yield event


if __name__ == "__main__":
    app.run()
