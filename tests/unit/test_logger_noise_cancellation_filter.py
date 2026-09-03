"""Krisp-BVC-rejection log demotion — app/core/logger.py.

The Rust FFI bridges its own logs into ``logging.getLogger("livekit")``
(``livekit.rtc._ffi_client.ffi_event_callback``) at ERROR when a self-hosted
deployment refuses the Krisp BVC filter:

    livekit_ffi::server::room - audio filter cannot be enabled:
        LiveKit Cloud is required

That refusal is expected on our self-hosted LiveKit (see
app/core/livekit/audio_filters.py) and leaves the session running unfiltered
with zero user-facing impact, so it must not surface as an internal error —
whether our own gate is bypassed by an operator flag or anything else asks
for the filter on a deployment that cannot honor it.
"""

import logging

import pytest

from app.core.logger import BenignNoiseCancellationFilter


def _ffi_bridged_record(message: str, level: int = logging.ERROR) -> logging.LogRecord:
    """A record shaped like ffi_event_callback's ``logger.log(level, ...)``."""
    return logging.LogRecord(
        name="livekit",
        level=level,
        pathname="",
        lineno=0,
        msg="%s:%s:%s - %s",
        args=("livekit_ffi::server::room", 42, "server/room.rs", message),
        exc_info=None,
    )


@pytest.mark.unit
class TestBenignNoiseCancellationFilter:
    def test_demotes_the_known_ffi_rejection_to_info(self):
        record = _ffi_bridged_record(
            "audio filter cannot be enabled: LiveKit Cloud is required"
        )

        assert BenignNoiseCancellationFilter().filter(record) is True

        assert record.levelno == logging.INFO
        assert record.levelname == "INFO"

    def test_demotes_the_companion_initialize_failure(self):
        record = _ffi_bridged_record(
            "failed to initialize the audio filter. it will not be enabled "
            "for this session."
        )

        assert BenignNoiseCancellationFilter().filter(record) is True

        assert record.levelno == logging.INFO

    def test_leaves_unrelated_livekit_errors_at_their_original_level(self):
        record = _ffi_bridged_record("participant disconnected unexpectedly")

        assert BenignNoiseCancellationFilter().filter(record) is True

        assert record.levelno == logging.ERROR
        assert record.levelname == "ERROR"


@pytest.mark.unit
def test_the_livekit_logger_is_configured_with_the_filter_end_to_end():
    """The wiring, not just the filter class: a record emitted through the
    real ``livekit`` logger must reach handlers already demoted to INFO."""
    livekit_logger = logging.getLogger("livekit")
    captured: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    probe = _Capture()
    livekit_logger.addHandler(probe)
    try:
        livekit_logger.error(
            "%s:%s:%s - %s",
            "livekit_ffi::server::room",
            42,
            "server/room.rs",
            "audio filter cannot be enabled: LiveKit Cloud is required",
        )
    finally:
        livekit_logger.removeHandler(probe)

    assert len(captured) == 1
    assert captured[0].levelname == "INFO"
