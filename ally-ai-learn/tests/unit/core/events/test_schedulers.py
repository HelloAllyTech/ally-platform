import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

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


@pytest.mark.asyncio
@patch("app.core.graph.agent_graph")
async def test_event_notifier_updates_graph_with_as_node(
    mock_agent_graph, scheduler: TimeEventScheduler
):
    """
    Tests that event_notifier calls agent_graph.update_state with the
    `as_node` parameter, ensuring the fix for the LangGraph ambiguity bug.
    """
    event_id = "test_event_gt_with_as_node"
    # Corrected: branching_and_feedback_data is now non-empty
    mock_event_notifier = AsyncMock(return_value=(None, 0, ["dummy_branching_data"]))
    mock_get_live_score = MagicMock(return_value=100)
    mock_room = MagicMock(spec=rtc.Room)

    mock_agent_graph.update_state = MagicMock()
    mock_agent_graph.get_state.return_value.return_value = {
        "current_score": 0,
        "messages": [],
    }

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
        agent_graph=mock_agent_graph,
        thread_id="test_thread_id",
    )

    # Allow the task to run
    await asyncio.sleep(0.1)

    # The actual call to update_state happens inside the _trigger_coroutine
    # which is spawned as a task. We need to assert that update_state was called.
    mock_agent_graph.update_state.assert_called_once()
    args, kwargs = mock_agent_graph.update_state.call_args
    assert kwargs.get("as_node") == "update_state_from_event_notifier"

    await scheduler.cancel_all()
