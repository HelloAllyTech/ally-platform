"""
Tests for AGENT_STATE lifecycle — new two-node architecture.

Contract (post-refactor):
  thinking      → published at the START of process_events (pipeline entry)
  done_thinking → published at the END of send_event_feedback (pipeline exit)

generate_response no longer publishes either signal.

Scope note:
  These signals wrap the full counselor-turn pipeline:
    process_events → ... → send_event_feedback
  NOT just the reply LLM call.
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import (
    generate_response,
    process_events,
    send_event_feedback,
)
from app.core.graph.state import (
    BranchingAndFeedbackData,
    EventFeedback,
    SimulationState,
)


# ---------------------------------------------------------------------------
# Shared helpers
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


def _make_room(name="test-room"):
    participant = MagicMock()
    participant.publish_data = AsyncMock()
    room = MagicMock()
    room.local_participant = participant
    room.name = name
    return room


def _make_scenario(language_code="en-US"):
    language_config = type(
        "LanguageConfig",
        (),
        {"language_code": language_code, "llm_config": None, "branching_llm_config": None},
    )()
    return type(
        "Scenario",
        (),
        {
            "prompt_data": MagicMock(knowledge_sources=None),
            "language_config": language_config,
            "behavior_instructions": [],
            "state_instructions": None,
            "name": "test-scenario",
        },
    )()


def _make_minimal_state(**overrides):
    defaults = dict(
        messages=[HumanMessage(content="hello")],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
        non_branching_feedback_data=[],
        behavior_feedback_data=[],
        feedback_to_send=None,
    )
    defaults.update(overrides)
    return SimulationState(**defaults)


# ---------------------------------------------------------------------------
# SECTION 1 — process_events: thinking signal
# ---------------------------------------------------------------------------

class TestProcessEventsThinkingState:
    """
    process_events is the pipeline entry point.
    It must publish thinking before any detection work starts.
    """

    def _patched_config(self, room):
        """Config with room + all internal process_events helpers mocked out."""
        return {
            "configurable": {
                "room": room,
                "event_orchestrator": None,
                "embedding_client": None,
            }
        }

    @pytest.mark.asyncio
    async def test_thinking_published_at_pipeline_start(self, monkeypatch):
        """thinking must be the very first publish_data call in a turn."""
        room = _make_room()
        state = _make_minimal_state()

        with patch("app.core.graph.nodes._prepare_event_context") as mock_ctx, \
             patch("app.core.graph.nodes._detect_events") as mock_detect, \
             patch("app.core.graph.nodes._build_state_update_dict") as mock_build:

            mock_ctx.return_value = ([], 0.0, 0, None, room)
            mock_detect.return_value = ([], [])
            mock_build.return_value = {}

            await process_events(state, config=self._patched_config(room))

        calls = room.local_participant.publish_data.call_args_list
        assert len(calls) >= 1
        first = json.loads(calls[0].args[0])
        assert first == {"type": "AGENT_STATE", "state": "thinking"}

    @pytest.mark.asyncio
    async def test_thinking_payload_is_bytes(self, monkeypatch):
        room = _make_room()
        state = _make_minimal_state()

        with patch("app.core.graph.nodes._prepare_event_context") as mock_ctx, \
             patch("app.core.graph.nodes._detect_events") as mock_detect, \
             patch("app.core.graph.nodes._build_state_update_dict") as mock_build:

            mock_ctx.return_value = ([], 0.0, 0, None, room)
            mock_detect.return_value = ([], [])
            mock_build.return_value = {}

            await process_events(state, config=self._patched_config(room))

        raw = room.local_participant.publish_data.call_args_list[0].args[0]
        assert isinstance(raw, bytes), "publish_data data must be bytes"
        parsed = json.loads(raw)
        assert parsed["type"] == "AGENT_STATE"
        assert parsed["state"] == "thinking"

    @pytest.mark.asyncio
    async def test_thinking_published_with_reliable_true(self, monkeypatch):
        room = _make_room()
        state = _make_minimal_state()

        with patch("app.core.graph.nodes._prepare_event_context") as mock_ctx, \
             patch("app.core.graph.nodes._detect_events") as mock_detect, \
             patch("app.core.graph.nodes._build_state_update_dict") as mock_build:

            mock_ctx.return_value = ([], 0.0, 0, None, room)
            mock_detect.return_value = ([], [])
            mock_build.return_value = {}

            await process_events(state, config=self._patched_config(room))

        call = room.local_participant.publish_data.call_args_list[0]
        assert call.kwargs.get("reliable") is True

    @pytest.mark.asyncio
    async def test_no_room_in_config_completes_without_error(self, monkeypatch):
        """No room → no crash, pipeline still runs normally."""
        state = _make_minimal_state()
        config = {"configurable": {"event_orchestrator": None, "embedding_client": None}}

        with patch("app.core.graph.nodes._prepare_event_context") as mock_ctx, \
             patch("app.core.graph.nodes._detect_events") as mock_detect, \
             patch("app.core.graph.nodes._build_state_update_dict") as mock_build:

            mock_ctx.return_value = ([], 0.0, 0, None, None)
            mock_detect.return_value = ([], [])
            mock_build.return_value = {"new_events": [], "current_score": 0}

            result = await process_events(state, config=config)

        # No assertion on publish_data — there is no room mock to inspect.
        # The test validates the node completes and returns a dict.
        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_room_none_completes_without_error(self, monkeypatch):
        """room=None → no crash, pipeline still runs normally."""
        state = _make_minimal_state()
        config = {"configurable": {"room": None, "event_orchestrator": None, "embedding_client": None}}

        with patch("app.core.graph.nodes._prepare_event_context") as mock_ctx, \
             patch("app.core.graph.nodes._detect_events") as mock_detect, \
             patch("app.core.graph.nodes._build_state_update_dict") as mock_build:

            mock_ctx.return_value = ([], 0.0, 0, None, None)
            mock_detect.return_value = ([], [])
            mock_build.return_value = {"new_events": [], "current_score": 0}

            result = await process_events(state, config=config)

        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_publish_data_failure_does_not_crash_pipeline(self, monkeypatch):
        """If publish_data raises, the pipeline must still complete."""
        room = _make_room()
        room.local_participant.publish_data.side_effect = RuntimeError("LiveKit down")
        state = _make_minimal_state()

        with patch("app.core.graph.nodes._prepare_event_context") as mock_ctx, \
             patch("app.core.graph.nodes._detect_events") as mock_detect, \
             patch("app.core.graph.nodes._build_state_update_dict") as mock_build:

            mock_ctx.return_value = ([], 0.0, 0, None, room)
            mock_detect.return_value = ([], [])
            mock_build.return_value = {"new_events": [], "current_score": 0}

            # Must NOT raise
            result = await process_events(state, config=self._patched_config(room))

        assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# SECTION 2 — send_event_feedback: done_thinking signal
# ---------------------------------------------------------------------------

class TestSendEventFeedbackDoneThinkingState:
    """
    send_event_feedback is the pipeline exit point.
    It must publish done_thinking as the very last action before returning.
    """

    def _config(self, room):
        return {"configurable": {"room": room}}

    def _empty_state(self):
        return _make_minimal_state()

    @pytest.mark.asyncio
    async def test_done_thinking_published_at_pipeline_end(self):
        """done_thinking must be published at the end of send_event_feedback."""
        room = _make_room()
        state = self._empty_state()

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            await send_event_feedback(state, config=self._config(room))

        calls = room.local_participant.publish_data.call_args_list
        assert len(calls) >= 1
        last = json.loads(calls[-1].args[0])
        assert last == {"type": "AGENT_STATE", "state": "done_thinking"}

    @pytest.mark.asyncio
    async def test_done_thinking_payload_is_bytes(self):
        room = _make_room()
        state = self._empty_state()

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            await send_event_feedback(state, config=self._config(room))

        raw = room.local_participant.publish_data.call_args_list[-1].args[0]
        assert isinstance(raw, bytes)
        parsed = json.loads(raw)
        assert parsed["type"] == "AGENT_STATE"
        assert parsed["state"] == "done_thinking"

    @pytest.mark.asyncio
    async def test_done_thinking_published_with_reliable_true(self):
        room = _make_room()
        state = self._empty_state()

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            await send_event_feedback(state, config=self._config(room))

        last_call = room.local_participant.publish_data.call_args_list[-1]
        assert last_call.kwargs.get("reliable") is True

    @pytest.mark.asyncio
    async def test_done_thinking_published_even_when_no_events(self):
        """done_thinking fires regardless of whether there are events/behaviors."""
        room = _make_room()
        state = self._empty_state()  # no events, no behaviors

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            await send_event_feedback(state, config=self._config(room))

        calls = room.local_participant.publish_data.call_args_list
        payloads = [json.loads(c.args[0]) for c in calls]
        assert any(p["state"] == "done_thinking" for p in payloads)

    @pytest.mark.asyncio
    async def test_done_thinking_published_even_when_events_present(self):
        """done_thinking fires even when there is active event feedback to send."""
        room = _make_room()
        state = _make_minimal_state(
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji=":)", message="Good", show_feedback=True),
                    score=5,
                    event_id="e1",
                )
            ]
        )

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            await send_event_feedback(state, config=self._config(room))

        calls = room.local_participant.publish_data.call_args_list
        last = json.loads(calls[-1].args[0])
        assert last["state"] == "done_thinking"

    @pytest.mark.asyncio
    async def test_no_room_completes_without_error(self):
        """No room → done_thinking skipped, but node returns correctly."""
        state = self._empty_state()
        config = {"configurable": {}}

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            result = await send_event_feedback(state, config=config)

        assert isinstance(result, dict)
        assert result["branching_and_feedback_data"] is None

    @pytest.mark.asyncio
    async def test_room_none_completes_without_error(self):
        state = self._empty_state()
        config = {"configurable": {"room": None}}

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            result = await send_event_feedback(state, config=config)

        assert isinstance(result, dict)

    @pytest.mark.asyncio
    async def test_publish_data_failure_does_not_break_return_value(self):
        """If done_thinking publish_data raises, the node still returns its dict."""
        room = _make_room()
        room.local_participant.publish_data.side_effect = RuntimeError("LiveKit down")
        state = self._empty_state()

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            result = await send_event_feedback(state, config=self._config(room))

        assert isinstance(result, dict)
        assert result["branching_and_feedback_data"] is None
        assert result["feedback_to_send"] is None

    @pytest.mark.asyncio
    async def test_done_thinking_is_last_action_after_ui_send(self):
        """
        done_thinking must come AFTER send_event_to_ui, not before.
        Verify ordering by checking call count of send_event_to_ui vs publish_data.
        """
        room = _make_room()
        call_order = []

        async def fake_send_to_ui(msg, r):
            call_order.append("send_event_to_ui")

        async def fake_publish(data, reliable=False):
            payload = json.loads(data)
            call_order.append(payload["state"])

        room.local_participant.publish_data = AsyncMock(side_effect=fake_publish)

        state = _make_minimal_state(
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji=":)", message="Good", show_feedback=True),
                    score=5,
                    event_id="e1",
                )
            ]
        )

        with patch("app.core.graph.nodes.send_event_to_ui", side_effect=fake_send_to_ui), \
             patch("app.core.graph.nodes.msg_event_queue"):
            await send_event_feedback(state, config=self._config(room))

        assert call_order[-1] == "done_thinking", (
            f"done_thinking must be last, got order: {call_order}"
        )
        assert "send_event_to_ui" in call_order
        assert call_order.index("send_event_to_ui") < call_order.index("done_thinking")


# ---------------------------------------------------------------------------
# SECTION 3 — generate_response: must NOT send either signal anymore
# ---------------------------------------------------------------------------

class TestGenerateResponseNoLongerSendsSignals:
    """
    After the refactor, generate_response no longer owns the thinking signals.
    These moved to process_events (thinking) and send_event_feedback (done_thinking).

    Tests assert generate_response does NOT call publish_data at all.
    """

    def _config(self, room=None):
        cfg = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": FakeLLMClient(),
            }
        }
        if room is not None:
            cfg["configurable"]["room"] = room
        return cfg

    @pytest.mark.asyncio
    async def test_generate_response_does_not_publish_thinking(self):
        """generate_response must NOT publish thinking — that's process_events' job."""
        room = _make_room()
        state = _make_minimal_state()

        await generate_response(state, config=self._config(room))

        for call in room.local_participant.publish_data.call_args_list:
            payload = json.loads(call.args[0])
            assert payload.get("state") != "thinking", (
                "generate_response must not publish thinking (moved to process_events)"
            )

    @pytest.mark.asyncio
    async def test_generate_response_does_not_publish_done_thinking(self):
        """generate_response must NOT publish done_thinking — that's send_event_feedback's job."""
        room = _make_room()
        state = _make_minimal_state()

        await generate_response(state, config=self._config(room))

        for call in room.local_participant.publish_data.call_args_list:
            payload = json.loads(call.args[0])
            assert payload.get("state") != "done_thinking", (
                "generate_response must not publish done_thinking (moved to send_event_feedback)"
            )

    @pytest.mark.asyncio
    async def test_generate_response_makes_zero_publish_data_calls(self):
        """
        Strictest form: generate_response must make exactly 0 publish_data calls.
        This will fail immediately if anyone adds signals back here accidentally.
        """
        room = _make_room()
        state = _make_minimal_state()

        await generate_response(state, config=self._config(room))

        assert room.local_participant.publish_data.call_count == 0, (
            "generate_response must not call publish_data at all after refactor"
        )

    @pytest.mark.asyncio
    async def test_generate_response_still_returns_ai_message(self):
        """Smoke test: response generation still works after signal removal."""
        state = _make_minimal_state()

        result = await generate_response(state, config=self._config())

        assert len(result["messages"]) == 1
        assert isinstance(result["messages"][0], AIMessage)
        assert result["messages"][0].content == "OK"
        assert result["next_instruction"] is None
        assert result["new_events"] == []

    @pytest.mark.asyncio
    async def test_generate_response_without_room_still_works(self):
        """No room in config → generate_response completes normally."""
        state = _make_minimal_state()
        config = {
            "configurable": {
                "scenario": _make_scenario(),
                "llm_client": FakeLLMClient(content="no room response"),
            }
        }

        result = await generate_response(state, config=config)

        assert result["messages"][0].content == "no room response"

    @pytest.mark.asyncio
    async def test_generate_response_with_room_none_still_works(self):
        state = _make_minimal_state()

        result = await generate_response(state, config=self._config(room=None))

        assert result["messages"][0].content == "OK"


# ---------------------------------------------------------------------------
# SECTION 4 — Full pipeline symmetry (contract tests)
# ---------------------------------------------------------------------------

class TestPipelineSignalSymmetry:
    """
    High-level contract: thinking fires at entry, done_thinking fires at exit.
    Validates the intent without running the full graph.
    """

    @pytest.mark.asyncio
    async def test_thinking_fires_in_process_events_not_generate_response(self):
        """
        thinking signal belongs to process_events.
        generate_response should produce zero publish_data calls.
        """
        room_for_gr = _make_room()

        gr_config = {
            "configurable": {
                "room": room_for_gr,
                "scenario": _make_scenario(),
                "llm_client": FakeLLMClient(),
            }
        }
        state = _make_minimal_state()
        await generate_response(state, config=gr_config)

        # generate_response must have produced zero publish_data calls
        assert room_for_gr.local_participant.publish_data.call_count == 0

    @pytest.mark.asyncio
    async def test_done_thinking_fires_in_send_event_feedback_not_generate_response(self):
        """
        done_thinking signal belongs to send_event_feedback.
        generate_response must not publish it.
        """
        room = _make_room()
        state = _make_minimal_state()

        gr_config = {
            "configurable": {
                "room": room,
                "scenario": _make_scenario(),
                "llm_client": FakeLLMClient(),
            }
        }
        await generate_response(state, config=gr_config)

        # Zero publish_data calls from generate_response
        assert room.local_participant.publish_data.call_count == 0

        # done_thinking fires correctly from send_event_feedback
        sef_config = {"configurable": {"room": room}}

        with patch("app.core.graph.nodes.send_event_to_ui", new_callable=AsyncMock), \
             patch("app.core.graph.nodes.msg_event_queue"):
            await send_event_feedback(state, config=sef_config)

        calls = room.local_participant.publish_data.call_args_list
        assert len(calls) >= 1
        last = json.loads(calls[-1].args[0])
        assert last["state"] == "done_thinking"