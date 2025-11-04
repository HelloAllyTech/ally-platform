import pytest

from app.core.events.factory import build_events_from_metadata, UnknownEventIdError


class DummyLogger:
    def __init__(self):
        self.warnings = []
        self.errors = []

    def warning(self, msg, *args):
        self.warnings.append(msg % args if args else msg)

    def error(self, msg, *args):
        self.errors.append(msg % args if args else msg)


def test_build_events_with_no_events_returns_empty():
    assert build_events_from_metadata({}) == []


def test_build_events_handles_exception_during_create_warns_and_skips(monkeypatch):
    from app.core.events.event_list.similarity_based import generic as generic_mod

    def boom(*args, **kwargs):  # noqa: ARG001
        raise ValueError("bad input")

    monkeypatch.setattr(generic_mod.GenericSimilarityEvent, "create", classmethod(boom))
    logger = DummyLogger()

    metadata = {"events": [{"id": "E1", "sentences": ["hi"]}]}
    evs = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
    assert evs == []
    assert any("Failed to create event" in e for e in logger.errors)


def test_build_events_exception_in_error_mode_raises(monkeypatch):
    from app.core.events.event_list.similarity_based import generic as generic_mod

    def boom(*args, **kwargs):  # noqa: ARG001
        raise RuntimeError("explode")

    monkeypatch.setattr(generic_mod.GenericSimilarityEvent, "create", classmethod(boom))

    metadata = {"events": [{"id": "E1", "sentences": ["hi"]}]}
    with pytest.raises(RuntimeError):
        build_events_from_metadata(metadata, on_unknown="error")
