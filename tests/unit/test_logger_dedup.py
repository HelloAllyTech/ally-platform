"""Unit tests for the LiveKit multi-process log de-dup helpers in
app/core/logger.py. See that module for the full duplication mechanism."""

import logging

import app.core.logger as L


def _restore(root, saved):
    root.handlers[:] = saved


def test_strip_foreign_root_handlers_keeps_only_ours():
    """Our tagged handler survives; a foreign (untagged) stdout handler — like
    the one LiveKit's setup_logging adds — is removed regardless of formatter."""
    root = logging.getLogger()
    saved = list(root.handlers)
    try:
        ours = logging.StreamHandler()
        ours._ally_primary = True  # type: ignore[attr-defined]
        foreign = logging.StreamHandler()  # untagged (simulates LiveKit's)
        root.handlers[:] = [ours, foreign]

        L._strip_foreign_root_handlers()

        assert root.handlers == [ours]
    finally:
        _restore(root, saved)


def test_patch_livekit_parent_logger_adds_no_handler():
    """After patching, LiveKit's _configure_logger only sets the level — it must
    not add a second stdout handler to root (the un-stripped parent duplicate)."""
    import livekit.agents.cli.cli as lkcli

    original = lkcli._configure_logger
    root = logging.getLogger()
    saved = list(root.handlers)
    try:
        L.patch_livekit_parent_logger()
        before = len(root.handlers)
        lkcli._configure_logger(None, "INFO")  # what run_app calls
        assert len(root.handlers) == before
    finally:
        lkcli._configure_logger = original
        _restore(root, saved)
