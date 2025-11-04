import asyncio
import types
import pytest

from app.core.constants import VisibilityType
from app.core.graph.nodes import send_events_to_ui
from app.core.graph.state import SimulationState
from app.core.events.base import BaseEvent


class FakeRoom:
    def __init__(self, name: str = "room-1"):
        self.name = name


class UIEvent(BaseEvent):
    async def detect_event(self, conversations):
        return False


@pytest.mark.asyncio
async def test_send_events_to_ui_only_active(monkeypatch):
    calls = {"send_event": []}

    # Monkeypatch EventProcessor to return a fabricated UI message type
    class FakeEventProcessor:
        @staticmethod
        def get_events_summary(events):
            return {"count": len(events)}

        @staticmethod
        def process_events_for_ui(events):
            return "UI_MSG_TYPE"  # sentinel returned to send_event

    monkeypatch.setattr("app.core.graph.nodes.EventProcessor", FakeEventProcessor)

    async def fake_send_event(ui_message_type, room):
        calls["send_event"].append((ui_message_type, room.name))

    monkeypatch.setattr("app.core.graph.nodes.send_event", fake_send_event)

    # Prepare state with ACTIVE and PASSIVE events
    active = UIEvent(event_id="a1", visibility_type=VisibilityType.ACTIVE)
    passive = UIEvent(event_id="p1", visibility_type=VisibilityType.PASSIVE)

    state = SimulationState(
        messages=[],
        permitted_events=[],
        events_accumulator=[],
        new_events=[active, passive],
        current_score=0,
    )

    room = FakeRoom()
    config = {"configurable": {"room": room}}

    new_state = await send_events_to_ui(state, config=config)

    # Only ACTIVE event triggers a single send with our sentinel value
    assert calls["send_event"] == [("UI_MSG_TYPE", room.name)]
    # State is passed through
    assert new_state is state or new_state.new_events == state.new_events


@pytest.mark.asyncio
async def test_send_events_to_ui_no_active_no_send(monkeypatch):
    calls = {"send_event": 0}

    class FakeEventProcessor:
        @staticmethod
        def get_events_summary(events):
            return {}

        @staticmethod
        def process_events_for_ui(events):
            return "ANY"  # would be used if active exist

    monkeypatch.setattr("app.core.graph.nodes.EventProcessor", FakeEventProcessor)

    async def fake_send_event(ui_message_type, room):
        calls["send_event"] += 1

    monkeypatch.setattr("app.core.graph.nodes.send_event", fake_send_event)

    passive = UIEvent(event_id="p1", visibility_type=VisibilityType.PASSIVE)

    state = SimulationState(
        messages=[],
        permitted_events=[],
        events_accumulator=[],
        new_events=[passive],
        current_score=0,
    )

    room = FakeRoom()
    config = {"configurable": {"room": room}}

    _ = await send_events_to_ui(state, config=config)

    assert calls["send_event"] == 0
