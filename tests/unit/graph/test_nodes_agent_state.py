"""
Tests for AGENT_STATE thinking/done_thinking publish_data calls in generate_response.

These tests verify the LiveKit room signalling added to generate_response:
  - "thinking"      → published before the LLM call
  - "done_thinking" → published after the LLM response is received

All tests reuse the FakeLLM / FakeLLMClient helpers from the existing test file.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, call, patch
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import generate_response
from app.core.graph.state import SimulationState


# ---------------------------------------------------------------------------
# Shared helpers (mirrors the existing test file)
# ---------------------------------------------------------------------------

class FakeLLM:
    def __init__(self, content: str = "OK"):
        self._content = content

    async def ainvoke(self, messages):
        return AIMessage(self._content)


class FakeLLMClient:
    def __init__(self, content: str = "OK"):
        self._llm_instance = FakeLLM(content)

    @property
    def llm_instance(self):
        return self._llm_instance


def _make_minimal_state(**overrides):
    """Return a SimulationState with sensible defaults."""
    defaults = dict(
        messages=[HumanMessage(content="hello")],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )
    defaults.update(overrides)
    return SimulationState(**defaults)


def _make_scenario(language_code: str = "en-US"):
    """Return a lightweight scenario mock."""
    prompt_data = type(
        "PD",
        (),
        {
            "name": "Alex", "age": "30", "gender": "Male",
            "gender_identity": None, "sexual_orientation": None,
            "current_location": "NYC", "profession": None,
            "context": "Context", "session_behavior_guidelines": None,
            "life_history_summary": "History", "core_memories": None,
            "personality": None, "starting_state": None,
            "emotional_needs": None, "tone": None,
            "opening_statements": ["Hi"], "agent_goal": None,
            "custom_fields": None, "response_length": None,
            "agent_dialogues": None, "prompt": None,
            "previous_memory": None, "competency": None,
            "language_dialogue_samples": None,
            "knowledge_sources": None,
        },
    )()
    language_config = type(
        "LanguageConfig",
        (),
        {"language_code": language_code, "llm_config": None, "stt_config": None,
         "branching_llm_config": None},
    )()
    return type(
        "Scenario",
        (),
        {
            "prompt_data": prompt_data,
            "language_config": language_config,
            "behavior_instructions": [],
            "state_instructions": None,
            "name": "test-scenario",
        },
    )()


def _make_room(name: str = "test-room"):
    """Return a mock LiveKit room with an async publish_data."""
    local_participant = MagicMock()
    local_participant.publish_data = AsyncMock()
    room = MagicMock()
    room.name = name
    room.local_participant = local_participant
    return room


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestGenerateResponseThinkingStates:

    @pytest.mark.asyncio
    async def test_thinking_state_published_before_llm_call(self):
        """
        publish_data must be called with state='thinking' BEFORE the LLM
        responds.  We verify this by confirming publish_data was called at
        all, and that the first call carries the 'thinking' payload.
        """
        room = _make_room()
        llm_client = FakeLLMClient(content="response")
        state = _make_minimal_state()
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
                "room": room,
            }
        }

        await generate_response(state, config=config)

        calls = room.local_participant.publish_data.call_args_list
        assert len(calls) >= 1, "publish_data should have been called at least once"

        first_payload = json.loads(calls[0].kwargs.get("data") or calls[0].args[0])
        assert first_payload == {"type": "AGENT_STATE", "state": "thinking"}

    @pytest.mark.asyncio
    async def test_done_thinking_state_published_after_llm_call(self):
        """
        publish_data must be called with state='done_thinking' AFTER the LLM
        responds (i.e. it must be the last publish_data call).
        """
        room = _make_room()
        llm_client = FakeLLMClient(content="response")
        state = _make_minimal_state()
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
                "room": room,
            }
        }

        await generate_response(state, config=config)

        calls = room.local_participant.publish_data.call_args_list
        assert len(calls) >= 1

        last_payload = json.loads(calls[-1].kwargs.get("data") or calls[-1].args[0])
        assert last_payload == {"type": "AGENT_STATE", "state": "done_thinking"}

    @pytest.mark.asyncio
    async def test_thinking_then_done_thinking_ordering(self):
        """
        The full happy-path: exactly two publish_data calls in order —
        'thinking' first, 'done_thinking' last.
        """
        room = _make_room()
        llm_client = FakeLLMClient(content="response")
        state = _make_minimal_state()
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
                "room": room,
            }
        }

        await generate_response(state, config=config)

        calls = room.local_participant.publish_data.call_args_list
        assert len(calls) == 2, (
            f"Expected exactly 2 publish_data calls, got {len(calls)}"
        )

        payloads = [
            json.loads(c.kwargs.get("data") or c.args[0]) for c in calls
        ]
        assert payloads[0] == {"type": "AGENT_STATE", "state": "thinking"}
        assert payloads[1] == {"type": "AGENT_STATE", "state": "done_thinking"}

    @pytest.mark.asyncio
    async def test_publish_data_called_with_reliable_true(self):
        """
        Both publish_data calls must use reliable=True (LiveKit requirement).
        """
        room = _make_room()
        llm_client = FakeLLMClient(content="response")
        state = _make_minimal_state()
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
                "room": room,
            }
        }

        await generate_response(state, config=config)

        for c in room.local_participant.publish_data.call_args_list:
            assert c.kwargs.get("reliable") is True, (
                "publish_data must always be called with reliable=True"
            )

    @pytest.mark.asyncio
    async def test_no_room_in_config_does_not_publish(self):
        """
        When no room is present in config, publish_data must never be called
        (no AttributeError either).
        """
        llm_client = FakeLLMClient(content="response")
        state = _make_minimal_state()
        # No 'room' key at all
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
            }
        }

        # Should complete without error
        result = await generate_response(state, config=config)
        assert result["messages"][0].content == "response"

    @pytest.mark.asyncio
    async def test_room_is_none_does_not_publish(self):
        """
        room=None must be treated the same as no room — publish_data is
        never called.
        """
        llm_client = FakeLLMClient(content="response")
        state = _make_minimal_state()
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
                "room": None,  # Explicitly None
            }
        }

        result = await generate_response(state, config=config)
        assert result["messages"][0].content == "response"

    @pytest.mark.asyncio
    async def test_done_thinking_published_even_when_evaluation_logging_raises(
        self, monkeypatch
    ):
        """
        done_thinking must still be published even if the evaluation logger
        raises, because the publishing happens after the try/except block.
        """
        room = _make_room()
        llm_client = FakeLLMClient(content="response")
        state = _make_minimal_state()

        # Force evaluation logging path to raise
        monkeypatch.setattr(
            "app.core.graph.nodes.settings",
            type("S", (), {"EVALUATION_LOGGING_ENABLED": True,
                           "PROSDY_SKIP_ENABLED": False})(),
        )

        # Patch the evaluation_logger import inside generate_response
        import sys
        fake_eval_module = MagicMock()
        fake_eval_module.evaluation_logger.log_interaction.side_effect = RuntimeError(
            "logging failed"
        )
        sys.modules.setdefault(
            "app.evaluation.logger", fake_eval_module
        )

        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
                "room": room,
            }
        }

        result = await generate_response(state, config=config)

        # done_thinking must still have been sent
        calls = room.local_participant.publish_data.call_args_list
        last_payload = json.loads(calls[-1].kwargs.get("data") or calls[-1].args[0])
        assert last_payload == {"type": "AGENT_STATE", "state": "done_thinking"}
        assert result["messages"][0].content == "response"

    @pytest.mark.asyncio
    async def test_thinking_payload_is_valid_json_bytes(self):
        """
        The data passed to publish_data must be bytes (encoded JSON), not a
        raw dict or string.
        """
        room = _make_room()
        llm_client = FakeLLMClient(content="response")
        state = _make_minimal_state()
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
                "room": room,
            }
        }

        await generate_response(state, config=config)

        for c in room.local_participant.publish_data.call_args_list:
            raw = c.kwargs.get("data") or c.args[0]
            assert isinstance(raw, bytes), (
                f"publish_data data must be bytes, got {type(raw)}"
            )
            # Must be valid JSON
            parsed = json.loads(raw)
            assert "type" in parsed and "state" in parsed

    @pytest.mark.asyncio
    async def test_llm_response_returned_correctly_alongside_thinking_states(self):
        """
        Smoke-test: the AI message content is still returned correctly even
        when the room publish_data calls are in play.
        """
        room = _make_room()
        llm_client = FakeLLMClient(content="hello world")
        state = _make_minimal_state()
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": llm_client,
                "room": room,
            }
        }

        result = await generate_response(state, config=config)

        assert result["messages"][0].content == "hello world"
        assert result["next_instruction"] is None
        assert result["new_events"] == []