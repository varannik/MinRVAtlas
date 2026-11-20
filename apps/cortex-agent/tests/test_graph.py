import asyncio

from langgraph.checkpoint.memory import InMemorySaver

from cortex_agent.gateway import ToolError
from cortex_agent.graph import MAX_TOOL_ROUNDS, answer_text, build, unanswered_tool_uses

from .fakes import PASSAGE, FakeClaude, FakeKnowledge, message, text, thinking, tool_use

CONFIG = {"configurable": {"thread_id": "fourfourone#fujairah-mineral#user-1#c1"}, "recursion_limit": 20}


def run_turn(claude, tools, question, saver, first=True):
    graph = build(claude, "eu.anthropic.claude-sonnet-4-6", "medium", tools).compile(checkpointer=saver)
    start = {"messages": [{"role": "user", "content": [text(question)]}], "turns": 1, "rounds": 0}
    if first:
        start["system"] = "SYSTEM"

    async def go():
        events = [event async for event in graph.astream(start, CONFIG, stream_mode="custom")]
        return events, (await graph.aget_state(CONFIG)).values

    return asyncio.run(go())


def test_claude_searches_then_answers_and_the_history_is_kept_whole():
    claude = FakeClaude(
        message([thinking(), tool_use("crediting period")], "tool_use"),
        message([thinking(), text("15 years (Rule 2.2.2).")]),
    )
    tools = FakeKnowledge([PASSAGE])
    events, state = run_turn(claude, tools, "How long is the crediting period?", InMemorySaver())

    shown = [event for event in events if event["type"] != "_usage"]
    assert [event["type"] for event in shown] == ["status", "sources", "text", "text"]
    assert shown[0]["text"] == "Searching: crediting period"
    assert tools.queries == ["crediting period"]
    assert answer_text(state["messages"]) == "15 years (Rule 2.2.2)."

    # user, assistant (search), user (result), assistant (answer); thinking blocks stored unchanged.
    roles = [m["role"] for m in state["messages"]]
    assert roles == ["user", "assistant", "user", "assistant"]
    assert state["messages"][1]["content"][0] == thinking()
    result = state["messages"][2]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "toolu_1"
    assert result["content"].startswith("[1] Rule 2.2.2")

    # The second request replays the first exactly, with a cache breakpoint only on the request copy.
    second = claude.requests[1]
    assert second["messages"][1]["content"][0] == thinking()
    assert second["messages"][-1]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in state["messages"][-2]["content"][-1]
    assert second["thinking"] == {"type": "adaptive"}
    assert second["output_config"] == {"effort": "medium"}
    assert "temperature" not in second


def test_the_system_prompt_is_kept_from_the_first_turn():
    saver = InMemorySaver()
    claude = FakeClaude(message([text("First.")]), message([text("Second.")]))
    run_turn(claude, FakeKnowledge(), "one", saver)
    _, state = run_turn(claude, FakeKnowledge(), "two", saver, first=False)
    assert claude.requests[1]["system"][0]["text"] == "SYSTEM"
    assert state["turns"] == 2
    assert [m["role"] for m in state["messages"]] == ["user", "assistant", "user", "assistant"]


def test_text_written_before_a_search_is_withdrawn():
    claude = FakeClaude(message([text("Let me check."), tool_use("q")], "tool_use"), message([text("Done.")]))
    events, _ = run_turn(claude, FakeKnowledge([PASSAGE]), "q", InMemorySaver())
    kinds = [event["type"] for event in events if event["type"] != "_usage"]
    assert kinds[:3] == ["text", "text", "reset"]


def test_after_the_last_search_round_claude_must_answer():
    replies = [message([tool_use(f"q{i}", f"toolu_{i}")], "tool_use") for i in range(MAX_TOOL_ROUNDS)]
    claude = FakeClaude(*replies, message([text("What I found.")]))
    run_turn(claude, FakeKnowledge([PASSAGE]), "q", InMemorySaver())
    assert [r["tool_choice"]["type"] for r in claude.requests] == ["auto"] * MAX_TOOL_ROUNDS + ["none"]


def test_a_search_failure_goes_back_to_claude_as_an_error_result():
    claude = FakeClaude(message([tool_use("q")], "tool_use"), message([text("The store is waking up.")]))
    _, state = run_turn(claude, FakeKnowledge(error=ToolError("waking up")), "q", InMemorySaver())
    result = state["messages"][2]["content"][0]
    assert result["is_error"] is True and result["content"] == "waking up"


def test_a_call_cut_off_by_max_tokens_is_closed_so_the_history_stays_valid():
    claude = FakeClaude(message([tool_use("q")], "max_tokens"))
    _, state = run_turn(claude, FakeKnowledge([PASSAGE]), "q", InMemorySaver())
    assert state["messages"][-1]["role"] == "user"
    assert state["messages"][-1]["content"][0]["is_error"] is True
    assert unanswered_tool_uses(state["messages"]) == []


def test_unanswered_tool_uses_finds_calls_left_open():
    messages = [{"role": "user", "content": [text("q")]}, {"role": "assistant", "content": [thinking(), tool_use("q")]}]
    assert unanswered_tool_uses(messages) == ["toolu_1"]
    assert unanswered_tool_uses(messages[:1]) == []
