import pytest

from app.core.events.factory import build_events_from_metadata, UnknownEventIdError
from app.core.events.event_list.similarity_based.generic import GenericSimilarityEvent
from app.core.constants import VisibilityType


class DummyLogger:
    def __init__(self):
        self.warnings = []
        self.errors = []

    def warning(self, msg, *args):
        self.warnings.append(msg % args if args else msg)

    def error(self, msg, *args):
        self.errors.append(msg % args if args else msg)


class TestEventsFactory:
    def test_build_events_happy_path_creates_generic_similarity_events(self):
        metadata = {
            "id": "scenario-1",
            "events": [
                {
                    "id": "E1",
                    "sentences": ["hello there", "slow down"],
                    "score": 5,
                    "emoji": ":)",
                    "message": "good",
                    "branchInstruction": "X",
                    "visibilityType": VisibilityType.ACTIVE,
                },
                {
                    "id": "E2",
                    "sentences": [],  # allowed
                    "score": -1,
                },
            ]
        }

        evs = build_events_from_metadata(metadata)
        assert len(evs) == 2
        assert all(isinstance(e, GenericSimilarityEvent) for e in evs)
        assert evs[0].event_id == "E1" and evs[0].visibility_type == VisibilityType.ACTIVE
        assert evs[1].event_id == "E2" and evs[1].sentences == []

    def test_build_events_invalid_sentences_type_skips_and_warns(self):
        logger = DummyLogger()
        metadata = {
            "events": [
                {"id": "A", "sentences": "not-a-list"},
                {"id": "B", "sentences": ["ok"]},
            ]
        }

        evs = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        # Only B should be created
        assert len(evs) == 1 and evs[0].event_id == "B"
        assert any("invalid sentences field" in w for w in logger.warnings)

    def test_build_events_missing_sentences_raises_when_error_mode(self):
        metadata = {
            "events": [
                {"id": "X"},  # no sentences field
                {"id": "Y", "sentences": ["ok"]},
            ]
        }

        with pytest.raises(UnknownEventIdError) as exc:
            build_events_from_metadata(metadata, on_unknown="error")

        assert exc.value.unknown_ids == ["X"]

    def test_build_events_missing_sentences_warn_mode_collects_unknown_ids(self):
        logger = DummyLogger()
        metadata = {"events": [{"id": "X"}]}
        evs = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert evs == []
        assert any("no sentences field" in w for w in logger.warnings)
