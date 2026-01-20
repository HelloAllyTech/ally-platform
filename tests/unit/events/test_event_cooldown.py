from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.core.constants import DetectionType
from app.core.events.base import BaseEvent
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.graph.utils import is_event_eligible

# -----------------------------------------------------------------------------
# Mocks & Fixtures
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
    # Ensure we can instantiate the class we imported
    return EventOrchestrator(
        scenario=mock_scenario,
        room=mock_room,
        thread_id="test_thread",
        termination_callback=None,
    )


@pytest.fixture
def mock_event():
    event = MagicMock(spec=BaseEvent)
    event.event_id = "test_event_01"
    event.detection_type = DetectionType.SENTENCE_SIMILARITY

    config = MagicMock()
    config.start_time = None
    config.end_time = None
    config.min_score = None
    config.max_score = None
    config.min_gap_time = 10.0
    config.max_occurrences = None

    event.detection_config = config
    return event


# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------


def test_orchestrator_updates_timestamp_on_first_occurrence(orchestrator):
    event_id = "test_event_01"

    orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)

    entry = orchestrator.event_registry[event_id]

    assert entry.happened is True
    assert isinstance(entry.occurred_at, datetime)


def test_orchestrator_updates_timestamp_on_subsequent_occurrence(orchestrator):
    event_id = "test_event_01"

    # 1. Trigger First Time
    t0 = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

    path_to_patch = f"{EventOrchestrator.__module__}.datetime"

    with patch(path_to_patch) as mock_dt:
        mock_dt.now.return_value = t0
        mock_dt.timezone = timezone
        orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)

        entry_t0 = orchestrator.event_registry[event_id].occurred_at
        assert entry_t0 == t0

    # 2. Trigger Second Time
    t1 = t0 + timedelta(minutes=1)
    with patch(path_to_patch) as mock_dt:
        mock_dt.now.return_value = t1
        mock_dt.timezone = timezone
        orchestrator.set_event_state(event_id, True, DetectionType.SENTENCE_SIMILARITY)

        entry_t1 = orchestrator.event_registry[event_id].occurred_at

        assert entry_t1 == t1
        assert entry_t1 > entry_t0


def test_is_event_in_window_cooldown_logic(mock_event):
    now = datetime.now(timezone.utc)
    elapsed_time = 100.0
    current_score = 0

    # Case 1: Never happened before -> PASS
    assert is_event_eligible(mock_event, elapsed_time, current_score, None) is True

    # Case 2: Happened 5s ago (Gap 10s) -> FAIL
    last_run_recent = now - timedelta(seconds=5)

    # We dynamically find the module of the function to be safe
    module_name = is_event_eligible.__module__

    patch_target = (
        f"{module_name}.dt"  # Reverting to dt based on your snippet 'dt.datetime'
    )

    with patch(patch_target) as mock_scheduler_dt:
        # Mocking the datetime class inside the module
        mock_scheduler_dt.datetime.now.return_value = now
        mock_scheduler_dt.timezone.utc = timezone.utc

        assert (
            is_event_eligible(mock_event, elapsed_time, current_score, last_run_recent)
            is False
        )

    # Case 3: Happened 15s ago (Gap 10s) -> PASS
    last_run_old = now - timedelta(seconds=15)
    with patch(patch_target) as mock_scheduler_dt:
        mock_scheduler_dt.datetime.now.return_value = now
        mock_scheduler_dt.timezone.utc = timezone.utc

        assert (
            is_event_eligible(mock_event, elapsed_time, current_score, last_run_old)
            is True
        )


def test_integration_flow(orchestrator, mock_event):
    # 1. First Pass -> Valid
    last_occurred = orchestrator.get_last_occurred_at(mock_event.event_id)
    assert is_event_eligible(mock_event, 100, 0, last_occurred) is True

    # 2. Trigger
    orchestrator.set_event_state(
        mock_event.event_id, True, DetectionType.SENTENCE_SIMILARITY
    )

    # 3. Second Pass -> Invalid (Cooldown)
    last_occurred = orchestrator.get_last_occurred_at(mock_event.event_id)
    assert last_occurred is not None

    module_name = is_event_eligible.__module__
    patch_target = f"{module_name}.dt"

    with patch(patch_target) as mock_dt:
        mock_dt.datetime.now.return_value = last_occurred + timedelta(seconds=1)
        mock_dt.timezone.utc = timezone.utc
        assert is_event_eligible(mock_event, 100, 0, last_occurred) is False
