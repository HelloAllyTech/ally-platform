"""AI-cost: branching-instruction substitutions record their tokens.

Both run only inside the resolve_branching_instruction graph node, so the room
comes from the graph run's context var (``graph_room`` stands in for it).
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.branching_instructions.functions import chat_summary, llm_response


def _raw():
    return AIMessage(
        content="",
        usage_metadata={"input_tokens": 70, "output_tokens": 20, "total_tokens": 90},
    )


def _client(result):
    structured = MagicMock()
    structured.ainvoke = AsyncMock(return_value=result)
    llm_instance = MagicMock(model_name="gpt-4o-mini")
    llm_instance.with_structured_output = MagicMock(return_value=structured)
    client = MagicMock(provider="openai")
    client.llm_instance = llm_instance
    return client


@pytest.fixture(autouse=True)
def _templates(monkeypatch):
    monkeypatch.setattr(llm_response, "load_template", lambda *_a, **_k: "SYS")
    monkeypatch.setattr(chat_summary, "load_template", lambda *_a, **_k: "SYS")


@pytest.mark.unit
async def test_llm_response_records_branching_instruction(ai_usage_calls, graph_room):
    parsed = MagicMock(content="Exercise lifts mood.")
    client = _client({"raw": _raw(), "parsed": parsed, "parsing_error": None})

    out = await llm_response.generate_llm_response(
        "facts about exercise", llm_client=client
    )

    assert out == "Exercise lifts mood."
    _, kwargs = client.llm_instance.with_structured_output.call_args
    assert kwargs == {"include_raw": True}
    assert len(ai_usage_calls) == 1
    call = ai_usage_calls[0]
    assert (call["room_id"], call["task"]) == (graph_room, "branching_instruction")
    assert (call["provider"], call["model"]) == ("openai", "gpt-4o-mini")


@pytest.mark.unit
async def test_llm_response_parse_failure_records_then_raises(ai_usage_calls):
    client = _client({"raw": _raw(), "parsed": None, "parsing_error": "bad json"})

    with pytest.raises(ValueError):
        await llm_response.generate_llm_response("x", llm_client=client)

    assert [c["task"] for c in ai_usage_calls] == ["branching_instruction"]


@pytest.mark.unit
async def test_chat_summary_records_branching_chat_summary(ai_usage_calls, graph_room):
    parsed = MagicMock(summary="They talked about school.")
    client = _client({"raw": _raw(), "parsed": parsed, "parsing_error": None})

    out = await chat_summary.generate_chat_summary(
        [HumanMessage(content="hi"), AIMessage(content="hello")], llm_client=client
    )

    assert out == "They talked about school."
    assert [(c["room_id"], c["task"]) for c in ai_usage_calls] == [
        (graph_room, "branching_chat_summary")
    ]


@pytest.mark.unit
async def test_chat_summary_parse_failure_falls_back_but_records(ai_usage_calls):
    client = _client({"raw": _raw(), "parsed": None, "parsing_error": "bad"})

    out = await chat_summary.generate_chat_summary(
        [HumanMessage(content="hi")], llm_client=client
    )

    assert out == "Conversation summary currently unavailable."
    assert [c["task"] for c in ai_usage_calls] == ["branching_chat_summary"]
