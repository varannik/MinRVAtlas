import asyncio
import uuid

import pytest

from cortex_agent import main
from cortex_agent.identity import Caller, Unauthorized
from cortex_agent.settings import Settings

from .fakes import PASSAGE, FakeClaude, gateway_transport, message, text, thinking, tool_use

SETTINGS = Settings(
    region="eu-west-2",
    model_id="eu.anthropic.claude-sonnet-4-6",
    effort="medium",
    gateway_url="https://gateway.test/mcp",
    cognito_issuer="https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_test",
    cognito_client_ids=frozenset({"web-client"}),
    checkpoint_table=None,
    tenant_session_role_arn=None,
    checkpoint_ttl_days=30,
)
WHOAMI = {
    "tenant_id": "fourfourone",
    "tenant_name": "44.01",
    "role": "operator",
    "projects": [
        {"project_id": "fujairah-mineral", "name": "Fujairah", "registry": "puro",
         "methodology": "puro-geologically-stored-carbon", "edition": "2024-v5"},
    ],
}


class SignedIn:
    def __init__(self, error=None):
        self.error = error

    async def caller(self, headers):
        if self.error:
            raise self.error
        return Caller("fourfourone", "user-1", "operator", "user-token")


def cortex(claude, signed_in=None, tools=None, seen=None):
    agent = main.Cortex(SETTINGS)
    agent.verifier = signed_in or SignedIn()
    agent.model = claude
    agent.transport = gateway_transport(tools or {"tenancy___whoami": WHOAMI, "knowledge___search": {"results": [PASSAGE]}}, seen)
    return agent


def ask(agent, question="How long is the crediting period?", project="fujairah-mineral", conversation=None):
    payload = {"question": question, "project_id": project, "conversation_id": conversation or str(uuid.uuid4())}

    async def go():
        return [event async for event in agent.answer(payload, {"Authorization": "Bearer user-token"})]

    return asyncio.run(go())


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {"project_id": "p1", "conversation_id": str(uuid.uuid4())},
        {"question": "q" * 4001, "project_id": "p1", "conversation_id": str(uuid.uuid4())},
        {"question": "q", "project_id": "Not A Project", "conversation_id": str(uuid.uuid4())},
        {"question": "q", "project_id": "p1", "conversation_id": "short"},
    ],
)
def test_requests_that_cannot_be_answered_are_refused(payload):
    with pytest.raises(main.BadRequest):
        main.parse(payload)


def test_an_answer_streams_status_sources_text_then_done():
    seen = []
    claude = FakeClaude(
        message([thinking(), tool_use("crediting period")], "tool_use"),
        message([thinking(), text("15 years (Rule 2.2.2, Geologically_Stored_Carbon_2024_5.pdf, p. 13).")]),
    )
    events = ask(cortex(claude, seen=seen))
    assert [e["type"] for e in events] == ["status", "sources", "text", "text", "done"]
    assert events[-1] == {"type": "done", "turn": 1, "cited": ["doc-gsc#2.2.2#13"]}
    # The system prompt names the project and its methodology edition.
    assert "Fujairah" in claude.requests[0]["system"][0]["text"]
    assert "edition 2024-v5" in claude.requests[0]["system"][0]["text"]
    # Searches are for the project asked about, and the gateway sets the caller itself.
    search = next(entry for entry in seen if entry["body"].get("params", {}).get("name") == "knowledge___search")
    assert search["body"]["params"]["arguments"] == {"query": "crediting period", "project_id": "fujairah-mineral", "top_k": 6}


def test_a_conversation_continues_with_its_history():
    claude = FakeClaude(message([text("First answer.")]), message([text("Second answer.")]))
    agent = cortex(claude)
    conversation = str(uuid.uuid4())
    ask(agent, "first", conversation=conversation)
    events = ask(agent, "second", conversation=conversation)
    assert events[-1]["turn"] == 2
    history = claude.requests[1]["messages"]
    assert [m["role"] for m in history] == ["user", "assistant", "user"]
    assert history[0]["content"][0]["text"] == "first"


def test_a_follow_up_shows_what_it_cites_from_earlier_searches():
    claude = FakeClaude(
        message([tool_use("crediting period")], "tool_use"),
        message([text("15 years (Rule 2.2.2).")]),
        message([text("Once (Rule 2.2.2).")]),  # answered from the first search, no new one
    )
    agent = cortex(claude)
    conversation = str(uuid.uuid4())
    ask(agent, "How long is the crediting period?", conversation=conversation)
    events = ask(agent, "How many renewals?", conversation=conversation)
    assert [e["type"] for e in events] == ["text", "text", "sources", "done"]
    assert [s["id"] for s in events[2]["sources"]] == ["doc-gsc#2.2.2#13"]
    assert events[-1]["cited"] == ["doc-gsc#2.2.2#13"]


def test_a_project_without_a_grant_is_refused():
    events = ask(cortex(FakeClaude()), project="someone-elses")
    assert events == [{"type": "error", "message": "You do not have access to that project in Cortex."}]


def test_a_bad_sign_in_ends_with_its_message():
    events = ask(cortex(FakeClaude(), signed_in=SignedIn(Unauthorized("Your sign-in has expired. Sign in again."))))
    assert events == [{"type": "error", "message": "Your sign-in has expired. Sign in again."}]


def test_an_internal_failure_is_not_shown():
    class Broken:
        messages = None

    events = ask(cortex(Broken()))
    assert events[-1] == {"type": "error", "message": "Cortex could not answer. Try again."}


def test_a_refusal_says_so():
    events = ask(cortex(FakeClaude(message([], "refusal"))))
    assert events[-1] == {"type": "error", "message": "Cortex can't help with that request."}
