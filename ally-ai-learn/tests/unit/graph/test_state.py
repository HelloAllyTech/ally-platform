from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.events.base import BaseEvent, ChatMessage
from app.core.graph.state import (
    SimulationState,
    add_events_accumulator,
    add_new_events,
    add_permitted_events,
    add_scores,
    unique_by,
)


class FakeEvent(BaseEvent):
    should_detect: bool = False

    async def detect_event(self, conversations: list[ChatMessage]) -> bool:
        return self.should_detect


class TestStateReducers:
    def test_unique_by_stable_dedupe(self):
        items = [
            SimpleNamespace(id=1, v="a"),
            SimpleNamespace(id=2, v="b"),
            SimpleNamespace(id=1, v="c"),  # duplicate key=1 should be dropped
        ]
        out = unique_by(items, key=lambda x: x.id)
        assert [x.v for x in out] == ["a", "b"]

    def test_add_events_accumulator_left_biased(self):
        e1 = FakeEvent(event_id="e1")
        e1_dup = FakeEvent(event_id="e1")
        left = [("t1", e1)]
        right = [("t2", e1_dup)]
        res = add_events_accumulator(left, right)
        assert res == left  # left-biased unique merge

    def test_add_scores(self):
        # add scores will take the right value
        assert add_scores(2, 3) == 3

    def test_add_permitted_events_unique(self):
        e1 = FakeEvent(event_id="e1")
        e2 = FakeEvent(event_id="e2")
        e1_dup = FakeEvent(event_id="e1")
        res = add_permitted_events([e1, e2], [e1_dup])
        assert [e.event_id for e in res] == ["e1", "e2"]

    def test_add_new_events_returns_right(self):
        e1 = FakeEvent(event_id="e1")
        e2 = FakeEvent(event_id="e2")
        left = [e1]
        right = [e2]
        assert add_new_events(left, right) == [e2]


class TestSimulationStateModel:
    @pytest.mark.asyncio
    async def test_simulation_state_instantiation_and_usage(self):
        msgs = [HumanMessage(content="hi"), AIMessage(content="hello")]
        permitted = [FakeEvent(event_id="x1"), FakeEvent(event_id="x2")]
        acc = [(datetime.now(timezone.utc).isoformat(), FakeEvent(event_id="a"))]
        new = [FakeEvent(event_id="n1")]

        state = SimulationState(
            messages=msgs,
            permitted_events=permitted,
            events_accumulator=acc,
            new_events=new,
            current_score=10,
            branching_and_feedback_data=[],
        )

        # Sanity checks on fields
        assert state.current_score == 10
        assert len(state.messages) == 2
        assert len(state.permitted_events) == 2
        assert len(state.events_accumulator) == 1
        assert len(state.new_events) == 1
        assert len(state.branching_and_feedback_data) == 0
