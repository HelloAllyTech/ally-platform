import pytest

from app.core.graph.nodes import send_events_to_core
from app.core.graph.state import SimulationState
from app.core.events.base import BaseEvent


class FakeRoom:
    def __init__(self, name: str = "room-xyz"):
        self.name = name


class AnyEvent(BaseEvent):
    async def detect_event(self, conversations):
        return False


class TestSendEventsToCore:
    @pytest.mark.asyncio
    async def test_send_events_to_core_sends_all_new_events(self, monkeypatch):
        # capture calls
        calls = {"create": [], "send_message": []}

        def fake_create(event_id: str, room_id: str):
            calls["create"].append((event_id, room_id))
            # return object with model_dump_json()
            class Msg:
                def model_dump_json(self):
                    return f"{{'event_id':'{event_id}','room_id':'{room_id}'}}"
            return Msg()

        async def fake_send_message(message_body: str):
            calls["send_message"].append(message_body)

        monkeypatch.setattr(
            "app.core.graph.nodes.CoreEventMessageType.create", fake_create
        )
        monkeypatch.setattr(
            "app.core.graph.nodes.msg_event_queue.send_message", fake_send_message
        )

        e1 = AnyEvent(event_id="e1")
        e2 = AnyEvent(event_id="e2")

        state = SimulationState(
            messages=[],
            permitted_events=[],
            events_accumulator=[],
            new_events=[e1, e2],
            current_score=0,
        )

        room = FakeRoom()
        config = {"configurable": {"room": room}}

        new_state = await send_events_to_core(state, config=config)

        # Assert message factory called per event
        assert calls["create"] == [("e1", room.name), ("e2", room.name)]
        # Assert messages sent twice
        assert len(calls["send_message"]) == 2
        # State is preserved/passthrough
        assert new_state is state or new_state.new_events == state.new_events
