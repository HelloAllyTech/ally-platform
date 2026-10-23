"""Unit tests for TimeEventScheduler."""

import asyncio
from typing import Optional, Set
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.constants import ConditionOperator, DetectionType
from app.core.events.base import BaseEvent
from app.core.events.schedulers import TimeEventScheduler


class MockTimeEvent(BaseEvent):
    """Mock time event for testing."""

    async def detect_event(self, conversations):
        """Mock detect_event method."""
        return False


@pytest.fixture
def scheduler():
    """Create a TimeEventScheduler instance."""
    return TimeEventScheduler()


@pytest.fixture
def mock_event_registry():
    """Create a mock event registry."""
    return {}


@pytest.fixture
def mock_event_notifier():
    """Create a mock event notifier."""

    async def notifier(room, detected_event_ids: Optional[Set[str]] = None):
        return None, 0, []

    return AsyncMock(side_effect=notifier)


@pytest.fixture
def mock_get_live_score():
    """Create a mock get_live_score callback."""
    return MagicMock(return_value=10)


@pytest.fixture
def mock_room():
    """Create a mock LiveKit room."""
    return MagicMock()


@pytest.fixture
def mock_agent_graph():
    """Create a mock agent graph."""
    graph = MagicMock()
    graph.update_state = MagicMock()
    return graph


class TestTimeEventSchedulerInitialization:
    """Test suite for TimeEventScheduler initialization."""

    def test_init_creates_empty_tasks_dict(self, scheduler):
        """Test that initialization creates empty tasks dictionary."""
        assert scheduler._time_tasks == {}
        assert isinstance(scheduler._time_tasks, dict)


class TestTimeEventSchedulerStartSchedulers:
    """Test suite for start_time_event_schedulers method."""

    @pytest.mark.asyncio
    async def test_start_with_no_events(
        self, scheduler, mock_event_registry, mock_event_notifier, mock_get_live_score
    ):
        """Test starting scheduler with no events."""
        await scheduler.start_time_event_schedulers(
            events=[],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            get_live_score=mock_get_live_score,
        )

        assert len(scheduler._time_tasks) == 0

    @pytest.mark.asyncio
    async def test_start_with_non_time_events(
        self, scheduler, mock_event_registry, mock_event_notifier, mock_get_live_score
    ):
        """Test that non-TIME events are ignored."""
        event = MockTimeEvent(
            event_id="test_1",
            detection_type=DetectionType.SENTENCE_SIMILARITY,
            data=MagicMock(time=10, condition=ConditionOperator.GT),
        )

        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            get_live_score=mock_get_live_score,
        )

        assert len(scheduler._time_tasks) == 0

    @pytest.mark.asyncio
    async def test_start_with_gt_condition_schedule(
        self, scheduler, mock_event_registry, mock_event_notifier, mock_get_live_score
    ):
        """Test that GT condition creates a task."""
        event = MockTimeEvent(
            event_id="test_gt",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.GT),
        )

        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            get_live_score=mock_get_live_score,
        )

        assert "test_gt" in scheduler._time_tasks
        assert isinstance(scheduler._time_tasks["test_gt"], asyncio.Task)

    @pytest.mark.asyncio
    async def test_start_with_lt_condition_immediate_execution(
        self,
        scheduler,
        mock_event_registry,
        mock_event_notifier,
        mock_room,
        mock_get_live_score,
    ):
        """Test starting scheduler with LT condition
        executes immediately if eligible."""
        event = MockTimeEvent(
            event_id="test_lt",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.LT),
        )

        # Mock eligibility to return True
        with patch("app.core.events.schedulers.is_event_eligible", return_value=True):
            await scheduler.start_time_event_schedulers(
                events=[event],
                event_registry=mock_event_registry,
                event_notifier=mock_event_notifier,
                get_live_score=mock_get_live_score,
                room=mock_room,
            )

        # Should be scheduled for revoke
        assert "test_lt" in scheduler._time_tasks
        # Should be set to True immediately
        assert (
            mock_event_registry.get("test_lt") is not None
            and mock_event_registry["test_lt"].happened is True
        )

    @pytest.mark.asyncio
    async def test_start_with_lt_condition_not_eligible(
        self,
        scheduler,
        mock_event_registry,
        mock_event_notifier,
        mock_room,
        mock_get_live_score,
    ):
        """Test LT condition ignored if not eligible."""
        event = MockTimeEvent(
            event_id="test_lt_skip",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.LT),
        )

        # Mock eligibility to return False
        with patch("app.core.events.schedulers.is_event_eligible", return_value=False):
            await scheduler.start_time_event_schedulers(
                events=[event],
                event_registry=mock_event_registry,
                event_notifier=mock_event_notifier,
                get_live_score=mock_get_live_score,
                room=mock_room,
            )

        # Should NOT be in registry or tasks
        assert "test_lt_skip" not in scheduler._time_tasks
        assert "test_lt_skip" not in mock_event_registry


class TestTimeEventSchedulerTriggerCoroutine:
    """Test suite for _time_trigger_coroutine method."""

    @pytest.mark.asyncio
    async def test_trigger_sets_happened_to_true_if_eligible(
        self,
        scheduler,
        mock_event_registry,
        mock_event_notifier,
        mock_room,
        mock_get_live_score,
    ):
        """Test that trigger coroutine sets happened to True if eligible."""
        event = MockTimeEvent(
            event_id="test_trigger", detection_type=DetectionType.TIME
        )

        with patch("app.core.events.schedulers.is_event_eligible", return_value=True):
            await scheduler._time_trigger_coroutine(
                event=event,
                seconds=0.01,
                event_registry=mock_event_registry,
                event_notifier=mock_event_notifier,
                get_live_score=mock_get_live_score,
                room=mock_room,
            )

        assert mock_event_registry["test_trigger"].happened is True
        assert mock_event_registry["test_trigger"].occurrence_count == 1

    @pytest.mark.asyncio
    async def test_trigger_does_nothing_if_not_eligible(
        self,
        scheduler,
        mock_event_registry,
        mock_event_notifier,
        mock_room,
        mock_get_live_score,
    ):
        """Test that trigger coroutine does nothing if not eligible."""
        event = MockTimeEvent(event_id="test_ignore", detection_type=DetectionType.TIME)

        with patch("app.core.events.schedulers.is_event_eligible", return_value=False):
            await scheduler._time_trigger_coroutine(
                event=event,
                seconds=0.01,
                event_registry=mock_event_registry,
                event_notifier=mock_event_notifier,
                get_live_score=mock_get_live_score,
                room=mock_room,
            )

        assert "test_ignore" not in mock_event_registry

    @pytest.mark.asyncio
    async def test_trigger_updates_graph_state(
        self,
        scheduler,
        mock_event_registry,
        mock_event_notifier,
        mock_room,
        mock_agent_graph,
        mock_get_live_score,
    ):
        """Test trigger coroutine updates graph state."""
        event = MockTimeEvent(
            event_id="test_graph_update", detection_type=DetectionType.TIME
        )

        async def mock_notifier_with_return(
            room, detected_event_ids: Optional[Set[str]] = None
        ):
            return None, 5, ["instruction"]

        mock_event_notifier.side_effect = mock_notifier_with_return

        with patch("app.core.events.schedulers.is_event_eligible", return_value=True):
            await scheduler._time_trigger_coroutine(
                event=event,
                seconds=0.01,
                event_registry=mock_event_registry,
                event_notifier=mock_event_notifier,
                get_live_score=mock_get_live_score,
                room=mock_room,
                agent_graph=mock_agent_graph,
                thread_id="test_thread",
            )

        mock_agent_graph.update_state.assert_called_once()


class TestTimeEventSchedulerRevokeCoroutine:
    """Test suite for _time_revoke_coroutine method."""

    @pytest.mark.asyncio
    async def test_revoke_sets_happened_to_false(
        self, scheduler, mock_event_registry, mock_event_notifier, mock_room
    ):
        """Test that revoke coroutine sets happened to False."""
        from app.core.events.schemas import EventRegistryEntry

        mock_event_registry["test_revoke"] = EventRegistryEntry(
            happened=True,
            trigger_multiple=False,
        )

        await scheduler._time_revoke_coroutine(
            event_id="test_revoke",
            seconds=0.01,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room,
        )

        assert mock_event_registry["test_revoke"].happened is False


class TestTimeEventSchedulerCancelEvent:
    """Test suite for cancel_time_event method."""

    @pytest.mark.asyncio
    async def test_cancel_existing_event(self, scheduler):
        """Test cancelling an existing time event."""
        task = asyncio.create_task(asyncio.sleep(10))
        scheduler._time_tasks["test_cancel"] = task

        scheduler.cancel_time_event("test_cancel")

        await asyncio.sleep(0.01)

        assert "test_cancel" not in scheduler._time_tasks
        assert task.cancelled()


class TestTimeEventSchedulerEdgeCases:
    """Test suite for edge cases and error scenarios."""

    @pytest.mark.asyncio
    async def test_start_with_mixed_eligibility(
        self,
        scheduler,
        mock_event_registry,
        mock_event_notifier,
        mock_room,
        mock_get_live_score,
    ):
        """Test interaction where one event is eligible and another is not."""
        event_eligible = MockTimeEvent(
            event_id="gt_eligible",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.GT),
        )
        event_ineligible = MockTimeEvent(
            event_id="gt_ineligible",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.GT),
        )

        # Custom eligibility side effect
        def eligibility_side_effect(**kwargs):
            return kwargs["event"].event_id == "gt_eligible"

        with patch(
            "app.core.events.schedulers.is_event_eligible",
            side_effect=eligibility_side_effect,
        ):
            # Start schedulers
            await scheduler.start_time_event_schedulers(
                events=[event_eligible, event_ineligible],
                event_registry=mock_event_registry,
                event_notifier=mock_event_notifier,
                get_live_score=mock_get_live_score,
                room=mock_room,
            )

            # Wait for triggers
            await asyncio.sleep(0.2)

            # Eligible one happened
            assert (
                mock_event_registry.get("gt_eligible") is not None
                and mock_event_registry["gt_eligible"].happened is True
            )
            # Ineligible one did NOT happen
            assert "gt_ineligible" not in mock_event_registry
