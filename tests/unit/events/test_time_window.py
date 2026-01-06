from datetime import datetime, timedelta, timezone
from typing import Any, List
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import PrivateAttr

from app.core.events.base import BaseEvent, ChatMessage, DetectionConfiguration
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.graph.nodes import process_events
from app.core.graph.state import SimulationState


class MockEvent(BaseEvent):
    """
    A concrete implementation of BaseEvent for testing.
    """

    _detect_event_mock: Any = PrivateAttr()

    def __init__(self, event_id, start=None, end=None, score=10):
        config = DetectionConfiguration(start_time=start, end_time=end)
        super().__init__(event_id=event_id, detection_configuration=config, score=score)
        self._detect_event_mock = MagicMock(return_value=True)

    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        return self._detect_event_mock(conversations)

    @property
    def detect_event_mock(self):
        return self._detect_event_mock


@pytest.fixture
def base_state():
    return SimulationState(
        messages=[],
        permitted_events=[],
        events_accumulator=[],
        current_score=0,
        new_events=[],
        branching_instructions=[],
    )


@pytest.mark.asyncio
async def test_process_events_time_filtering(base_state):
    """
    Verifies that events are filtered correctly based on agent_joined_at.
    """
    fixed_now = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    joined_time = fixed_now - timedelta(seconds=100)
    joined_iso = joined_time.isoformat()

    event_too_late = MockEvent("too_late", start=0, end=50)
    event_inside = MockEvent("inside", start=50, end=150)
    event_too_early = MockEvent("too_early", start=200, end=300)
    event_always = MockEvent("always", start=None, end=None)

    base_state.permitted_events = [
        event_too_late,
        event_inside,
        event_too_early,
        event_always,
    ]

    config = {
        "configurable": {
            "agent_joined_at": joined_iso,
            "room": MagicMock(),
            "event_orchestrator": MagicMock(spec=EventOrchestrator),
        }
    }

    # --- FIX 1: Use AsyncMock here ---
    config["configurable"]["event_orchestrator"].handle_events = AsyncMock(
        return_value=(None, 0, [])
    )

    with patch("app.core.graph.nodes.datetime") as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        mock_datetime.fromisoformat = datetime.fromisoformat
        mock_datetime.timezone = timezone

        result = await process_events(base_state, config)

    # Assertions
    event_too_late.detect_event_mock.assert_not_called()
    event_inside.detect_event_mock.assert_called_once()
    event_too_early.detect_event_mock.assert_not_called()
    event_always.detect_event_mock.assert_called_once()

    assert result["current_score"] == 20


@pytest.mark.asyncio
async def test_process_events_invalid_time_format(base_state):
    """Verifies behavior when agent_joined_at is malformed."""

    event = MockEvent("always_run")
    base_state.permitted_events = [event]

    config = {
        "configurable": {
            "agent_joined_at": "invalid-garbage-string",
            "room": MagicMock(),
            "event_orchestrator": MagicMock(),
        }
    }

    config["configurable"]["event_orchestrator"].handle_events = AsyncMock(
        return_value=(None, 0, [])
    )

    with patch("app.core.graph.nodes.datetime") as mock_datetime:
        mock_datetime.now.return_value = datetime.now(timezone.utc)
        mock_datetime.fromisoformat = datetime.fromisoformat

        await process_events(base_state, config)

    event.detect_event_mock.assert_called()
