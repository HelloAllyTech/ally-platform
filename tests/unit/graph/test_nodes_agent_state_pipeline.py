"""
Tests for AGENT_STATE lifecycle in the turn-taking indicator feature.

Signal contract:
  thinking      → published at START of process_events (wraps full pipeline)
  done_thinking → published by apply_voice_expressions (now a thin terminal node;
                  prosody was removed, so publishing this signal is all it does)

Scope:
  These signals wrap the main reply path:
  process_events → ... → generate_response → apply_voice_expressions
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import (
    process_events,
    generate_response,
    apply_voice_expressions,
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
        with patch("app.core.graph.nodes._prepare_event_context", 
                   return_value=([], 0, 0, None, room)), \
             patch("app.core.graph.nodes._detect_events", 
                   return_value=([], [])):
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
        
        with patch("app.core.graph.nodes._prepare_event_context", 
                   return_value=([], 0, 0, None, room)), \
             patch("app.core.graph.nodes._detect_events", 
                   return_value=([], [])):
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
# apply_voice_expressions — done_thinking signal
# ---------------------------------------------------------------------------
class TestApplyVoiceExpressionsDoneThinkingSignal:

    @pytest.mark.asyncio
    async def test_done_thinking_published_after_voice_chain(self):
        """
        done_thinking must be sent at the end of apply_voice_expressions.
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

        await apply_voice_expressions(state, config=config)

        # Verify the last call made to publish_data was done_thinking
        assert room.local_participant.publish_data.called
        last_call_args = room.local_participant.publish_data.call_args[0][0]
        payload = json.loads(last_call_args)
        assert payload == {"type": "AGENT_STATE", "state": "done_thinking"}

    @pytest.mark.asyncio
    async def test_done_thinking_fires_without_tts_or_llm(self):
        """
        done_thinking must fire even when no tts_client/llm_client is configured;
        the node no longer touches them (prosody removed).
        """
        room = _make_room()
        # Providing room but NOT providing tts_client/llm_client — the node
        # ignores them entirely now and simply publishes done_thinking.
        config = {"configurable": {"room": room}}

        await apply_voice_expressions(_make_state(), config=config)
        
        assert room.local_participant.publish_data.called
        # Access positional arguments of the last call safely
        args, kwargs = room.local_participant.publish_data.call_args
        payload = json.loads(args[0])
        assert payload["state"] == "done_thinking"

    @pytest.mark.asyncio
    async def test_done_thinking_publish_failure_does_not_crash_node(self):
        """
        If publish_data raises, _publish_done_thinking swallows it and the node
        still returns normally.
        """
        room = _make_room()
        room.local_participant.publish_data.side_effect = RuntimeError("Network error")

        config = {"configurable": {"room": room}}
        # result should be returned normally even if the background publish fails
        result = await apply_voice_expressions(_make_state(), config=config)
        assert result is not None

    @pytest.mark.asyncio
    async def test_done_thinking_no_room_does_not_crash(self):
        """No room in config does not cause a crash."""
        config = {"configurable": {"scenario": _make_scenario()}}
        result = await apply_voice_expressions(_make_state(), config=config)
        assert result is not None

    @pytest.mark.asyncio
    async def test_no_prosody_work_done(self):
        """
        Prosody is deprecated: the node must NOT call into the TTS client
        (no parameter generation / text enhancement) and must return an empty
        dict so the agent's reply text is left unchanged.
        """
        room = _make_room()
        tts_client = MagicMock()
        config = {"configurable": {"room": room, "tts_client": tts_client}}

        result = await apply_voice_expressions(_make_state(), config=config)

        assert result == {}
        tts_client.get_parameter_metadata.assert_not_called()
        tts_client.supports_text_enhancement.assert_not_called()
        tts_client._apply_parameters_dict.assert_not_called()