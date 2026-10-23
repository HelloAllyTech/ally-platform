from unittest.mock import AsyncMock, MagicMock

import pytest
from livekit.rtc import Room

from app.core.constants import DetectionType
from app.core.events.base import BaseEvent
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.queue import msg_event_queue


class MockEvent(BaseEvent):
    event_id: str = "some_event"
    detection_type: DetectionType = DetectionType.BINARY_CLASSIFIER
    score: int = 0
    branching_instruction: str = None
    visibility_type: str = "ACTIVE"
    emoji: str = ""
    emoji_message: str = ""
    show_feedback: bool = True

    async def detect_event(self, conversations):
        pass


@pytest.mark.asyncio
async def test_send_events_to_core_exception_is_logged_and_raised(monkeypatch, caplog):
    """
    Tests that if _send_events_to_core has an error, it is logged and
    the exception is propagated.
    """
    # 1. Setup
    mock_scenario = MagicMock()
    mock_scenario.events = [MockEvent()]
    mock_scenario.trigger_events = ["some_event"]
    mock_scenario.termination_events = []

    mock_room = MagicMock(spec=Room)
    mock_room.name = "test_room"

    orchestrator = EventOrchestrator(
        scenario=mock_scenario,
        thread_id="test_thread",
        room=mock_room,
        score_keeper=MagicMock(),
    )

    # Mock the SQS queue to raise an exception
    mock_send = AsyncMock(side_effect=Exception("SQS is down"))
    monkeypatch.setattr(msg_event_queue, "send_message", mock_send)

    # 2. Execute and Assert
    with pytest.raises(Exception, match="SQS is down"):
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"some_event"}
        )

    # 3. Assert
    assert "Failed to send event to core: SQS is down" in caplog.text


@pytest.mark.asyncio
async def test_send_events_to_core_exception_is_raised(monkeypatch):
    """
    Tests that if _send_events_to_core has an error, it is raised.
    """
    # 1. Setup
    mock_scenario = MagicMock()
    mock_scenario.events = [MockEvent()]
    mock_scenario.trigger_events = ["some_event"]
    mock_scenario.termination_events = []

    mock_room = MagicMock(spec=Room)
    mock_room.name = "test_room"

    orchestrator = EventOrchestrator(
        scenario=mock_scenario,
        thread_id="test_thread",
        room=mock_room,
        score_keeper=MagicMock(),
    )

    # Mock the SQS queue to raise an exception
    mock_send = AsyncMock(side_effect=Exception("SQS is down"))
    monkeypatch.setattr(msg_event_queue, "send_message", mock_send)

    # 2. Execute and Assert
    with pytest.raises(Exception, match="SQS is down"):
        await orchestrator._send_events_to_core(
            events_to_send=[MockEvent()], room=mock_room
        )
