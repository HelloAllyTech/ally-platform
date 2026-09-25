"""AI-cost: all three thinking-filler generation moments record their tokens.

The calls run from worker tasks, outside the graph run, so the room must come
from the caller; a missing room would make the spend unattributable.
"""

import types
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.livekit import predictive_filler


def _scenario():
    return types.SimpleNamespace(
        id=11,
        prompt_data=types.SimpleNamespace(name="Meera", language_label="Hindi"),
        language_config=types.SimpleNamespace(language_code="hi-IN"),
    )


def _client(result):
    structured = MagicMock()
    structured.ainvoke = AsyncMock(return_value=result)
    llm_instance = MagicMock(model_name="gpt-4o-mini")
    llm_instance.with_structured_output = MagicMock(return_value=structured)
    return types.SimpleNamespace(llm_instance=llm_instance, provider="openai")


def _result():
    return {
        "raw": AIMessage(
            content="",
            usage_metadata={
                "input_tokens": 200,
                "output_tokens": 40,
                "total_tokens": 240,
            },
        ),
        "parsed": predictive_filler._PredictiveFillers(
            fillers=[
                predictive_filler._FillerOption(text="hmm", type="hesitation"),
            ]
        ),
        "parsing_error": None,
    }


@pytest.fixture(autouse=True)
def _prompt(monkeypatch):
    monkeypatch.setattr(predictive_filler, "load_and_format", lambda *a, **k: "SYS")


@pytest.mark.unit
async def test_seed_records_thinking_filler(ai_usage_calls):
    client = _client(_result())

    out = await predictive_filler.generate_seed_fillers(
        client, _scenario(), 4, room_id="room-3"
    )

    assert out
    client.llm_instance.with_structured_output.assert_called_once_with(
        predictive_filler._PredictiveFillers, include_raw=True
    )
    assert len(ai_usage_calls) == 1
    call = ai_usage_calls[0]
    assert (call["room_id"], call["task"]) == ("room-3", "thinking_filler")
    assert (call["provider"], call["model"]) == ("openai", "gpt-4o-mini")
    assert call["scenario_id"] == 11
    assert call["total_tokens"] == 240


@pytest.mark.unit
async def test_exchange_records_thinking_filler(ai_usage_calls):
    await predictive_filler.generate_predictive_fillers(
        _client(_result()),
        _scenario(),
        [HumanMessage(content="hello"), AIMessage(content="hi")],
        4,
        room_id="room-3",
    )
    assert [(c["room_id"], c["task"]) for c in ai_usage_calls] == [
        ("room-3", "thinking_filler")
    ]


@pytest.mark.unit
async def test_in_turn_records_thinking_filler(ai_usage_calls):
    await predictive_filler.generate_in_turn_fillers(
        _client(_result()),
        _scenario(),
        [],
        "I was thinking that maybe",
        room_id="room-3",
        timeout_s=2.0,
    )
    assert [(c["room_id"], c["task"]) for c in ai_usage_calls] == [
        ("room-3", "thinking_filler")
    ]


@pytest.mark.unit
async def test_parse_failure_still_records(ai_usage_calls):
    result = _result()
    result["parsed"] = None
    out = await predictive_filler.generate_seed_fillers(
        _client(result), _scenario(), 4, room_id="room-3"
    )
    assert out == []
    assert [c["task"] for c in ai_usage_calls] == ["thinking_filler"]


@pytest.mark.unit
async def test_provider_ignoring_include_raw_still_works(ai_usage_calls):
    parsed = _result()["parsed"]
    out = await predictive_filler.generate_seed_fillers(
        _client(parsed), _scenario(), 4, room_id="room-3"
    )
    assert out
    assert ai_usage_calls == []
