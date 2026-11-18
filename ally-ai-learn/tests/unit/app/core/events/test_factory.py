from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from app.core.constants import DetectionType
from app.core.events.factory import (
    _create_event_by_detection_type,
    build_events_from_metadata,
)


@patch("app.core.events.factory.get_logger")
def test_create_event_by_detection_type_handles_time_event_validation_error(
    mock_get_logger,
):
    """
    Test that _create_event_by_detection_type catches ValidationError for TIME events
    and logs a specific warning.
    """
    # Arrange
    mock_logger = MagicMock()
    mock_get_logger.return_value = mock_logger

    invalid_time_event_data = {
        "id": "time-event-1",
        "detectionType": "TIME",
        "data": {"time": "not-a-float"},  # This should cause a ValidationError
    }
    detection_type = DetectionType.TIME

    # Act
    result = _create_event_by_detection_type(
        ev=invalid_time_event_data, detection_type=detection_type, logger=mock_logger
    )

    # Assert
    assert result is None
    mock_logger.warning.assert_called_once()
    call_args, _ = mock_logger.warning.call_args
    assert call_args[0] == "Event '%s' (TIME) invalid data: %s"
    assert call_args[1] == "time-event-1"
    assert isinstance(call_args[2], ValidationError)


@patch("app.core.events.factory.get_logger")
def test_build_events_from_metadata_with_invalid_score_data(mock_get_logger):
    """
    Test that build_events_from_metadata gracefully handles an event with
    invalid data that would cause a Pydantic validation error.
    """
    # Arrange
    mock_logger = MagicMock()
    mock_get_logger.return_value = mock_logger

    metadata = {
        "events": [
            {
                "id": "score-event-1",
                "detectionType": "SCORE",
                "data": {
                    "score_type": "some_type",
                    "min_score": "not-an-int",  # Invalid data
                },
            }
        ]
    }

    # Act
    events = build_events_from_metadata(metadata, on_unknown="warn", logger=mock_logger)

    # Assert
    assert len(events) == 0

    # Check that a warning was logged about the skipped event
    log_calls = mock_logger.warning.call_args_list

    # Check for the specific validation error log inside the factory helper
    found_invalid_data_log = False
    for call in log_calls:
        if (
            call[0][0] == "Event '%s' (SCORE) invalid data: %s"
            and call[0][1] == "score-event-1"
        ):
            assert isinstance(call[0][2], ValidationError)
            found_invalid_data_log = True
            break
    assert (
        found_invalid_data_log
    ), "A specific validation error should have been logged."

    # Check that the event was marked as skipped in the summary
    found_skipped_log = False
    for call in log_calls:
        if call[0][0] == "Event '%s' skipped: %s" and call[0][1] == "score-event-1":
            found_skipped_log = True
            break
    assert found_skipped_log, "A summary ''skipped'' message should have been logged."
