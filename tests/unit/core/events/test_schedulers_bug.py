from unittest.mock import AsyncMock, MagicMock

import pytest
from livekit import rtc

from app.core.constants import ConditionOperator, DetectionType
from app.core.events.base import BaseEvent
from app.core.events.schedulers import TimeEventScheduler
from pydantic import BaseModel


class EventData(BaseModel):
    time: float
    condition: ConditionOperator


class MockEvent(BaseEvent):
    async def detect_event(self, conversations):
        return True


@pytest.fixture
def scheduler():
    return TimeEventScheduler()


@pytest.mark.asyncio
async def test_time_trigger_coroutine_reraises_exception(scheduler: TimeEventScheduler):
    """
    Tests that _time_trigger_coroutine re-raises exceptions from event_notifier.
    """
    event_id = "test_trigger_event"
    mock_event_notifier = AsyncMock(side_effect=ValueError("Notifier Error"))
    mock_get_live_score = MagicMock(return_value=100)
    mock_room = MagicMock(spec=rtc.Room)
    event = MockEvent(
        event_id=event_id,
        detection_type=DetectionType.TIME,
        data=EventData(time=0.0, condition=ConditionOperator.GT),
    )
    event_registry = {}

    # This test should fail before the fix, and pass after.
    # It checks that the exception from the notifier is propagated.
    with pytest.raises(ValueError, match="Notifier Error"):
        await scheduler._time_trigger_coroutine(
            event=event,
            seconds=0.0,
            event_registry=event_registry,
            event_notifier=mock_event_notifier,
            get_live_score=mock_get_live_score,
            room=mock_room,
        )


@pytest.mark.asyncio
async def test_time_revoke_coroutine_reraises_exception(scheduler: TimeEventScheduler):
    """
    Tests that _time_revoke_coroutine re-raises exceptions from event_notifier.
    """
    event_id = "test_revoke_event"
    mock_event_notifier = AsyncMock(side_effect=ValueError("Notifier Error"))
    mock_room = MagicMock(spec=rtc.Room)
    event_registry = {}

    # This test should fail before the fix, and pass after.
    # It checks that the exception from the notifier is propagated.
    with pytest.raises(ValueError, match="Notifier Error"):
        await scheduler._time_revoke_coroutine(
            event_id=event_id,
            seconds=0.0,
            event_registry=event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room,
        )
