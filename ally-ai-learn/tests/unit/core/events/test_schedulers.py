import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from livekit import rtc
from pydantic import BaseModel

from app.core.constants import ConditionOperator, DetectionType
from app.core.events.base import BaseEvent
from app.core.events.schedulers import TimeEventScheduler


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
async def test_lt_event_updates_graph_with_as_node(scheduler: TimeEventScheduler):
    """
    Tests that for an LT/LTE event, agent_graph.update_state is called with
    as_node=True.
    """
    event_id = "test_event_lt"
    mock_event_notifier = AsyncMock(return_value=(set(), 0, {"some_data"}))
    mock_get_live_score = MagicMock(return_value=100)
    mock_room = MagicMock(spec=rtc.Room)
    mock_agent_graph = MagicMock()

    event = MockEvent(
        event_id=event_id,
        detection_type=DetectionType.TIME,
        data=EventData(time=0.01, condition=ConditionOperator.LT),
    )

    event_registry = {}

    await scheduler.start_time_event_schedulers(
        events=[event],
        event_registry=event_registry,
        event_notifier=mock_event_notifier,
        get_live_score=mock_get_live_score,
        room=mock_room,
        agent_graph=mock_agent_graph,
        thread_id="test_thread",
    )

    # Allow the task to run
    await asyncio.sleep(0.1)

    mock_agent_graph.update_state.assert_called_with(
        {"configurable": {"thread_id": "test_thread"}},
        values={"branching_and_feedback_data": {"some_data"}},
        as_node=True,
    )

    # Cancel any remaining tasks to be safe
    await scheduler.cancel_all()


@pytest.mark.asyncio
async def test_event_notifier_exception_after_trigger(
    scheduler: TimeEventScheduler, caplog
):
    """
    Tests that if event_notifier throws an exception in _time_trigger_coroutine,
    it's caught, logged, and the task is cleaned up.
    """
    event_id = "test_event_gt"
    mock_event_notifier = AsyncMock(side_effect=ValueError("Test Exception"))
    mock_get_live_score = MagicMock(return_value=100)
    mock_room = MagicMock(spec=rtc.Room)

    event = MockEvent(
        event_id=event_id,
        detection_type=DetectionType.TIME,
        data=EventData(time=0.01, condition=ConditionOperator.GT),
    )

    event_registry = {}

    await scheduler.start_time_event_schedulers(
        events=[event],
        event_registry=event_registry,
        event_notifier=mock_event_notifier,
        get_live_score=mock_get_live_score,
        room=mock_room,
    )

    # Allow the task to run
    await asyncio.sleep(0.1)

    # Check that the exception was logged
    assert "Error while event_notifier after trigger" in caplog.text
    assert "Test Exception" in caplog.text

    # Check that the task was cleaned up
    assert event_id not in scheduler._time_tasks

    # Cancel any remaining tasks to be safe
    await scheduler.cancel_all()
