"""Unit tests for TimeEventScheduler."""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Set, Optional

from app.core.events.schedulers import TimeEventScheduler
from app.core.events.base import BaseEvent
from app.core.constants import DetectionType, ConditionOperator, VisibilityType


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
    async def notifier(room, current_score: int = 0, detected_event_ids: Optional[Set[str]] = None):
        return None, 0, []
    return AsyncMock(side_effect=notifier)


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
    
    def test_multiple_schedulers_independent(self):
        """Test that multiple scheduler instances are independent."""
        scheduler1 = TimeEventScheduler()
        scheduler2 = TimeEventScheduler()
        
        scheduler1._time_tasks["test"] = "value1"
        
        assert "test" in scheduler1._time_tasks
        assert "test" not in scheduler2._time_tasks


class TestTimeEventSchedulerStartSchedulers:
    """Test suite for start_time_event_schedulers method."""
    
    @pytest.mark.asyncio
    async def test_start_with_no_events(self, scheduler, mock_event_registry, mock_event_notifier):
        """Test starting scheduler with no events."""
        await scheduler.start_time_event_schedulers(
            events=[],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier
        )
        
        assert len(scheduler._time_tasks) == 0
    
    @pytest.mark.asyncio
    async def test_start_with_non_time_events(self, scheduler, mock_event_registry, mock_event_notifier):
        """Test that non-TIME events are ignored."""
        event = MockTimeEvent(
            event_id="test_1",
            detection_type=DetectionType.SENTENCE_SIMILARITY,
            data=MagicMock(time=10, condition=ConditionOperator.GT)
        )
        
        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier
        )
        
        assert len(scheduler._time_tasks) == 0
    
    @pytest.mark.asyncio
    async def test_start_with_gt_condition(self, scheduler, mock_event_registry, mock_event_notifier):
        """Test starting scheduler with GT condition."""
        event = MockTimeEvent(
            event_id="test_gt",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.GT)
        )
        
        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier
        )
        
        assert "test_gt" in scheduler._time_tasks
        assert isinstance(scheduler._time_tasks["test_gt"], asyncio.Task)
        
        await asyncio.sleep(0.2)
        assert mock_event_registry.get("test_gt", {}).get("happened") == True
    
    @pytest.mark.asyncio
    async def test_start_with_lt_condition(self, scheduler, mock_event_registry, mock_event_notifier, mock_room):
        """Test starting scheduler with LT condition."""
        event = MockTimeEvent(
            event_id="test_lt",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.LT)
        )
        
        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        assert "test_lt" in scheduler._time_tasks
        assert mock_event_registry.get("test_lt", {}).get("happened") == True
        
        await asyncio.sleep(0.2)
        assert mock_event_registry.get("test_lt", {}).get("happened") == False
    
    @pytest.mark.asyncio
    async def test_start_with_lte_condition(self, scheduler, mock_event_registry, mock_event_notifier, mock_room):
        """Test starting scheduler with LTE condition."""
        event = MockTimeEvent(
            event_id="test_lte",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.LTE)
        )
        
        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        assert "test_lte" in scheduler._time_tasks
        assert mock_event_registry.get("test_lte", {}).get("happened") == True
        
        await asyncio.sleep(0.2)
        assert mock_event_registry.get("test_lte", {}).get("happened") == False
    
    @pytest.mark.asyncio
    async def test_start_with_invalid_time_value(self, scheduler, mock_event_registry, mock_event_notifier):
        """Test handling of invalid time values."""
        event = MockTimeEvent(
            event_id="test_invalid",
            detection_type=DetectionType.TIME,
            data=MagicMock(time="invalid", condition=ConditionOperator.GT)
        )
        
        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            default_seconds=0.1
        )
        
        assert "test_invalid" in scheduler._time_tasks
        
        await asyncio.sleep(0.2)
        assert mock_event_registry.get("test_invalid", {}).get("happened") == True
    
    @pytest.mark.asyncio
    async def test_start_with_negative_time(self, scheduler, mock_event_registry, mock_event_notifier):
        """Test handling of negative time values."""
        event = MockTimeEvent(
            event_id="test_negative",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=-5, condition=ConditionOperator.GT)
        )
        
        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier
        )
        
        assert "test_negative" in scheduler._time_tasks
        
        await asyncio.sleep(0.1)
        assert mock_event_registry.get("test_negative", {}).get("happened") == True
    
    @pytest.mark.asyncio
    async def test_start_with_missing_event_id(self, scheduler, mock_event_registry, mock_event_notifier):
        """Test handling of events with missing event_id."""
        event = MockTimeEvent(
            event_id="",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.GT)
        )
        
        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier
        )
        
        assert len(scheduler._time_tasks) == 0
    
    @pytest.mark.asyncio
    async def test_start_with_multiple_events(self, scheduler, mock_event_registry, mock_event_notifier):
        """Test starting scheduler with multiple events."""
        events = [
            MockTimeEvent(
                event_id=f"test_{i}",
                detection_type=DetectionType.TIME,
                data=MagicMock(time=0.1, condition=ConditionOperator.GT)
            )
            for i in range(5)
        ]
        
        await scheduler.start_time_event_schedulers(
            events=events,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier
        )
        
        assert len(scheduler._time_tasks) == 5
        for i in range(5):
            assert f"test_{i}" in scheduler._time_tasks
    
    @pytest.mark.asyncio
    async def test_start_with_graph_and_thread_id(self, scheduler, mock_event_registry, 
                                                   mock_event_notifier, mock_agent_graph):
        """Test starting scheduler with agent graph and thread ID."""
        async def mock_notifier_with_return(room, current_score: int = 0, detected_event_ids: Optional[Set[str]] = None):
            return None, 10, ["instruction1", "instruction2"]
        
        mock_event_notifier.side_effect = mock_notifier_with_return
        
        with patch('app.core.events.schedulers.get_current_score_from_graph', return_value=5):
            event = MockTimeEvent(
                event_id="test_graph",
                detection_type=DetectionType.TIME,
                data=MagicMock(time=0.1, condition=ConditionOperator.GT)
            )
            
            await scheduler.start_time_event_schedulers(
                events=[event],
                event_registry=mock_event_registry,
                event_notifier=mock_event_notifier,
                agent_graph=mock_agent_graph,
                thread_id="test_thread"
            )
            
            await asyncio.sleep(0.2)
            
            assert mock_agent_graph.update_state.called


class TestTimeEventSchedulerTriggerCoroutine:
    """Test suite for _time_trigger_coroutine method."""
    
    @pytest.mark.asyncio
    async def test_trigger_sets_happened_to_true(self, scheduler, mock_event_registry, 
                                                  mock_event_notifier, mock_room):
        """Test that trigger coroutine sets happened to True."""
        await scheduler._time_trigger_coroutine(
            event_id="test_trigger",
            seconds=0.1,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        assert mock_event_registry["test_trigger"]["happened"] == True
    
    @pytest.mark.asyncio
    async def test_trigger_calls_event_notifier(self, scheduler, mock_event_registry, 
                                                 mock_event_notifier, mock_room):
        """Test that trigger coroutine calls event notifier."""
        await scheduler._time_trigger_coroutine(
            event_id="test_notify",
            seconds=0.1,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        mock_event_notifier.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_trigger_handles_notifier_exception(self, scheduler, mock_event_registry, 
                                                       mock_event_notifier, mock_room):
        """Test that trigger handles exceptions from event notifier."""
        mock_event_notifier.side_effect = Exception("Notifier error")
        
        await scheduler._time_trigger_coroutine(
            event_id="test_error",
            seconds=0.1,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        assert mock_event_registry["test_error"]["happened"] == True
    
    @pytest.mark.asyncio
    async def test_trigger_with_graph_updates(self, scheduler, mock_event_registry, 
                                               mock_event_notifier, mock_room, mock_agent_graph):
        """Test trigger coroutine updates graph state."""
        async def mock_notifier_with_return(room, current_score: int = 0, detected_event_ids: Optional[Set[str]] = None):
            return None, 5, ["instruction"]
        
        mock_event_notifier.side_effect = mock_notifier_with_return
        
        with patch('app.core.events.schedulers.get_current_score_from_graph', return_value=10):
            await scheduler._time_trigger_coroutine(
                event_id="test_graph_update",
                seconds=0.1,
                event_registry=mock_event_registry,
                event_notifier=mock_event_notifier,
                room=mock_room,
                agent_graph=mock_agent_graph,
                thread_id="test_thread"
            )
            
            assert mock_agent_graph.update_state.called


class TestTimeEventSchedulerRevokeCoroutine:
    """Test suite for _time_revoke_coroutine method."""
    
    @pytest.mark.asyncio
    async def test_revoke_sets_happened_to_false(self, scheduler, mock_event_registry, 
                                                  mock_event_notifier, mock_room):
        """Test that revoke coroutine sets happened to False."""
        mock_event_registry["test_revoke"] = {"happened": True, "trigger_multiple": False}
        
        await scheduler._time_revoke_coroutine(
            event_id="test_revoke",
            seconds=0.1,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        assert mock_event_registry["test_revoke"]["happened"] == False
    
    @pytest.mark.asyncio
    async def test_revoke_calls_event_notifier(self, scheduler, mock_event_registry, 
                                                mock_event_notifier, mock_room):
        """Test that revoke coroutine calls event notifier."""
        await scheduler._time_revoke_coroutine(
            event_id="test_revoke_notify",
            seconds=0.1,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        mock_event_notifier.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_revoke_handles_notifier_exception(self, scheduler, mock_event_registry, 
                                                      mock_event_notifier, mock_room):
        """Test that revoke handles exceptions from event notifier."""
        mock_event_notifier.side_effect = Exception("Revoke notifier error")
        
        await scheduler._time_revoke_coroutine(
            event_id="test_revoke_error",
            seconds=0.1,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        assert mock_event_registry["test_revoke_error"]["happened"] == False


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
    
    @pytest.mark.asyncio
    async def test_cancel_non_existent_event(self, scheduler):
        """Test cancelling a non-existent event does not raise error."""
        scheduler.cancel_time_event("non_existent")
        
        assert "non_existent" not in scheduler._time_tasks


class TestTimeEventSchedulerEdgeCases:
    """Test suite for edge cases and error scenarios."""
    
    @pytest.mark.asyncio
    async def test_mixed_condition_types(self, scheduler, mock_event_registry, 
                                         mock_event_notifier, mock_room):
        """Test scheduling events with mixed condition types."""
        events = [
            MockTimeEvent(
                event_id="mixed_gt",
                detection_type=DetectionType.TIME,
                data=MagicMock(time=0.1, condition=ConditionOperator.GT)
            ),
            MockTimeEvent(
                event_id="mixed_lt",
                detection_type=DetectionType.TIME,
                data=MagicMock(time=0.1, condition=ConditionOperator.LT)
            ),
            MockTimeEvent(
                event_id="mixed_eq",
                detection_type=DetectionType.TIME,
                data=MagicMock(time=0.1, condition=ConditionOperator.EQ)
            )
        ]
        
        await scheduler.start_time_event_schedulers(
            events=events,
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier,
            room=mock_room
        )
        
        assert len(scheduler._time_tasks) == 3
        
        assert mock_event_registry.get("mixed_lt", {}).get("happened") == True
        
        await asyncio.sleep(0.2)
        
        assert mock_event_registry.get("mixed_gt", {}).get("happened") == True
        assert mock_event_registry.get("mixed_eq", {}).get("happened") == True
        assert mock_event_registry.get("mixed_lt", {}).get("happened") == False
    
    @pytest.mark.asyncio
    async def test_task_cleanup_after_completion(self, scheduler, mock_event_registry, 
                                                  mock_event_notifier):
        """Test that tasks are cleaned up after completion."""
        event = MockTimeEvent(
            event_id="cleanup_test",
            detection_type=DetectionType.TIME,
            data=MagicMock(time=0.1, condition=ConditionOperator.GT)
        )
        
        await scheduler.start_time_event_schedulers(
            events=[event],
            event_registry=mock_event_registry,
            event_notifier=mock_event_notifier
        )
        
        assert "cleanup_test" in scheduler._time_tasks
        
        await asyncio.sleep(0.2)
        
        assert "cleanup_test" not in scheduler._time_tasks
