"""
Test for the bug fix where score-based events in combination events
don't get re-evaluated when score changes.

Bug scenario:
- Combination event C1 = S1 AND SS1
- S1 is a score event (score < 10)
- SS1 is a sentence similarity event
- Initially S1 is true (score = 5)
- User makes positive events occur, score becomes 50
- S1 should now be false (50 is not < 10)
- C1 should NOT trigger when SS1 becomes true, because S1 is false
"""

from unittest.mock import MagicMock

import pytest

from app.core.constants import (
    ConditionOperator,
    DetectionType,
    ExpressionType,
    VisibilityType,
)
from app.core.events.base import BaseEvent
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.events.event_types.combination.combination_event import CombinationEvent
from app.core.events.event_types.combination.constants import (
    CombinationData,
    ExpressionNode,
)
from app.core.events.event_types.score.constants import ScoreData
from app.core.events.event_types.score.score_event import ScoreEvent
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
    """Helper to create a Scenario."""
    scenario = MagicMock(spec=Scenario)
    scenario.events = events

    if trigger_events_whitelist is not None:
        scenario.trigger_events = trigger_events_whitelist
    else:
        scenario.trigger_events = [e.event_id for e in events]

    scenario.termination_events = []
    return scenario


class TestCombinationScoreBugFix:
    """
    Test that score-based events in combination events are properly re-evaluated
    when the score changes.
    """

    def test_combination_with_score_event_reevaluates_when_score_changes(
        self, mock_room, thread_id
    ):
        """
        Test the bug fix: Combination event should not trigger when score
        condition is no longer met.
        """
        # Create S1: score < 10
        s1 = ScoreEvent.create(
            event_id="S1",
            data=ScoreData(score=10, condition=ConditionOperator.LT),
            visibility_type=VisibilityType.ACTIVE,
        )

        # Create SS1: sentence similarity event (mocked)
        ss1 = MagicMock(spec=BaseEvent)
        ss1.event_id = "SS1"
        ss1.score = 0
        ss1.detection_type = DetectionType.SENTENCE_SIMILARITY
        ss1.branching_instruction = None
        ss1.detection_config = MagicMock()
        ss1.detection_config.occurrence_interval = None

        # Create C1: S1 AND SS1
        c1 = CombinationEvent.create(
            event_id="C1",
            data=CombinationData(
                dependent_events=["S1", "SS1"],
                expression=ExpressionNode(
                    type=ExpressionType.AND,
                    left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="S1"),
                    right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="SS1"),
                ),
            ),
            visibility_type=VisibilityType.ACTIVE,
        )

        events = [s1, ss1, c1]
        scenario = create_test_scenario(events)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Step 1: Initially score = 5, S1 should be true
        orchestrator.score_keeper._event_score = 5
        triggered = orchestrator.get_newly_triggered_score_events(5, elapsed_time=0.0)
        assert "S1" in triggered
        assert orchestrator.get_event_state("S1") is True

        # Step 2: Score increases to 50, S1 should become false
        orchestrator.score_keeper._event_score = 50
        triggered = orchestrator.get_newly_triggered_score_events(50, elapsed_time=10.0)
        assert "S1" not in triggered  # Not newly triggered
        assert orchestrator.get_event_state("S1") is False  # Should be false now

        # Step 3: SS1 becomes true
        orchestrator.set_event_state("SS1", True, DetectionType.SENTENCE_SIMILARITY)

        # Step 4: Update registry to evaluate combination expression
        orchestrator.update(detected_event_ids={"SS1"})

        # Step 5: C1 should NOT be true because S1 is false
        assert orchestrator.get_event_state("C1") is False

    def test_combination_with_score_event_triggers_when_both_conditions_met(
        self, mock_room, thread_id
    ):
        """
        Test that combination event DOES trigger when both conditions are met.
        """
        # Create S1: score < 10
        s1 = ScoreEvent.create(
            event_id="S1",
            data=ScoreData(score=10, condition=ConditionOperator.LT),
            visibility_type=VisibilityType.ACTIVE,
        )

        # Create SS1: sentence similarity event (mocked)
        ss1 = MagicMock(spec=BaseEvent)
        ss1.event_id = "SS1"
        ss1.score = 0
        ss1.detection_type = DetectionType.SENTENCE_SIMILARITY
        ss1.branching_instruction = None
        ss1.detection_config = MagicMock()
        ss1.detection_config.occurrence_interval = None

        # Create C1: S1 AND SS1
        c1 = CombinationEvent.create(
            event_id="C1",
            data=CombinationData(
                dependent_events=["S1", "SS1"],
                expression=ExpressionNode(
                    type=ExpressionType.AND,
                    left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="S1"),
                    right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="SS1"),
                ),
            ),
            visibility_type=VisibilityType.ACTIVE,
        )

        events = [s1, ss1, c1]
        scenario = create_test_scenario(events)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Step 1: Score = 5, S1 should be true
        orchestrator.live_score = 5
        triggered = orchestrator.get_newly_triggered_score_events(5, elapsed_time=0.0)
        assert "S1" in triggered
        assert orchestrator.get_event_state("S1") is True

        # Step 2: SS1 becomes true
        orchestrator.set_event_state("SS1", True, DetectionType.SENTENCE_SIMILARITY)

        # Step 3: Update orchestrator to evaluate combination expression
        orchestrator.update(detected_event_ids={"SS1"})

        # Step 4: C1 SHOULD be true because both S1 and SS1 are true
        assert orchestrator.get_event_state("C1") is True

    def test_score_event_state_changes_with_score_fluctuations(
        self, mock_room, thread_id
    ):
        """
        Test that score event state changes correctly as score fluctuates.
        """
        # Create S1: score < 10
        s1 = ScoreEvent.create(
            event_id="S1",
            data=ScoreData(score=10, condition=ConditionOperator.LT),
            visibility_type=VisibilityType.ACTIVE,
        )

        events = [s1]
        scenario = create_test_scenario(events)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Score = 5, S1 should be true
        triggered = orchestrator.get_newly_triggered_score_events(5, elapsed_time=0.0)
        assert "S1" in triggered
        assert orchestrator.get_event_state("S1") is True

        # Score = 50, S1 should be false
        triggered = orchestrator.get_newly_triggered_score_events(50, elapsed_time=10.0)
        assert "S1" not in triggered
        assert orchestrator.get_event_state("S1") is False

        # Score = 3, S1 should be true again (but not newly triggered since it was sent)
        triggered = orchestrator.get_newly_triggered_score_events(3, elapsed_time=20.0)
        assert orchestrator.get_event_state("S1") is True

    def test_sent_score_event_state_updates_for_combination_events(
        self, mock_room, thread_id
    ):
        """
        Test that score events that were already sent still get their state updated
        for combination event evaluation.
        """
        # Create S1: score < 10
        s1 = ScoreEvent.create(
            event_id="S1",
            data=ScoreData(score=10, condition=ConditionOperator.LT),
            visibility_type=VisibilityType.ACTIVE,
        )

        # Create SS1: sentence similarity event (mocked)
        ss1 = MagicMock(spec=BaseEvent)
        ss1.event_id = "SS1"
        ss1.score = 0
        ss1.detection_type = DetectionType.SENTENCE_SIMILARITY
        ss1.branching_instruction = None
        ss1.detection_config = MagicMock()
        ss1.detection_config.occurrence_interval = None

        # Create C1: S1 AND SS1
        c1 = CombinationEvent.create(
            event_id="C1",
            data=CombinationData(
                dependent_events=["S1", "SS1"],
                expression=ExpressionNode(
                    type=ExpressionType.AND,
                    left=ExpressionNode(type=ExpressionType.IDENTIFIER, id="S1"),
                    right=ExpressionNode(type=ExpressionType.IDENTIFIER, id="SS1"),
                ),
            ),
            visibility_type=VisibilityType.ACTIVE,
        )

        events = [s1, ss1, c1]
        scenario = create_test_scenario(events)
        orchestrator = EventOrchestrator(scenario, mock_room, thread_id)

        # Step 1: Score = 5, S1 should trigger
        orchestrator.live_score = 5
        triggered = orchestrator.get_newly_triggered_score_events(5, elapsed_time=0.0)
        assert "S1" in triggered
        assert orchestrator.get_event_state("S1") is True

        # Step 2: Simulate S1 being sent (add to _sent_events)
        orchestrator._sent_events.add("S1")

        # Step 3: Score increases to 50, S1 condition no longer met
        # Even though S1 is in _sent_events, its state should be updated to False
        orchestrator.live_score = 50
        triggered = orchestrator.get_newly_triggered_score_events(50, elapsed_time=10.0)
        assert "S1" not in triggered  # Not newly triggered (already sent)
        assert orchestrator.get_event_state("S1") is False  # CRITICAL: Should be False

        # Step 4: SS1 becomes true
        orchestrator.set_event_state("SS1", True, DetectionType.SENTENCE_SIMILARITY)

        # Step 5: Update orchestrator to evaluate combination expression
        orchestrator.update(detected_event_ids={"SS1"})

        # Step 6: C1 should NOT be true because S1 is false
        assert orchestrator.get_event_state("C1") is False
