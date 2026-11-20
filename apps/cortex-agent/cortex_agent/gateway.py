"""The Cortex tool gateway (AgentCore Gateway, MCP over streamable HTTP).

The agent calls it with the signed-in user's own access token, so every tool
call carries the user's tenant: the gateway's interceptor checks the tenant and
any project grant against the tenancy table and writes the `caller` block the
tools trust. The agent never sets `caller` itself.

A small JSON-RPC client, the same exchange as infra/scripts/cortex-mcp.ts:
initialize, the initialized notification, then tools/call.
"""

import json

import httpx

PROTOCOL_VERSION = "2025-06-18"
DENIED_CODE = -32003  # access.DENIED_CODE in infra/lib/cortex/lambda/access.py


class ToolError(Exception):
    """A tool call that did not return a result. The message is safe to show the model and the user."""


def _rpc_body(response: httpx.Response) -> dict:
    """Streamable HTTP answers with JSON or a short event stream; take the last data line."""
    text = response.text
    if "text/event-stream" in response.headers.get("content-type", ""):
        lines = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
        text = next((line for line in reversed(lines) if line), "")
    try:
        body = json.loads(text) if text else {}
    except ValueError:
        raise ToolError("The tool gateway sent an unreadable reply.") from None
    return body if isinstance(body, dict) else {}


def tool_payload(result: dict) -> dict:
    """The JSON a Lambda tool returned, from an MCP tools/call result."""
    content = result.get("content") or []
    text = next((part.get("text") for part in content if isinstance(part, dict) and part.get("type") == "text"), None)
    if result.get("isError"):
        raise ToolError(text or "The tool failed.")
    if not text:
        raise ToolError("The tool returned nothing.")
    try:
        payload = json.loads(text)
    except ValueError:
        return {"text": text}
    if isinstance(payload, dict) and payload.get("error"):
        raise ToolError(str(payload["error"]))
    return payload if isinstance(payload, dict) else {"value": payload}


class Gateway:
    def __init__(self, url: str, token: str, http: httpx.AsyncClient):
        self.url = url
        self.token = token
        self.http = http
        self.session: str | None = None
        self.protocol_version: str | None = None
        self._next_id = 1

    async def call_tool(self, name: str, arguments: dict) -> dict:
        if self.protocol_version is None:
            await self._initialize()
        result = await self._request("tools/call", {"name": name, "arguments": arguments})
        return tool_payload(result)

    async def _initialize(self) -> None:
        result = await self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "minrv-cortex-agent", "version": "1.0.0"},
            },
        )
        self.protocol_version = str(result.get("protocolVersion") or PROTOCOL_VERSION)
        await self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    async def _request(self, method: str, params: dict) -> dict:
        request_id = self._next_id
        self._next_id += 1
        response = await self._post({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        body = _rpc_body(response)
        error = body.get("error")
        if isinstance(error, dict):
            if error.get("code") == DENIED_CODE:
                raise ToolError(str(error.get("message") or "Cortex refused this request."))
            raise ToolError(f"The tool gateway refused the call ({error.get('code')}).")
        if response.status_code >= 400:
            raise ToolError(f"The tool gateway answered {response.status_code}.")
        result = body.get("result")
        if not isinstance(result, dict):
            raise ToolError("The tool gateway sent no result.")
        return result

    async def _post(self, body: dict) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.protocol_version and body.get("method") != "initialize":
            headers["MCP-Protocol-Version"] = self.protocol_version
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        try:
            response = await self.http.post(self.url, json=body, headers=headers)
        except httpx.HTTPError:
            raise ToolError("The tool gateway could not be reached.") from None
        if response.status_code in (401, 403):
            raise ToolError("The tool gateway did not accept your sign-in. Sign in again.")
        session = response.headers.get("mcp-session-id")
        if session:
            self.session = session
        return response
