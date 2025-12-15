"""
Tests for score-based event triggering logic, including basic condition checks,
cascading behaviors, and trigger_events filtering.
"""
import pytest
from unittest.mock import MagicMock
from typing import Set

# Adjust imports based on your actual project structure
from app.core.events.base import BaseEvent
from app.core.events.event_types.score.score_event import ScoreEvent
from app.core.events.event_types.score.constants import ScoreData
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.constants import ConditionOperator, VisibilityType, DetectionType
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


def create_test_scenario(events, trigger_events_whitelist=None):
    """
    Helper to create a Scenario.
    If trigger_events_whitelist is provided, only those IDs are allowed to trigger.
    Otherwise, defaults to all event IDs.
    """
    scenario = MagicMock(spec=Scenario)
    scenario.events = events

    if trigger_events_whitelist is not None:
        scenario.trigger_events = trigger_events_whitelist
    else:
        scenario.trigger_events = [e.event_id for e in events]

    scenario.termination_event = None
    return scenario


class TestScoreCascadingLogic:
    """
    Comprehensive tests for score logic, covering basic conditions and complex cascades/filters.
    """

    # --- Basic Condition Tests ---

    def test_score_event_lt_condition(self, mock_room, thread_id):
        """Test that LT condition triggers when score is less than threshold."""
        score_event = ScoreEvent.create(
            event_id="score-lt-10",
            data=ScoreData(score=10, condition=ConditionOperator.LT),
            visibility_type=VisibilityType.ACTIVE
        )
        scenario = create_test_scenario([score_event])
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Test 10 (not < 10)
        triggered = orchestrator.get_newly_triggered_score_events(10)
        assert len(triggered) == 0

        # Test 9 (< 10)
        triggered = orchestrator.get_newly_triggered_score_events(9)
        assert "score-lt-10" in triggered

        # Test 11 (not < 10, already happened, but for LT, it might revert in a real scenario,
        # here we check if it triggers *newly* from 9 to 11, which it should not)
        triggered = orchestrator.get_newly_triggered_score_events(11)
        assert len(triggered) == 0

    def test_score_event_lte_condition(self, mock_room, thread_id):
        """Test that LTE condition triggers when score is less than or equal to threshold."""
        score_event = ScoreEvent.create(
            event_id="score-lte-20",
            data=ScoreData(score=20, condition=ConditionOperator.LTE),
            visibility_type=VisibilityType.PASSIVE
        )
        scenario = create_test_scenario([score_event])
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Test 21 (not <= 20)
        triggered = orchestrator.get_newly_triggered_score_events(21)
        assert len(triggered) == 0

        # Test 20 (<= 20)
        triggered = orchestrator.get_newly_triggered_score_events(20)
        assert "score-lte-20" in triggered

        # Test 19 (<= 20, already happened, should not trigger newly)
        triggered = orchestrator.get_newly_triggered_score_events(19)
        assert len(triggered) == 0

    def test_score_event_gt_condition(self, mock_room, thread_id):
        """Test that GT condition triggers when score exceeds threshold."""
        score_event = ScoreEvent.create(
            event_id="score-gt-10",
            data=ScoreData(score=10, condition=ConditionOperator.GT),
            visibility_type=VisibilityType.ACTIVE
        )
        scenario = create_test_scenario([score_event])
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Test 10 (not > 10)
        triggered = orchestrator.get_newly_triggered_score_events(10)
        assert len(triggered) == 0

        # Test 11 (> 10)
        triggered = orchestrator.get_newly_triggered_score_events(11)
        assert "score-gt-10" in triggered

        # Test 15 (already triggered)
        triggered = orchestrator.get_newly_triggered_score_events(15)
        assert len(triggered) == 0

    def test_score_event_gte_condition(self, mock_room, thread_id):
        """Test that GTE condition triggers when score is greater than or equal to threshold."""
        score_event = ScoreEvent.create(
            event_id="score-gte-20",
            data=ScoreData(score=20, condition=ConditionOperator.GTE),
            visibility_type=VisibilityType.PASSIVE
        )
        scenario = create_test_scenario([score_event])
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Test 19 (not >= 20)
        triggered = orchestrator.get_newly_triggered_score_events(19)
        assert len(triggered) == 0

        # Test 20 (>= 20)
        triggered = orchestrator.get_newly_triggered_score_events(20)
        assert "score-gte-20" in triggered

        # Test 25 (already triggered)
        triggered = orchestrator.get_newly_triggered_score_events(25)
        assert len(triggered) == 0

    def test_score_event_eq_condition(self, mock_room, thread_id):
        """Test that EQ condition triggers when score is exactly equal to threshold."""
        score_event = ScoreEvent.create(
            event_id="score-eq-5",
            data=ScoreData(score=5, condition=ConditionOperator.EQ),
            visibility_type=VisibilityType.PASSIVE
        )
        scenario = create_test_scenario([score_event])
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Test 4 (not == 5)
        triggered = orchestrator.get_newly_triggered_score_events(4)
        assert len(triggered) == 0

        # Test 5 (== 5)
        triggered = orchestrator.get_newly_triggered_score_events(5)
        assert "score-eq-5" in triggered

        # Test 6 (not == 5, already triggered)
        triggered = orchestrator.get_newly_triggered_score_events(6)
        assert len(triggered) == 0  # Event already triggered, no new trigger

    # --- Cascade and Filtering Tests (using SENTENCE_SIMILARITY) ---

    def _create_chain_events(self):
        """
        Creates a chain of 3 events:
        1. Event A (Source): SENTENCE_SIMILARITY event, adds 10 points.
        2. Event B (Intermediate): Score event (triggers at >=10), adds 5 points.
        3. Event C (Final): Score event (triggers at >=15).
        """
        # Event A: The user says something, detected via sentence similarity, adds 10 score
        event_a = MagicMock(spec=BaseEvent)
        event_a.event_id = "event_a"
        event_a.score = 10
        event_a.detection_type = DetectionType.SENTENCE_SIMILARITY
        event_a.branching_instruction = None

        # Event B: Triggers when score >= 10. Adds 5 score.
        event_b = ScoreEvent.create(
            event_id="event_b",
            data=ScoreData(score=10, condition=ConditionOperator.GTE),
            visibility_type=VisibilityType.ACTIVE,
            score=5
        )

        # Event C: Triggers when score >= 15. Score remains 0 (None) by default.
        event_c = ScoreEvent.create(
            event_id="event_c",
            data=ScoreData(score=15, condition=ConditionOperator.GTE),
            visibility_type=VisibilityType.ACTIVE
        )

        return [event_a, event_b, event_c]

    def _setup_orchestrator_with_events(self, events, scenario, mock_room, thread_id):
        """Helper to set up and initialize the orchestrator."""
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Manually ensure the source event (Event A) state is correctly set in the registry
        for event in events:
            orchestrator.set_event_state(event.event_id, False, event.detection_type)

        return orchestrator

    def test_full_cascade_success(self, mock_room, thread_id):
        """
        CASE 1: Happy Path
        All events are in trigger_events. Expected added_score = 5 (from B).
        """
        events = self._create_chain_events()
        scenario = create_test_scenario(events, trigger_events_whitelist=["event_a", "event_b", "event_c"])
        orchestrator = self._setup_orchestrator_with_events(events, scenario, mock_room, thread_id)

        detected_ids = {"event_a"}
        final_ids, added_score = orchestrator._evaluate_and_handle_cascade_score_events(detected_ids)

        assert "event_a" in final_ids
        assert "event_b" in final_ids
        assert "event_c" in final_ids
        assert added_score == 5

    def test_source_event_filtered(self, mock_room, thread_id):
        """
        CASE 2: Source Filtered
        Event A is NOT in trigger_events. Expected: Score remains 0. B and C do NOT trigger.
        """
        events = self._create_chain_events()
        scenario = create_test_scenario(events, trigger_events_whitelist=["event_b", "event_c"])
        orchestrator = self._setup_orchestrator_with_events(events, scenario, mock_room, thread_id)

        detected_ids = {"event_a"}
        final_ids, added_score = orchestrator._evaluate_and_handle_cascade_score_events(detected_ids)

        assert "event_a" in final_ids
        assert "event_b" not in final_ids
        assert "event_c" not in final_ids
        assert added_score == 0

    def test_intermediate_cascade_filtered(self, mock_room, thread_id):
        """
        CASE 3: Intermediate Event Filtered
        Event B is NOT in trigger_events. Expected: B triggers (happened=True), but its score (+5) is ignored. C fails.
        """
        events = self._create_chain_events()
        scenario = create_test_scenario(events, trigger_events_whitelist=["event_a", "event_c"])
        orchestrator = self._setup_orchestrator_with_events(events, scenario, mock_room, thread_id)

        detected_ids = {"event_a"}
        final_ids, added_score = orchestrator._evaluate_and_handle_cascade_score_events(detected_ids)

        assert "event_a" in final_ids
        assert "event_b" in final_ids  # B should register as "happened"
        assert "event_c" not in final_ids
        assert added_score == 0  # B's score was filtered out

    def test_live_score_integration(self, mock_room, thread_id):
        """
        CASE 4: Existing Live Score
        Tests that existing live_score respects the filter logic (B and C are allowed).
        """
        events = self._create_chain_events()
        scenario = create_test_scenario(events, trigger_events_whitelist=["event_b", "event_c"])
        orchestrator = self._setup_orchestrator_with_events(events, scenario, mock_room, thread_id)

        # Manually set accumulated score to 10 (simulating previous events that were sent/scored)
        orchestrator.live_score = 10

        # Pass empty set to check purely score-based events
        final_ids, added_score = orchestrator._evaluate_and_handle_cascade_score_events(set())

        # B triggers at 10, C triggers at 15 (since B adds +5)
        assert "event_b" in final_ids
        assert "event_c" in final_ids

        # Added score comes from B (+5)
        assert added_score == 5