"""The conversation graph: Claude thinks, Cortex tools act, until Claude answers.

    START -> think -> (tool calls?) -> act -> think -> ... -> END

State is the Messages API conversation itself, kept append-only: assistant
turns are stored exactly as Claude returned them (thinking blocks included) and
are never edited, because Claude's thinking blocks are only valid against the
unchanged history that produced them. LangGraph checkpoints the state after
every step, so a conversation continues on the next request.

Nodes report progress through LangGraph's custom stream: text as Claude writes
it, a status line per tool call, and the sources each search found.
"""

import asyncio
import json
import operator
from typing import Annotated, Any, Protocol, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from . import knowledge
from .gateway import ToolError
from .prompt import EVIDENCE_TOOL, JOURNEY_TOOL, SEARCH_ONLY

# Searches Claude may run for one question before it must answer.
MAX_TOOL_ROUNDS = 4
MAX_TOKENS = 16000


def _keep_first(current, new):
    """The system prompt and the tool list are set on the first turn and never replaced."""
    return current or new


def _add(current: int | None, new: int | None) -> int:
    return (current or 0) + (new or 0)


def _merge(current: dict | None, new: dict | None) -> dict:
    return {**(current or {}), **(new or {})}


class Conversation(TypedDict, total=False):
    system: Annotated[str, _keep_first]
    # The tools offered to Claude, as on the first turn (prompt.TOOLS then). A conversation
    # without them began before they were stored and keeps prompt.SEARCH_ONLY.
    tools: Annotated[list[dict], _keep_first]
    messages: Annotated[list[dict], operator.add]
    turns: Annotated[int, _add]
    # Every passage the conversation has read, by id, so a follow-up answered from
    # earlier searches can still show what it cites.
    sources: Annotated[dict[str, dict], _merge]
    # Per question: how many times Claude asked for tools, and why it last stopped.
    rounds: int
    stop_reason: str


class Knowledge(Protocol):
    async def search(self, query: str) -> list[dict]: ...

    async def journey(self, step: str) -> dict: ...

    async def evidence(self, task_id: str, document: str) -> dict: ...


def journey_text(result: dict) -> str:
    """A journey or evidence tool's answer for Claude, as compact JSON."""
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"))


def unanswered_tool_uses(messages: list[dict]) -> list[str]:
    """Tool calls in the last assistant turn that never got a result (a turn cut off mid-way)."""
    if not messages or messages[-1].get("role") != "assistant":
        return []
    return [block["id"] for block in messages[-1].get("content", []) if block.get("type") == "tool_use"]


def not_run(tool_use_ids: list[str], why: str) -> list[dict]:
    return [{"type": "tool_result", "tool_use_id": tid, "is_error": True, "content": why} for tid in tool_use_ids]


def _request_messages(messages: list[dict]) -> list[dict]:
    """The history for the request, with a cache breakpoint on its last block.

    The breakpoint is added to a copy: stored turns stay exactly as they were.
    """
    if not messages:
        return []
    last = dict(messages[-1])
    content = [dict(block) for block in last.get("content", [])]
    if content:
        content[-1]["cache_control"] = {"type": "ephemeral"}
    last["content"] = content
    return [*messages[:-1], last]


def build(model: Any, model_id: str, effort: str, tools: Knowledge) -> StateGraph:
    """The graph, ready to compile with a checkpointer.

    `model` is an Anthropic client (AsyncAnthropicBedrock in Cortex); tests pass a stand-in
    with the same `messages.stream` call.
    """

    async def think(state: Conversation) -> dict:
        write = get_stream_writer()
        rounds = state.get("rounds") or 0
        request = {
            "model": model_id,
            "max_tokens": MAX_TOKENS,
            "system": [{"type": "text", "text": state["system"], "cache_control": {"type": "ephemeral"}}],
            "tools": state.get("tools") or SEARCH_ONLY,
            # After MAX_TOOL_ROUNDS searches Claude answers with what it has.
            "tool_choice": {"type": "none"} if rounds >= MAX_TOOL_ROUNDS else {"type": "auto"},
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort},
            "messages": _request_messages(state["messages"]),
        }
        wrote_text = False
        async with model.messages.stream(**request) as stream:
            async for event in stream:
                if event.type == "text" and event.text:
                    wrote_text = True
                    write({"type": "text", "text": event.text})
            message = await stream.get_final_message()

        content = [block.to_dict() for block in message.content]
        uses = [block["id"] for block in content if block.get("type") == "tool_use"]
        usage = message.usage
        write(
            {
                "type": "_usage",
                "input": usage.input_tokens or 0,
                "output": usage.output_tokens or 0,
                "cache_read": getattr(usage, "cache_read_input_tokens", 0) or 0,
            }
        )
        update: dict = {"messages": [{"role": "assistant", "content": content}], "stop_reason": message.stop_reason}
        if message.stop_reason == "tool_use" and uses:
            if wrote_text:
                write({"type": "reset"})  # what was written before the search is not the answer
            update["rounds"] = rounds + 1
        elif uses:
            # Cut off (max_tokens) or refused mid-call: close the calls so the history stays valid.
            update["messages"].append({"role": "user", "content": not_run(uses, "Not run: the request was cut off.")})
        return update

    async def act(state: Conversation) -> dict:
        write = get_stream_writer()
        calls = [block for block in state["messages"][-1]["content"] if block.get("type") == "tool_use"]
        offered = {tool["name"] for tool in state.get("tools") or SEARCH_ONLY}

        async def journey(call: dict) -> dict:
            step = str((call.get("input") or {}).get("step") or "").strip()
            write({"type": "status", "text": f"Reading the project's journey: {step}" if step else "Reading the project's journey"})
            try:
                result = await tools.journey(step)
            except ToolError as error:
                return {"type": "tool_result", "tool_use_id": call["id"], "is_error": True, "content": str(error)}
            return {"type": "tool_result", "tool_use_id": call["id"], "content": journey_text(result)}

        async def evidence(call: dict) -> dict:
            given = call.get("input") or {}
            task_id = str(given.get("task_id") or "").strip()
            document = str(given.get("document") or "").strip()
            about = task_id or document
            write({"type": "status", "text": f"Following the evidence links: {about}" if about else "Following the evidence links"})
            try:
                result = await tools.evidence(task_id, document)
            except ToolError as error:
                return {"type": "tool_result", "tool_use_id": call["id"], "is_error": True, "content": str(error)}
            return {"type": "tool_result", "tool_use_id": call["id"], "content": journey_text(result)}

        async def run(call: dict, seen: dict[str, dict]) -> dict:
            if call.get("name") not in offered:
                return not_run([call["id"]], f"There is no tool called {call.get('name')}.")[0]
            if call.get("name") == JOURNEY_TOOL:
                return await journey(call)
            if call.get("name") == EVIDENCE_TOOL:
                return await evidence(call)
            query = str((call.get("input") or {}).get("query") or "").strip()
            if not query:
                return not_run([call["id"]], "Give a query to search for.")[0]
            write({"type": "status", "text": f"Searching: {query}"})
            try:
                found = knowledge.sources_from(await tools.search(query))
            except ToolError as error:
                return {"type": "tool_result", "tool_use_id": call["id"], "is_error": True, "content": str(error)}
            if found:
                write({"type": "sources", "query": query, "sources": [source for source, _ in found]})
                seen.update({source["id"]: dict(source) for source, _ in found})
            return {"type": "tool_result", "tool_use_id": call["id"], "content": knowledge.tool_text(query, found)}

        # All results go back in one message, in the order Claude asked.
        found: dict[str, dict] = {}
        results = await asyncio.gather(*(run(call, found) for call in calls))
        return {"messages": [{"role": "user", "content": list(results)}], "sources": found}

    def after_think(state: Conversation) -> str:
        return "act" if state.get("stop_reason") == "tool_use" else END

    graph = StateGraph(Conversation)
    graph.add_node("think", think)
    graph.add_node("act", act)
    graph.add_edge(START, "think")
    graph.add_conditional_edges("think", after_think, ["act", END])
    graph.add_edge("act", "think")
    return graph


def answer_text(messages: list[dict]) -> str:
    """The text of Claude's last turn."""
    for message in reversed(messages or []):
        if message.get("role") == "assistant":
            return "".join(block.get("text", "") for block in message.get("content", []) if block.get("type") == "text")
    return ""
