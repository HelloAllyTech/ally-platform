"""Test internal logic of the `generate_chat_summary` function."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.branching_instructions.functions import chat_summary


def _raw():
    """Return a mock raw response with usage metadata."""
    return AIMessage(
        content="",
        usage_metadata={"input_tokens": 70, "output_tokens": 20, "total_tokens": 90},
    )


def _client(result):
    """Return a mock LLM client with a specified result."""
    structured = MagicMock()
    structured.ainvoke = AsyncMock(return_value=result)
    llm_instance = MagicMock(model_name="gpt-4o-mini")
    llm_instance.with_structured_output = MagicMock(return_value=structured)
    client = MagicMock(provider="openai")
    client.llm_instance = llm_instance
    return client


@pytest.fixture(autouse=True)
def _templates(monkeypatch):
    """Mock template loading."""
    monkeypatch.setattr(chat_summary, "load_template", lambda *_a, **_k: "SYS")


@pytest.mark.unit
async def test_generate_chat_summary_no_messages():
    """Verify fallback when no messages are provided."""
    summary = await chat_summary.generate_chat_summary(messages=[])
    assert summary == "No conversation history available."


@pytest.mark.unit
async def test_generate_chat_summary_non_dict_response():
    """Verify handling of responses where `include_raw` may be ignored."""
    # Simulate a response that is not a dict, but the expected parsed object
    parsed = MagicMock(summary="They talked about school.")
    client = _client(result=parsed)

    summary = await chat_summary.generate_chat_summary(
        messages=[HumanMessage(content="hi")], llm_client=client
    )

    assert summary == "They talked about school."


@pytest.mark.unit
async def test_generate_chat_summary_llm_exception(ai_usage_calls):
    """Verify fallback and token recording on general LLM failure."""
    # Simulate an exception during the LLM call
    structured = MagicMock()
    structured.ainvoke = AsyncMock(side_effect=Exception("LLM provider down"))
    llm_instance = MagicMock()
    llm_instance.with_structured_output = MagicMock(return_value=structured)
    client = MagicMock()
    client.llm_instance = llm_instance

    summary = await chat_summary.generate_chat_summary(
        messages=[HumanMessage(content="hi")], llm_client=client
    )

    assert summary == "Conversation summary currently unavailable."
    # No usage should be recorded if the call itself fails
    assert not ai_usage_calls
