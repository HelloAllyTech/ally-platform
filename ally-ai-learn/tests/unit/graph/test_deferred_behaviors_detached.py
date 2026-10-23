"""Tests for the detached-task redesign of behavior detection
(BEHAVIORS_DEFER_DETECTION).

Regression context: BEHAVIORS_OFF_GATE already routes detect_behaviors'
graph edge to send_event_feedback instead of sync_events_and_behaviors_node,
which keeps the SPOKEN REPLY off behavior detection's critical path. What it
doesn't solve: send_event_feedback has two incoming edges (detect_behaviors +
resolve_branching_instruction), and LangGraph waits for both before firing a
node with multiple incoming edges — the same fan-in rule behind the earlier
EVENTS_OFF_GATE_DEFER_DETECTION superstep bug. So the turn's UI/score push was
still held up by however long behavior classification took. Fixed the same
way: detect_behaviors spawns the real work as a genuinely detached asyncio
task (via EventOrchestrator._spawn_background) and returns empty immediately.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import HumanMessage

from app.core.config import settings
from app.core.graph.nodes import (
    _run_deferred_behaviors,
    _send_deferred_behavior_ui_feedback,
    detect_behaviors,
)
from app.core.graph.state import BehaviorInstructionFeedbackData, SimulationState
from app.core.scenario.simulation_instructions import SimulationBehaviorCategory


class FakeRoom:
    def __init__(self):
        self.published = []
        self.name = "test_room"

    class _LocalParticipant:
        def __init__(self, outer):
            self._outer = outer

        async def publish_data(self, data, **kwargs):
            self._outer.published.append((data, kwargs))

    @property
    def local_participant(self):
        return FakeRoom._LocalParticipant(self)


class FakeOrchestrator:
    def __init__(self):
        self.spawned = []

    def _spawn_background(self, coro, label):
        self.spawned.append((coro, label))


def _behavior_feedback(instruction_id="behavior-1", score=5):
    return BehaviorInstructionFeedbackData(
        behavior_instruction_id=instruction_id,
        score=score,
        category=SimulationBehaviorCategory.SHOULD_DO,
    )


def _base_state(messages=None):
    if messages is None:
        messages = [HumanMessage(content="hello")]
    return SimulationState(
        messages=messages,
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )


class TestDetectBehaviorsSpawnsDeferred:
    @pytest.mark.asyncio
    async def test_spawns_and_returns_empty_when_flag_on(self):
        state = _base_state()
        orchestrator = FakeOrchestrator()
        config = {"configurable": {"event_orchestrator": orchestrator}}

        with patch.object(settings, "BEHAVIORS_DEFER_DETECTION", True):
            result = await detect_behaviors(state, config)

        assert result == {"behavior_feedback_data": []}
        assert len(orchestrator.spawned) == 1
        assert orchestrator.spawned[0][1] == "process_deferred_behaviors"
        # Not awaited here — close it so pytest doesn't warn about a
        # dangling never-awaited coroutine.
        orchestrator.spawned[0][0].close()

    @pytest.mark.asyncio
    async def test_no_spawn_when_orchestrator_absent(self):
        state = _base_state()

        with patch.object(settings, "BEHAVIORS_DEFER_DETECTION", True):
            # Must not raise even with no orchestrator/config at all.
            result = await detect_behaviors(state, config=None)

        assert result == {"behavior_feedback_data": []}

    @pytest.mark.asyncio
    async def test_runs_synchronously_when_flag_off(self):
        """Regression: default (flag off) behavior is completely unchanged —
        no spawn, real detection happens inline."""
        state = _base_state()
        orchestrator = FakeOrchestrator()
        scenario = MagicMock()
        scenario.behavior_instructions = None  # simplest real path: no-op
        config = {
            "configurable": {"event_orchestrator": orchestrator, "scenario": scenario}
        }

        with patch.object(settings, "BEHAVIORS_DEFER_DETECTION", False):
            result = await detect_behaviors(state, config)

        assert result == {"behavior_feedback_data": []}
        assert orchestrator.spawned == []


class TestRunDeferredBehaviors:
    @pytest.mark.asyncio
    async def test_noop_when_paused(self):
        class PausedClock:
            is_paused = True

        state = _base_state()
        config = {"configurable": {"session_clock": PausedClock()}}

        with patch("app.core.graph.nodes._detect_behavior_instructions") as mock_detect:
            await _run_deferred_behaviors(state, config, orchestrator=MagicMock())

        mock_detect.assert_not_called()

    @pytest.mark.asyncio
    async def test_noop_when_no_behavior_instructions_configured(self):
        state = _base_state()
        scenario = MagicMock()
        scenario.behavior_instructions = None
        config = {"configurable": {"scenario": scenario}}

        with patch("app.core.graph.nodes._detect_behavior_instructions") as mock_detect:
            await _run_deferred_behaviors(state, config, orchestrator=MagicMock())

        mock_detect.assert_not_called()

    @pytest.mark.asyncio
    async def test_noop_when_no_messages(self):
        state = _base_state(messages=[])
        scenario = MagicMock()
        scenario.behavior_instructions = [MagicMock()]
        config = {"configurable": {"scenario": scenario}}

        with patch("app.core.graph.nodes._detect_behavior_instructions") as mock_detect:
            await _run_deferred_behaviors(state, config, orchestrator=MagicMock())

        mock_detect.assert_not_called()

    @pytest.mark.asyncio
    async def test_detects_scores_and_sends_independently(self):
        state = _base_state()
        scenario = MagicMock()
        scenario.behavior_instructions = [MagicMock()]
        scenario.prompt_data = None
        score_keeper = AsyncMock()
        score_keeper.behavior_score = 5
        room = FakeRoom()
        config = {
            "configurable": {
                "scenario": scenario,
                "score_keeper": score_keeper,
                "room": room,
            }
        }
        detected = [_behavior_feedback("behavior-1", score=5)]

        with (
            patch(
                "app.core.graph.nodes._detect_behavior_instructions",
                new=AsyncMock(return_value=detected),
            ),
            patch("app.core.graph.nodes.msg_event_queue.send_message") as mock_send_be,
        ):
            await _run_deferred_behaviors(state, config, orchestrator=MagicMock())

        score_keeper.add_behavior_score.assert_awaited_once_with(5)
        assert mock_send_be.called
        # Independent UI push — its own message, not merged into any
        # events-side feedback (there is none passed here at all).
        assert len(room.published) == 1
        import json

        data_bytes, kwargs = room.published[0]
        assert kwargs.get("topic") == "events"
        payload = json.loads(data_bytes.decode("utf-8"))
        assert payload["data"]["score"] == 5
        assert payload["data"]["detected_event_ids"] == ["behavior-1"]

    @pytest.mark.asyncio
    async def test_timeout_is_a_noop_not_a_crash(self):
        import asyncio

        state = _base_state()
        scenario = MagicMock()
        scenario.behavior_instructions = [MagicMock()]
        scenario.prompt_data = None
        config = {"configurable": {"scenario": scenario}}

        with patch(
            "app.core.graph.nodes._detect_behavior_instructions",
            new=AsyncMock(side_effect=asyncio.TimeoutError),
        ):
            # Must not raise.
            await _run_deferred_behaviors(state, config, orchestrator=MagicMock())


class TestSendDeferredBehaviorUiFeedback:
    @pytest.mark.asyncio
    async def test_noop_when_room_is_none(self):
        await _send_deferred_behavior_ui_feedback(
            [_behavior_feedback()], room=None
        )  # must not raise

    @pytest.mark.asyncio
    async def test_noop_when_empty(self):
        room = FakeRoom()
        await _send_deferred_behavior_ui_feedback([], room)
        assert room.published == []

    @pytest.mark.asyncio
    async def test_sums_scores_across_multiple_behaviors(self):
        room = FakeRoom()
        feedback = [
            _behavior_feedback("behavior-1", score=3),
            _behavior_feedback("behavior-2", score=-8),
        ]

        await _send_deferred_behavior_ui_feedback(feedback, room)

        assert len(room.published) == 1
        import json

        data_bytes, kwargs = room.published[0]
        payload = json.loads(data_bytes.decode("utf-8"))
        assert payload["data"]["score"] == -5  # 3 + (-8)
        assert payload["data"]["emoji"] is None
        assert payload["data"]["message"] == ""
        assert payload["data"]["detected_event_ids"] == ["behavior-1", "behavior-2"]
