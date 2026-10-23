import pytest

from app.core.events.factory import build_events_from_metadata


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


def test_build_events_with_no_events_returns_empty():
    assert build_events_from_metadata({}) == []


def test_build_events_handles_exception_during_create_warns_and_skips(monkeypatch):
    from app.core.events.event_types.similarity_based import (
        similarity_event as generic_mod,
    )

    def boom(*args, **kwargs):  # noqa: ARG001
        raise ValueError("bad input")

    monkeypatch.setattr(generic_mod.SimilarityEvent, "create", classmethod(boom))
    logger = DummyLogger()

    metadata = {"events": [{"id": "E1", "sentences": ["hi"]}]}
    evs = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
    assert evs == []
    # Check for exception or error messages
    assert any(
        "failed" in e.lower() or "exception" in e.lower() for e in logger.errors
    ) or any(
        "failed" in e.lower() or "exception" in e.lower() for e in logger.exceptions
    )


def test_build_events_exception_in_error_mode_raises(monkeypatch):
    from app.core.events.event_types.similarity_based import (
        similarity_event as generic_mod,
    )

    def boom(*args, **kwargs):  # noqa: ARG001
        raise RuntimeError("explode")

    monkeypatch.setattr(generic_mod.SimilarityEvent, "create", classmethod(boom))

    metadata = {"events": [{"id": "E1", "sentences": ["hi"]}]}
    with pytest.raises(RuntimeError):
        build_events_from_metadata(metadata, on_unknown="error")
