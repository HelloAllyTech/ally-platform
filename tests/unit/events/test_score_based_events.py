"""
Tests for score-based event triggering logic.
"""
import pytest
from unittest.mock import MagicMock, patch
from app.core.events.event_types.score.score_event import ScoreEvent
from app.core.events.event_types.score.constants import ScoreData
from app.core.events.event_registry.event_registry import EventRegistry
from app.core.constants import ConditionOperator, VisibilityType
from app.core.scenario.base import Scenario


@pytest.fixture
def mock_room():
    """Create a mock LiveKit room."""
    room = MagicMock()
    room.name = "test-room"
    return room


@pytest.fixture
def thread_id():
    """Return a test thread ID."""
    return "test-thread-123"


def create_test_scenario_with_events(events):
    """Helper to create a Scenario object from events for testing."""
    scenario = MagicMock(spec=Scenario)
    scenario.events = events
    scenario.trigger_events = []
    scenario.termination_event = None
    return scenario


class TestScoreBasedEvents:
    """Test score-based event detection and triggering."""

    @patch('app.core.events.event_registry.event_registry.get_current_score_from_graph', return_value=0)
    def test_score_event_gt_condition(self, mock_score, mock_room, thread_id):
        """Test that GT condition triggers when score exceeds threshold."""
        # Create a score event that triggers when score > 10
        score_event = ScoreEvent.create(
            event_id="score-gt-10",
            data=ScoreData(score=10, condition=ConditionOperator.GT),
            visibility_type=VisibilityType.ACTIVE,
            score=5  # This event itself adds 5 points when triggered
        )
        
        scenario = create_test_scenario_with_events([score_event])
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # Initially, score is 0, so event should not be triggered
        assert registry.event_registry["score-gt-10"]["happened"] is False
        
        # Check with score = 10 (not > 10, should not trigger)
        triggered = registry.get_newly_triggered_score_events(10)
        assert len(triggered) == 0
        assert registry.event_registry["score-gt-10"]["happened"] is False
        
        # Check with score = 11 (> 10, should trigger)
        triggered = registry.get_newly_triggered_score_events(11)
        assert len(triggered) == 1
        assert "score-gt-10" in triggered
        assert registry.event_registry["score-gt-10"]["happened"] is True
        
        # Check again with score = 15 (already triggered, should not trigger again)
        triggered = registry.get_newly_triggered_score_events(15)
        assert len(triggered) == 0  # Already triggered, no new triggers

    @patch('app.core.events.event_registry.event_registry.get_current_score_from_graph', return_value=0)
    def test_score_event_gte_condition(self, mock_score, mock_room, thread_id):
        """Test that GTE condition triggers when score >= threshold."""
        score_event = ScoreEvent.create(
            event_id="score-gte-20",
            data=ScoreData(score=20, condition=ConditionOperator.GTE),
            visibility_type=VisibilityType.PASSIVE
        )
        
        scenario = create_test_scenario_with_events([score_event])
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # Check with score = 19 (< 20, should not trigger)
        triggered = registry.get_newly_triggered_score_events(19)
        assert len(triggered) == 0
        
        # Check with score = 20 (>= 20, should trigger)
        triggered = registry.get_newly_triggered_score_events(20)
        assert len(triggered) == 1
        assert "score-gte-20" in triggered

    @patch('app.core.events.event_registry.event_registry.get_current_score_from_graph', return_value=0)
    def test_score_event_lt_condition(self, mock_score, mock_room, thread_id):
        """Test that LT condition triggers when score < threshold."""
        score_event = ScoreEvent.create(
            event_id="score-lt-5",
            data=ScoreData(score=5, condition=ConditionOperator.LT),
            visibility_type=VisibilityType.ACTIVE
        )
        
        scenario = create_test_scenario_with_events([score_event])
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # Initially all events start as False in setup_initial_state()
        # Score events are only evaluated in async initialize() or when get_newly_triggered_score_events is called
        assert registry.event_registry["score-lt-5"]["happened"] is False
        
        # Check with score = 4 (< 5, should trigger)
        triggered = registry.get_newly_triggered_score_events(4)
        assert len(triggered) == 1
        assert "score-lt-5" in triggered
        assert registry.event_registry["score-lt-5"]["happened"] is True
        
        # Check with score = 5 (not < 5, but event stays True since it already triggered)
        triggered = registry.get_newly_triggered_score_events(5)
        assert len(triggered) == 0
        assert registry.event_registry["score-lt-5"]["happened"] is True

    @patch('app.core.events.event_registry.event_registry.get_current_score_from_graph', return_value=0)
    def test_score_event_eq_condition(self, mock_score, mock_room, thread_id):
        """Test that EQ condition triggers when score == threshold."""
        score_event = ScoreEvent.create(
            event_id="score-eq-50",
            data=ScoreData(score=50, condition=ConditionOperator.EQ),
            visibility_type=VisibilityType.ACTIVE
        )
        
        scenario = create_test_scenario_with_events([score_event])
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # Check with score = 49 (not == 50, should not trigger)
        triggered = registry.get_newly_triggered_score_events(49)
        assert len(triggered) == 0
        
        # Check with score = 50 (== 50, should trigger)
        triggered = registry.get_newly_triggered_score_events(50)
        assert len(triggered) == 1
        assert "score-eq-50" in triggered
        
        # Check with score = 51 (not == 50, no new trigger but stays True since it already happened)
        triggered = registry.get_newly_triggered_score_events(51)
        assert len(triggered) == 0
        # Event stays True once triggered (it happened at score 50)
        assert registry.event_registry["score-eq-50"]["happened"] is True

    @patch('app.core.events.event_registry.event_registry.get_current_score_from_graph', return_value=0)
    def test_multiple_score_events(self, mock_score, mock_room, thread_id):
        """Test multiple score events with different conditions."""
        event1 = ScoreEvent.create(
            event_id="score-gt-10",
            data=ScoreData(score=10, condition=ConditionOperator.GT),
            visibility_type=VisibilityType.ACTIVE
        )
        event2 = ScoreEvent.create(
            event_id="score-gte-20",
            data=ScoreData(score=20, condition=ConditionOperator.GTE),
            visibility_type=VisibilityType.ACTIVE
        )
        event3 = ScoreEvent.create(
            event_id="score-lt-5",
            data=ScoreData(score=5, condition=ConditionOperator.LT),
            visibility_type=VisibilityType.PASSIVE
        )
        
        scenario = create_test_scenario_with_events([event1, event2, event3])
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # Initially all events start as False
        assert registry.event_registry["score-gt-10"]["happened"] is False
        assert registry.event_registry["score-gte-20"]["happened"] is False
        assert registry.event_registry["score-lt-5"]["happened"] is False
        
        # Check with score = 4 (should trigger LT-5)
        triggered = registry.get_newly_triggered_score_events(4)
        assert len(triggered) == 1
        assert "score-lt-5" in triggered
        
        # Check with score = 15 (should trigger GT-10, but not GTE-20, LT-5 stays True)
        triggered = registry.get_newly_triggered_score_events(15)
        assert len(triggered) == 1
        assert "score-gt-10" in triggered
        assert registry.event_registry["score-gt-10"]["happened"] is True
        assert registry.event_registry["score-gte-20"]["happened"] is False
        assert registry.event_registry["score-lt-5"]["happened"] is True
        
        # Check with score = 25 (should trigger GTE-20, GT-10 already triggered)
        triggered = registry.get_newly_triggered_score_events(25)
        assert len(triggered) == 1
        assert "score-gte-20" in triggered
        assert registry.event_registry["score-gt-10"]["happened"] is True
        assert registry.event_registry["score-gte-20"]["happened"] is True

    @patch('app.core.events.event_registry.event_registry.get_current_score_from_graph', return_value=0)
    def test_cascading_score_events(self, mock_score, mock_room, thread_id):
        """Test that score events can trigger other score events (cascading)."""
        # Event 1: Triggers when score > 10, adds 15 points
        event1 = ScoreEvent.create(
            event_id="score-gt-10",
            data=ScoreData(score=10, condition=ConditionOperator.GT),
            visibility_type=VisibilityType.ACTIVE,
            score=15  # Adds 15 points when triggered
        )
        # Event 2: Triggers when score >= 20
        event2 = ScoreEvent.create(
            event_id="score-gte-20",
            data=ScoreData(score=20, condition=ConditionOperator.GTE),
            visibility_type=VisibilityType.ACTIVE,
            score=10  # Adds 10 points when triggered
        )
        # Event 3: Triggers when score >= 30
        event3 = ScoreEvent.create(
            event_id="score-gte-30",
            data=ScoreData(score=30, condition=ConditionOperator.GTE),
            visibility_type=VisibilityType.ACTIVE
        )
        
        scenario = create_test_scenario_with_events([event1, event2, event3])
        registry = EventRegistry(scenario, mock_room, thread_id)
        
        # The cascading logic is tested in update_and_send_events
        # Here we just verify that get_newly_triggered_score_events correctly identifies triggers
        
        # At score = 11: event1 should trigger
        triggered = registry.get_newly_triggered_score_events(11)
        assert "score-gt-10" in triggered
        
        # After event1 triggers and adds 15, score becomes 26
        # At score = 26: event2 should trigger
        triggered = registry.get_newly_triggered_score_events(26)
        assert "score-gte-20" in triggered
        
        # After event2 triggers and adds 10, score becomes 36
        # At score = 36: event3 should trigger
        triggered = registry.get_newly_triggered_score_events(36)
        assert "score-gte-30" in triggered
