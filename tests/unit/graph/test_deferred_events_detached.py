"""Tests for the detached-task redesign of deferred (off-gate) event
detection (EVENTS_OFF_GATE_DEFER_DETECTION).

Regression context: process_deferred_events used to be a LangGraph node,
wired process_gating_events -> process_deferred_events -> send_event_feedback.
Confirmed in production that this still blocked resolve_branching_instruction/
generate_response every turn, because LangGraph schedules nodes in
"supersteps" with a hard barrier between them — process_deferred_events and
sync_events_and_behaviors_node landed in the same superstep, so the reply
(one superstep later) waited on deferred detection's full duration despite
depending only on the latter. Fixed by spawning deferred detection as a
genuinely detached asyncio task (via EventOrchestrator._spawn_background)
from inside process_gating_events, entirely outside the graph.
"""

from typing import List

import pytest
from langchain_core.messages import HumanMessage

from app.core.events.base import BaseEvent, ChatMessage
from app.core.graph.nodes import (
    _run_deferred_events,
    _send_deferred_ui_feedback,
    process_gating_events,
)
from app.core.graph.state import (
    BranchingAndFeedbackData,
    EventFeedback,
    SimulationState,
)


class DetectingEvent(BaseEvent):
    score: int | None = 1
    match_text: str | None = None

    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        if not self.match_text:
            return False
        return any(self.match_text in m.content for m in conversations)


class FakeRoom:
    def __init__(self):
        self.published = []

    class _LocalParticipant:
        def __init__(self, outer):
            self._outer = outer

        async def publish_data(self, data, **kwargs):
            self._outer.published.append((data, kwargs))

    @property
    def local_participant(self):
        return FakeRoom._LocalParticipant(self)


class FakeOrchestrator:
    """Implements exactly what _process_events_impl (via process_gating_events)
    and _run_deferred_events need — mirrors the MockEventOrchestrator pattern
    used elsewhere in this test suite, plus the new spawn/deferral surface."""

    def __init__(self, deferrable=None, deferred_feedback=None):
        self.deferrable_detection_event_ids = deferrable or set()
        self.spawned = []
        self._deferred_feedback = deferred_feedback or []
        self.orchestrate_deferred_calls = []

    async def orchestrate_events(self, room, detected_event_ids):
        return ([], 0, [])

    def get_last_occurred_at(self, event_id: str):
        return None

    def get_occurrence_count(self, event_id: str) -> int:
        return None

    def _spawn_background(self, coro, label):
        self.spawned.append((coro, label))

    async def orchestrate_deferred_events(self, detected_ids, room):
        self.orchestrate_deferred_calls.append((detected_ids, room))
        return self._deferred_feedback


def _feedback(emoji, message, show=True):
    return EventFeedback(emoji=emoji, message=message, show_feedback=show)


class TestProcessGatingEventsSpawnsDeferred:
    @pytest.mark.asyncio
    async def test_spawns_deferred_task_when_orchestrator_present(self):
        e1 = DetectingEvent(event_id="e1", match_text="gate")
        state = SimulationState(
            messages=[HumanMessage(content="gate this")],
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )
        orchestrator = FakeOrchestrator()
        config = {"configurable": {"event_orchestrator": orchestrator}}

        await process_gating_events(state, config)

        assert len(orchestrator.spawned) == 1
        assert orchestrator.spawned[0][1] == "process_deferred_events"
        # Not awaited in this test (only the spawn call itself is under test)
        # — close it explicitly so pytest doesn't warn about a dangling
        # never-awaited coroutine.
        orchestrator.spawned[0][0].close()

    @pytest.mark.asyncio
    async def test_no_spawn_when_orchestrator_absent(self):
        e1 = DetectingEvent(event_id="e1", match_text="gate")
        state = SimulationState(
            messages=[HumanMessage(content="gate this")],
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )

        # Must not raise even with no orchestrator/config at all.
        result = await process_gating_events(state, config=None)
        assert "new_events" in result

    @pytest.mark.asyncio
    async def test_spawned_coroutine_runs_only_deferrable_events(self):
        """End-to-end: the coroutine process_gating_events hands to
        _spawn_background, when actually awaited, detects only the
        deferrable subset and reports feedback via orchestrate_deferred_events
        — proving the split still works with detection genuinely detached."""
        gated = DetectingEvent(event_id="gated-1", match_text="anything")
        deferred = DetectingEvent(event_id="deferred-1", match_text="hello")
        state = SimulationState(
            messages=[HumanMessage(content="hello world")],
            permitted_events=[gated, deferred],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )
        feedback_stub = [
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=_feedback(":)", "nice"),
                score=4,
                event_id="deferred-1",
            )
        ]
        orchestrator = FakeOrchestrator(
            deferrable={"deferred-1"}, deferred_feedback=feedback_stub
        )
        room = FakeRoom()
        config = {"configurable": {"event_orchestrator": orchestrator, "room": room}}

        await process_gating_events(state, config)
        assert len(orchestrator.spawned) == 1

        # Actually run the detached coroutine (in the test it's just awaited
        # directly instead of via real background scheduling).
        await orchestrator.spawned[0][0]

        assert len(orchestrator.orchestrate_deferred_calls) == 1
        detected_ids, _ = orchestrator.orchestrate_deferred_calls[0]
        assert detected_ids == {"deferred-1"}
        # room.published[0] is process_gating_events' own "thinking" state
        # publish; the deferred task's UI feedback push is the one after it.
        assert len(room.published) == 2
        data_bytes, kwargs = room.published[-1]
        assert kwargs.get("topic") == "events"


class TestRunDeferredEvents:
    @pytest.mark.asyncio
    async def test_noop_when_no_deferrable_events(self):
        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )
        orchestrator = FakeOrchestrator(deferrable=set())
        # Must return None (not raise) and never call orchestrate_deferred_events.
        result = await _run_deferred_events(
            state, config=None, orchestrator=orchestrator
        )
        assert result is None
        assert orchestrator.orchestrate_deferred_calls == []

    @pytest.mark.asyncio
    async def test_noop_when_paused(self):
        class PausedClock:
            is_paused = True

        e1 = DetectingEvent(event_id="e1", match_text="hi")
        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )
        orchestrator = FakeOrchestrator(deferrable={"e1"})
        config = {"configurable": {"session_clock": PausedClock()}}

        await _run_deferred_events(state, config, orchestrator)
        assert orchestrator.orchestrate_deferred_calls == []

    @pytest.mark.asyncio
    async def test_noop_when_nothing_detected(self):
        e1 = DetectingEvent(event_id="e1", match_text="will-not-match-anything")
        state = SimulationState(
            messages=[HumanMessage(content="hello")],
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )
        orchestrator = FakeOrchestrator(deferrable={"e1"})
        room = FakeRoom()
        config = {"configurable": {"room": room, "event_orchestrator": orchestrator}}

        await _run_deferred_events(state, config, orchestrator)

        assert orchestrator.orchestrate_deferred_calls == []
        assert room.published == []

    @pytest.mark.asyncio
    async def test_detects_and_sends_ui_feedback(self):
        e1 = DetectingEvent(event_id="e1", match_text="hello")
        state = SimulationState(
            messages=[HumanMessage(content="hello world")],
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )
        feedback_stub = [
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=_feedback(":)", "well done"),
                score=2,
                event_id="e1",
            )
        ]
        orchestrator = FakeOrchestrator(
            deferrable={"e1"}, deferred_feedback=feedback_stub
        )
        room = FakeRoom()
        config = {"configurable": {"room": room, "event_orchestrator": orchestrator}}

        await _run_deferred_events(state, config, orchestrator)

        assert len(orchestrator.orchestrate_deferred_calls) == 1
        assert orchestrator.orchestrate_deferred_calls[0][0] == {"e1"}
        assert len(room.published) == 1


class TestSendDeferredUiFeedback:
    @pytest.mark.asyncio
    async def test_noop_when_room_is_none(self):
        feedback = [
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=_feedback(":)", "hi"),
                score=1,
                event_id="e1",
            )
        ]
        # Must not raise despite room=None.
        await _send_deferred_ui_feedback(feedback, room=None)

    @pytest.mark.asyncio
    async def test_noop_when_feedback_empty(self):
        room = FakeRoom()
        await _send_deferred_ui_feedback([], room)
        assert room.published == []

    @pytest.mark.asyncio
    async def test_noop_when_all_feedback_none(self):
        room = FakeRoom()
        feedback = [
            BranchingAndFeedbackData(
                branching_instruction=None, feedback=None, score=1, event_id="e1"
            )
        ]
        await _send_deferred_ui_feedback(feedback, room)
        assert room.published == []

    @pytest.mark.asyncio
    async def test_sums_score_and_selects_highest_abs_score_feedback(self):
        room = FakeRoom()
        feedback = [
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=_feedback(":)", "small"),
                score=2,
                event_id="e1",
            ),
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=_feedback(":(", "big"),
                score=-9,
                event_id="e2",
            ),
        ]

        await _send_deferred_ui_feedback(feedback, room)

        assert len(room.published) == 1
        data_bytes, kwargs = room.published[0]
        assert kwargs.get("topic") == "events"
        import json

        payload = json.loads(data_bytes.decode("utf-8"))
        assert payload["data"]["score"] == -7  # 2 + (-9)
        assert payload["data"]["message"] == "big"  # |-9| > |2|
        assert payload["data"]["detected_event_ids"] == ["e1", "e2"]
