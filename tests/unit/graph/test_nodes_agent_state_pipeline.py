"""
Tests for AGENT_STATE lifecycle in the turn-taking indicator feature.

Signal contract:
  thinking      → published at START of process_events (wraps full pipeline)
  done_thinking → published by the publish_done_thinking terminal node

Scope:
  These signals wrap the main reply path:
  process_events → ... → generate_response → publish_done_thinking
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import (
    generate_response,
    process_events,
    publish_done_thinking,
)
from app.core.graph.state import SimulationState

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class FakeLLM:
    def __init__(self, content="OK", should_fail=False):
        self.content = content
        self.should_fail = should_fail

    async def ainvoke(self, messages):
        if self.should_fail:
            raise RuntimeError("LLM failure")
        return AIMessage(self.content)


class FakeLLMClient:
    def __init__(self, content="OK", should_fail=False):
        self._llm_instance = FakeLLM(content, should_fail)

    @property
    def llm_instance(self):
        return self._llm_instance


def _make_state():
    return SimulationState(
        messages=[HumanMessage(content="hello")],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )


def _make_room():
    participant = MagicMock()
    participant.publish_data = AsyncMock()
    room = MagicMock()
    room.local_participant = participant
    room.name = "test-room"
    return room


def _make_scenario():
    language_config = type(
        "LanguageConfig",
        (),
        {"language_code": "en-US", "llm_config": None},
    )()
    return type(
        "Scenario",
        (),
        {
            "prompt_data": MagicMock(),
            "language_config": language_config,
            "behavior_instructions": [],
            "state_instructions": None,
            "name": "test-scenario",
        },
    )()


# ---------------------------------------------------------------------------
# process_events — thinking signal
# ---------------------------------------------------------------------------


class TestProcessEventsThinkingSignal:

    @pytest.mark.asyncio
    async def test_thinking_published_at_pipeline_entry(self):
        """thinking must be sent at the very start of process_events."""
        room = _make_room()
        config = {"configurable": {"room": room}}

        # Mocking internal helpers to isolate the signal logic
        with (
            patch(
                "app.core.graph.nodes._prepare_event_context",
                return_value=([], 0, 0, None, room),
            ),
            patch("app.core.graph.nodes._detect_events", return_value=([], [])),
        ):
            await process_events(_make_state(), config=config)

        calls = room.local_participant.publish_data.call_args_list
        assert len(calls) >= 1
        payload = json.loads(calls[0].args[0])
        assert payload == {"type": "AGENT_STATE", "state": "thinking"}

    @pytest.mark.asyncio
    async def test_thinking_payload_is_bytes_valid_json(self):
        """Verify the payload is byte-encoded JSON for the thinking signal."""
        room = _make_room()
        config = {"configurable": {"room": room}}

        with (
            patch(
                "app.core.graph.nodes._prepare_event_context",
                return_value=([], 0, 0, None, room),
            ),
            patch("app.core.graph.nodes._detect_events", return_value=([], [])),
        ):
            await process_events(_make_state(), config=config)

        raw = room.local_participant.publish_data.call_args[0][0]
        assert isinstance(raw, bytes)
        parsed = json.loads(raw)
        assert parsed["state"] == "thinking"


# ---------------------------------------------------------------------------
# generate_response — signal removal verification
# ---------------------------------------------------------------------------


class TestGenerateResponseNoSignals:

    @pytest.mark.asyncio
    async def test_generate_response_is_now_signal_free(self):
        """
        Verification: generate_response is now a pure LLM node.
        It must NOT publish 'thinking' or 'done_thinking'.
        """
        room = _make_room()
        config = {
            "configurable": {
                "room": room,
                "scenario": _make_scenario(),
                "llm_client": FakeLLMClient(),
            }
        }
        await generate_response(_make_state(), config=config)

        # Ensure zero publish_data calls were made in this node
        assert room.local_participant.publish_data.call_count == 0

    @pytest.mark.asyncio
    async def test_llm_response_returned_normally(self):
        """Smoke test: Node still functions normally without signals."""
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": FakeLLMClient(content="hello world"),
            }
        }
        result = await generate_response(_make_state(), config=config)
        assert result["messages"][0].content == "hello world"


# ---------------------------------------------------------------------------
# publish_done_thinking — done_thinking signal
# ---------------------------------------------------------------------------
class TestApplyVoiceExpressionsDoneThinkingSignal:

    @pytest.mark.asyncio
    async def test_done_thinking_published_after_voice_chain(self):
        """
        done_thinking must be published by the publish_done_thinking node.
        """
        room = _make_room()
        state = SimulationState(
            messages=[AIMessage(content="agent reply")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )

        config = {"configurable": {"room": room, "scenario": _make_scenario()}}

        await publish_done_thinking(state, config=config)

        # Verify the last call made to publish_data was done_thinking
        assert room.local_participant.publish_data.called
        last_call_args = room.local_participant.publish_data.call_args[0][0]
        payload = json.loads(last_call_args)
        assert payload == {"type": "AGENT_STATE", "state": "done_thinking"}

    @pytest.mark.asyncio
    async def test_done_thinking_fires_with_minimal_config(self):
        """
        done_thinking fires whenever a room is present, regardless of other config.
        """
        room = _make_room()
        # Only a room in config — no tts_client/llm_client needed by this node
        config = {"configurable": {"room": room}}

        await publish_done_thinking(_make_state(), config=config)

        assert room.local_participant.publish_data.called
        # Access positional arguments of the last call safely
        args, kwargs = room.local_participant.publish_data.call_args
        payload = json.loads(args[0])
        assert payload["state"] == "done_thinking"

    @pytest.mark.asyncio
    async def test_done_thinking_publish_failure_does_not_crash_node(self):
        """
        If publish_data raises an error, the node still completes.
        """
        room = _make_room()
        room.local_participant.publish_data.side_effect = RuntimeError("Network error")

        config = {"configurable": {"room": room}}
        # result should be returned normally even if the background publish fails
        result = await publish_done_thinking(_make_state(), config=config)
        assert result is not None

    @pytest.mark.asyncio
    async def test_done_thinking_no_room_does_not_crash(self):
        """No room in config does not cause a crash."""
        config = {"configurable": {"scenario": _make_scenario()}}
        result = await publish_done_thinking(_make_state(), config=config)
        assert result is not None
