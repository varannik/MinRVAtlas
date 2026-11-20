import asyncio

import httpx
import pytest

from cortex_agent.gateway import DENIED_CODE, Gateway, ToolError, tool_payload

from .fakes import gateway_transport


def call(tools, name, arguments, seen=None):
    async def run():
        async with httpx.AsyncClient(transport=gateway_transport(tools, seen)) as http:
            gateway = Gateway("https://gateway.test/mcp", "user-token", http)
            return await gateway.call_tool(name, arguments)

    return asyncio.run(run())


def test_a_tool_call_initializes_then_calls_as_the_user():
    seen = []
    payload = call({"knowledge___search": {"results": [{"text": "x"}]}}, "knowledge___search", {"query": "q"}, seen)
    assert payload == {"results": [{"text": "x"}]}
    assert [entry["body"]["method"] for entry in seen] == ["initialize", "notifications/initialized", "tools/call"]
    # The user's own token on every request, and the session the gateway gave back.
    assert all(entry["headers"]["authorization"] == "Bearer user-token" for entry in seen)
    assert seen[2]["headers"]["mcp-session-id"] == "sess-1"
    assert seen[2]["headers"]["mcp-protocol-version"] == "2025-06-18"


def test_an_access_refusal_is_passed_on_as_its_message():
    tools = {"knowledge___search": {"rpc_error": {"code": DENIED_CODE, "message": "You have no grant on that project."}}}
    with pytest.raises(ToolError, match="no grant"):
        call(tools, "knowledge___search", {"query": "q"})


def test_a_tool_error_is_raised():
    with pytest.raises(ToolError, match="waking up"):
        call({"knowledge___search": {"error": "The knowledge store is waking up."}}, "knowledge___search", {"query": "q"})


def test_tool_payload_reads_error_results():
    with pytest.raises(ToolError, match="boom"):
        tool_payload({"isError": True, "content": [{"type": "text", "text": "boom"}]})


def test_a_refused_token_reads_as_sign_in_again():
    async def run():
        transport = httpx.MockTransport(lambda request: httpx.Response(401))
        async with httpx.AsyncClient(transport=transport) as http:
            await Gateway("https://gateway.test/mcp", "old", http).call_tool("tenancy___whoami", {})

    with pytest.raises(ToolError, match="Sign in again"):
        asyncio.run(run())
