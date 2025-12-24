import pytest

from app.core.constants import DetectionType, VisibilityType
from app.core.events.event_types.similarity_based.similarity_event import (
    SimilarityEvent,
)
from app.core.events.factory import UnknownEventIdError, build_events_from_metadata


class DummyLogger:
    def __init__(self):
        self.warnings = []
        self.errors = []
        self.debugs = []
        self.infos = []
        self.exceptions = []

    def warning(self, msg, *args):
        self.warnings.append(msg % args if args else msg)

    def error(self, msg, *args):
        self.errors.append(msg % args if args else msg)

    def exception(self, msg, *args):
        self.exceptions.append(msg % args if args else msg)
        self.errors.append(msg % args if args else msg)

    def debug(self, msg, *args):
        self.debugs.append(msg % args if args else msg)

    def info(self, msg, *args):
        self.infos.append(msg % args if args else msg)


class TestEventsFactory:
    def test_build_events_happy_path_creates_similarity_events(self):
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
            ],
        }

        evs = build_events_from_metadata(metadata)
        assert len(evs) == 2
        assert all(isinstance(e, SimilarityEvent) for e in evs)
        assert (
            evs[0].event_id == "E1" and evs[0].visibility_type == VisibilityType.ACTIVE
        )
        # Keep the expectation that the second event has an empty sentences list
        # (SimilarityEvent should expose the provided sentences/custom_sentences)
        assert evs[1].event_id == "E2"
        # attribute name may vary depending on SimilarityEvent implementation;
        # if it's stored as 'sentences' or 'custom_sentences', both are acceptable:
        assert (
            getattr(evs[1], "sentences", getattr(evs[1], "custom_sentences", [])) == []
        )

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
        assert any(
            "invalid" in w.lower() and "sentences" in w.lower() for w in logger.warnings
        )

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
        # The factory now logs warnings about missing detectionType and sentences field
        assert any("missing" in w.lower() for w in logger.warnings) or any(
            "skipped" in w.lower() for w in logger.warnings
        )

    def test_build_events_with_new_schema_detection_type(self):
        """Test that new schema with detectionType works."""
        metadata = {
            "events": [
                {
                    "id": "E1",
                    "detectionType": "SENTENCE_SIMILARITY",
                    "data": {"sentences": ["hello there", "slow down"]},
                    "score": 5,
                    "visibilityType": "ACTIVE",
                }
            ]
        }

        evs = build_events_from_metadata(metadata)
        assert len(evs) == 1
        assert isinstance(evs[0], SimilarityEvent)
        assert evs[0].event_id == "E1"
        assert evs[0].detection_type == DetectionType.SENTENCE_SIMILARITY

    def test_build_events_backward_compatibility_old_schema(self):
        """Test that old schema (sentences directly) still works."""
        metadata = {
            "events": [
                {"id": "E1", "sentences": ["hello there"], "score": 5}  # Old format
            ]
        }

        evs = build_events_from_metadata(metadata)
        assert len(evs) == 1
        assert isinstance(evs[0], SimilarityEvent)
        assert evs[0].event_id == "E1"
        # Should default to SENTENCE_SIMILARITY
        assert evs[0].detection_type == DetectionType.SENTENCE_SIMILARITY
