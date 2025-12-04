from typing import List

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import process_events
from app.core.graph.state import SimulationState
from app.core.events.base import BaseEvent, ChatMessage


class DetectingEvent(BaseEvent):
    score: int | None = 1
    match_text: str | None = None

    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        # Detect if any message contains match_text
        if not self.match_text:
            return False
        return any(self.match_text in m.content for m in conversations)


class TestProcessEvents:
    @pytest.mark.asyncio
    async def test_process_events_detects_and_updates_state(self):
        msgs = [HumanMessage(content="Hello there"), AIMessage(content="I feel anxious")]
        e1 = DetectingEvent(event_id="e1", match_text="anxious", score=3)
        e2 = DetectingEvent(event_id="e2", match_text="nothing", score=5)

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1, e2],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_instructions=[],
        )

        new_state = await process_events(state, config=None)

        # e1 should be detected, e2 not
        assert [e.event_id for e in new_state["new_events"]] == ["e1"]
        assert new_state["current_score"] == 13  # 10 + 3
        assert len(new_state["events_accumulator"]) == 1
        ts, ev = new_state["events_accumulator"][0]
        assert ev.event_id == "e1"
        # timestamp is ISO-like string ending with 'Z'
        assert ts.endswith("Z")
        # branching_instructions key should not be present when empty
        assert "branching_instructions" not in new_state

    @pytest.mark.asyncio
    async def test_process_events_with_event_registry_integration(self):
        msgs = [HumanMessage(content="test message")]
        e1 = DetectingEvent(event_id="e1", match_text="test", score=5)

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_instructions=[],
        )

        # Mock EventRegistry
        class MockEventRegistry:
            async def handle_events(self, room, detected_event_ids):
                return [], 7, [("probe deeper", 3)]

        mock_room = object()
        config = {
            "configurable": {
                "event_registry": MockEventRegistry(),
                "room": mock_room,
            }
        }

        new_state = await process_events(state, config=config)

        # Base score (10) + detected event score (5) + additional score from registry (7)
        assert new_state["current_score"] == 22
        assert new_state["branching_instructions"] == [("probe deeper", 3)]
        assert len(new_state["new_events"]) == 1

    @pytest.mark.asyncio
    async def test_process_events_merges_time_based_branching_instructions(self):
        msgs = [HumanMessage(content="test")]
        e1 = DetectingEvent(event_id="e1", match_text="test", score=2)

        # State has existing time-based branching instructions
        state = SimulationState(
            messages=msgs,
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_instructions=[("time instruction", 5)],
        )

        class MockEventRegistry:
            async def handle_events(self, room, detected_event_ids):
                return [], 0, [("event instruction", 3)]

        config = {
            "configurable": {
                "event_registry": MockEventRegistry(),
                "room": object(),
            }
        }

        new_state = await process_events(state, config=config)

        # The node function only returns the NEW instructions from the event registry.
        # The merging happens via the graph reducer, which isn't tested here (unit test of the node).
        # So we expect only the new instruction in the return value.
        assert len(new_state["branching_instructions"]) == 1
        assert ("event instruction", 3) in new_state["branching_instructions"]
        # The existing "time instruction" is NOT in the return value of the node,
        # but would be preserved in the state by the reducer because we returned a dict.

    @pytest.mark.asyncio
    async def test_process_events_handles_no_detected_events(self):
        msgs = [HumanMessage(content="nothing special")]
        e1 = DetectingEvent(event_id="e1", match_text="special_keyword", score=3)

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_instructions=[],
        )

        new_state = await process_events(state, config=None)

        assert new_state["new_events"] == []
        assert new_state["current_score"] == 10  # No change
        assert len(new_state["events_accumulator"]) == 0
        # branching_instructions key should not be present when empty
        assert "branching_instructions" not in new_state

    @pytest.mark.asyncio
    async def test_process_events_handles_events_with_no_score(self):
        msgs = [HumanMessage(content="test")]
        e1 = DetectingEvent(event_id="e1", match_text="test", score=None)

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_instructions=[],
        )

        new_state = await process_events(state, config=None)

        assert len(new_state["new_events"]) == 1
        assert new_state["current_score"] == 10  # No score change
        # branching_instructions key should not be present when empty
        assert "branching_instructions" not in new_state

    @pytest.mark.asyncio
    async def test_process_events_multiple_detected_events(self):
        msgs = [HumanMessage(content="I feel anxious and stressed")]
        e1 = DetectingEvent(event_id="e1", match_text="anxious", score=3)
        e2 = DetectingEvent(event_id="e2", match_text="stressed", score=5)

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1, e2],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_instructions=[],
        )

        new_state = await process_events(state, config=None)

        assert len(new_state["new_events"]) == 2
        event_ids = {e.event_id for e in new_state["new_events"]}
        assert event_ids == {"e1", "e2"}
        assert new_state["current_score"] == 8  # 3 + 5
        # branching_instructions key should not be present when empty
        assert "branching_instructions" not in new_state

    @pytest.mark.asyncio
    async def test_process_events_with_empty_branching_instructions_from_registry(self):
        """Test that when registry returns empty branching instructions, the key is not included"""
        msgs = [HumanMessage(content="test")]
        e1 = DetectingEvent(event_id="e1", match_text="test", score=2)

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_instructions=[],
        )

        class MockEventRegistry:
            async def handle_events(self, room, detected_event_ids):
                return [], 5, []  # Empty branching instructions

        config = {
            "configurable": {
                "event_registry": MockEventRegistry(),
                "room": object(),
            }
        }

        new_state = await process_events(state, config=config)

        assert new_state["current_score"] == 7  # 0 + 2 + 5
        # branching_instructions key should not be present when empty
        assert "branching_instructions" not in new_state