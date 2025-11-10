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

        # Updated fake CoreEventMessageType.create to match new signature
        def fake_create(room_id: str, chat_message=None, event_data=None):
            calls["create"].append((event_data.event_id, room_id))
            # return object with model_dump_json() method
            class Msg:
                def model_dump_json(self):
                    return f"{{'event_id': '{event_data.event_id}', 'room_id': '{room_id}'}}"
            return Msg()

        # Fake async send_message to capture payloads
        async def fake_send_message(message_body: str):
            calls["send_message"].append(message_body)

        # Patch the dependencies used inside send_events_to_core
        monkeypatch.setattr(
            "app.core.graph.nodes.CoreEventMessageType.create", fake_create
        )
        monkeypatch.setattr(
            "app.core.graph.nodes.msg_event_queue.send_message", fake_send_message
        )

        # Create dummy events
        e1 = AnyEvent(event_id="e1")
        e2 = AnyEvent(event_id="e2")

        # Setup simulation state
        state = SimulationState(
            messages=[],
            permitted_events=[],
            events_accumulator=[],
            new_events=[e1, e2],
            current_score=0,
        )

        room = FakeRoom()
        config = {"configurable": {"room": room}}

        # Call the function under test
        new_state = await send_events_to_core(state, config=config)

        # Verify CoreEventMessageType.create() called once per event
        assert calls["create"] == [("e1", room.name), ("e2", room.name)]

        # Verify send_message called twice (once per event)
        assert len(calls["send_message"]) == 2
        for payload in calls["send_message"]:
            assert "event_id" in payload
            assert "room_id" in payload

        # Ensure state integrity (pass-through)
        assert new_state is state or new_state.new_events == state.new_events
