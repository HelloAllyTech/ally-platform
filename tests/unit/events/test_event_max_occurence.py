from unittest.mock import MagicMock

import pytest

from app.core.constants import DetectionType
from app.core.events.base import BaseEvent
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.graph.utils import is_event_eligible

# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------


@pytest.fixture
def mock_room():
    return MagicMock()


@pytest.fixture
def mock_scenario():
    scenario = MagicMock()
    scenario.events = []
    scenario.trigger_events = []
    scenario.termination_events = []
    return scenario


@pytest.fixture
def orchestrator(mock_scenario, mock_room):
    return EventOrchestrator(
        scenario=mock_scenario,
        room=mock_room,
        thread_id="test_thread",
        termination_callback=None,
    )


@pytest.fixture
def limited_event():
    """Creates an event allowed to happen MAX 2 times."""
    event = MagicMock(spec=BaseEvent)
    event.event_id = "event_limit_2"
    event.detection_type = DetectionType.SENTENCE_SIMILARITY

    config = MagicMock()
    config.start_time = None
    config.end_time = None
    config.min_score = None
    config.max_score = None
    config.min_gap_time = None
    config.max_occurrences = 2
    config.occurrence_interval = None

    event.detection_config = config
    return event


# -----------------------------------------------------------------------------
# Tests: Orchestrator Logic (Counting)
# -----------------------------------------------------------------------------


def test_orchestrator_initializes_count_to_zero(orchestrator):
    """Verify new events start with occurrence_count = 0."""
    event_id = "new_event"

    # Manually adding to registry to simulate initialization
    from app.core.events.schemas import EventRegistryEntry

    orchestrator.event_registry[event_id] = EventRegistryEntry(
        happened=False,
        trigger_multiple=True,
        occurred_at=None,
        occurrence_count=0,
    )

    assert orchestrator.get_occurrence_count(event_id) == 0


def test_orchestrator_increments_count_on_occurrence(orchestrator):
    """Verify count goes up only when state is set to True."""
    event_id = "test_counter"

    # 1. Trigger Event (True)
    orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)
    assert orchestrator.get_occurrence_count(event_id) == 1

    # 2. Trigger Event Again (True)
    orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)
    assert orchestrator.get_occurrence_count(event_id) == 2


def test_orchestrator_does_not_increment_on_false(orchestrator):
    """Verify count stays same if we just update state to False."""
    event_id = "test_counter_false"

    # 1. Trigger Event (True) -> Count = 1
    orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)
    assert orchestrator.get_occurrence_count(event_id) == 1

    # 2. Set State to False (e.g., reset) -> Count should still be 1
    orchestrator.set_event_state(event_id, False, DetectionType.SENTENCE_SIMILARITY)
    assert orchestrator.get_occurrence_count(event_id) == 1


# -----------------------------------------------------------------------------
# Tests: Window Logic (Checking Constraints)
# -----------------------------------------------------------------------------


def test_is_event_eligible_respects_max_occurrences(limited_event):
    """Test the checker logic in isolation."""
    # args: event, elapsed_time, current_score, last_occurred_at, occurrence_count

    # Case 1: Count is 0 (Allowed)
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=0) is True

    # Case 2: Count is 1 (Allowed)
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=1) is True

    # Case 3: Count is 2 (Blocked - Limit Reached)
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=2) is False

    # Case 4: Count is 3 (Blocked - Limit Exceeded)
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=3) is False


def test_is_event_eligible_ignores_limit_if_none(limited_event):
    """Test that events with no limit set always pass the count check."""
    limited_event.detection_config.max_occurrences = None

    # Even if count is high, it should pass
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=50) is True


# -----------------------------------------------------------------------------
# Tests: Integration (Full Flow)
# -----------------------------------------------------------------------------


def test_integration_limit_flow(orchestrator, limited_event):
    """
    Simulate the full lifecycle:
    Check Eligibility -> Trigger -> Check Eligibility again.
    """
    event_id = limited_event.event_id

    # --- Round 1 ---
    # 1. Check if eligible (Current count 0)
    count = orchestrator.get_occurrence_count(event_id)  # 0
    assert is_event_eligible(limited_event, 10, 0, None, count) is True

    # 2. Trigger it
    orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)

    # --- Round 2 ---
    # 1. Check if eligible (Current count 1)
    count = orchestrator.get_occurrence_count(event_id)  # 1
    assert is_event_eligible(limited_event, 20, 0, None, count) is True

    # 2. Trigger it
    orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)

    # --- Round 3 ---
    # 1. Check if eligible (Current count 2) -> SHOULD FAIL
    count = orchestrator.get_occurrence_count(event_id)  # 2
    assert is_event_eligible(limited_event, 30, 0, None, count) is False


def test_is_event_eligible_respects_zero_max_occurrences(limited_event):
    """Test that max_occurrences=0 effectively disables the event."""
    # Set limit to 0
    limited_event.detection_config.max_occurrences = 0

    # Case 1: Count is 0 (Blocked - Limit Reached immediately)
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=0) is False

    # Case 2: Count is 1 (Blocked - Limit Exceeded)
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=1) is False


def test_is_event_eligible_ignores_occurrence_interval(limited_event):
    """is_event_eligible no longer gates on occurrence_interval.
    Interval logic lives in the orchestrator via detection_count."""
    limited_event.detection_config.max_occurrences = None

    # interval=None: passes as expected
    limited_event.detection_config.occurrence_interval = None
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=0) is True

    # interval=3: also passes — is_event_eligible does not check interval
    limited_event.detection_config.occurrence_interval = 3
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=0) is True
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=1) is True
    assert is_event_eligible(limited_event, 100, 0, None, occurrence_count=2) is True


def test_orchestrator_detection_count_is_independent_of_occurrence_count(orchestrator):
    """detection_count tracks every detection; occurrence_count only tracks
    actual fires. The two are independent so occurrence_interval can gate firing
    without deadlocking.
    """
    from app.core.events.schemas import EventRegistryEntry

    event_id = "interval_event"
    orchestrator.event_registry[event_id] = EventRegistryEntry(
        happened=False,
        trigger_multiple=True,
        occurred_at=None,
        occurrence_count=0,
        detection_count=0,
    )

    # Simulate 3 raw detections without firing (interval suppressed first two)
    orchestrator.event_registry[event_id].detection_count += 1
    assert orchestrator.get_detection_count(event_id) == 1
    assert orchestrator.get_occurrence_count(event_id) == 0

    orchestrator.event_registry[event_id].detection_count += 1
    assert orchestrator.get_detection_count(event_id) == 2
    assert orchestrator.get_occurrence_count(event_id) == 0

    # 3rd detection: fires → occurrence_count increments too
    orchestrator.event_registry[event_id].detection_count += 1
    orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)
    assert orchestrator.get_detection_count(event_id) == 3
    assert orchestrator.get_occurrence_count(event_id) == 1
