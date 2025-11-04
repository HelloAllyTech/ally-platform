import pytest
from pydantic import ValidationError
from unittest.mock import patch

from app.schemas.events import CustomEvent, CustomEventData


class TestEventsSchema:
    @patch("app.schemas.events.get_current_iso_timestamp", return_value="2025-01-01T00:00:00Z")
    def test_custom_event_create_uses_current_timestamp_when_none(self, mock_now):
        ev = CustomEvent.create(score=5, emoji="👍", message="Great job!")

        assert ev.version == "1.0"
        assert ev.timestamp == "2025-01-01T00:00:00Z"
        assert ev.data.score == 5
        assert ev.data.emoji == "👍"
        assert ev.data.message == "Great job!"

    def test_custom_event_create_respects_explicit_timestamp(self):
        ev = CustomEvent.create(score=None, emoji="🙂", message="Hello", timestamp="2024-12-31T23:59:59Z")

        assert ev.version == "1.0"
        assert ev.timestamp == "2024-12-31T23:59:59Z"
        assert ev.data.score is None
        assert ev.data.emoji == "🙂"
        assert ev.data.message == "Hello"

    def test_custom_eventdata_validation_required_fields(self):
        # Valid minimal
        data = CustomEventData(emoji="😀", message="Hi")
        assert data.score is None
        assert data.emoji == "😀"
        assert data.message == "Hi"

        # Missing emoji
        with pytest.raises(ValidationError):
            CustomEventData(message="Hi")  # type: ignore[call-arg]

        # Missing message
        with pytest.raises(ValidationError):
            CustomEventData(emoji="😀")  # type: ignore[call-arg]

    def test_custom_event_direct_instantiation_defaults_version(self):
        ev = CustomEvent(
            data=CustomEventData(emoji="🔥", message="Boom"),
            timestamp="2025-02-02T02:02:02Z",
        )
        # version has default "1.0" per schema
        assert ev.version == "1.0"
        assert ev.data.emoji == "🔥"
        assert ev.timestamp == "2025-02-02T02:02:02Z"
