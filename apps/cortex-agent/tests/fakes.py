"""Stand-ins for Claude and the tool gateway, so the agent runs in tests without AWS."""

import json
from types import SimpleNamespace

import httpx
from anthropic.types import Message


def message(content: list[dict], stop_reason: str = "end_turn") -> Message:
    return Message.model_validate(
        {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "test-model",
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 100, "output_tokens": 20, "cache_read_input_tokens": 0},
        }
    )


def thinking() -> dict:
    return {"type": "thinking", "thinking": "", "signature": "sig-abc"}


def tool_use(query: str, tool_id: str = "toolu_1") -> dict:
    return {"type": "tool_use", "id": tool_id, "name": "search_knowledge", "input": {"query": query}}


def text(value: str) -> dict:
    return {"type": "text", "text": value}


class _Stream:
    def __init__(self, reply: Message):
        self.reply = reply

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        async def events():
            for block in self.reply.content:
                if block.type == "text":
                    # Two deltas, as a real stream would split it.
                    half = len(block.text) // 2
                    for part in (block.text[:half], block.text[half:]):
                        yield SimpleNamespace(type="text", text=part)

        return events()

    async def get_final_message(self) -> Message:
        return self.reply


class FakeClaude:
    """Answers each request with the next scripted reply and keeps the requests."""

    def __init__(self, *replies: Message):
        self.replies = list(replies)
        self.requests: list[dict] = []
        self.messages = self

    def stream(self, **request):
        self.requests.append(json.loads(json.dumps(request)))
        return _Stream(self.replies.pop(0))


class FakeKnowledge:
    def __init__(self, results: list[dict] | None = None, error: Exception | None = None):
        self.results = results or []
        self.error = error
        self.queries: list[str] = []

    async def search(self, query: str) -> list[dict]:
        self.queries.append(query)
        if self.error:
            raise self.error
        return self.results


PASSAGE = {
    "text": "2.2.2 The crediting period is 15 years. It may be renewed once.",
    "score": 0.71,
    "scope": "shared",
    "doc_id": "doc-gsc",
    "clause_ref": "2.2.2",
    "section": "2.2 Crediting period",
    "page": 13.0,
    "source": "s3://knowledge/shared/puro/gsc/2024-v5/Geologically_Stored_Carbon_2024_5.pdf",
}


def gateway_transport(tools: dict, seen: list | None = None) -> httpx.MockTransport:
    """An MCP gateway: initialize, the initialized notification, and tools/call answered from `tools`.

    `tools` maps a tool name to the payload its Lambda returns (or an RPC error dict under "rpc_error").
    """

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if seen is not None:
            seen.append({"body": body, "headers": dict(request.headers)})
        method = body.get("method")
        if method == "initialize":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": body["id"], "result": {"protocolVersion": "2025-06-18"}},
                headers={"mcp-session-id": "sess-1"},
            )
        if method == "notifications/initialized":
            return httpx.Response(202)
        name = body["params"]["name"]
        answer = tools[name]
        if "rpc_error" in answer:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "error": answer["rpc_error"]})
        result = {"content": [{"type": "text", "text": json.dumps(answer)}]}
        stream = f"event: message\ndata: {json.dumps({'jsonrpc': '2.0', 'id': body['id'], 'result': result})}\n\n"
        return httpx.Response(200, text=stream, headers={"content-type": "text/event-stream"})

    return httpx.MockTransport(handle)
