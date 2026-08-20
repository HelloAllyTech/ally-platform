"""create_clip_tts: clip rendering must get an ISOLATED TTS instance.

The AgentSession subscribes to its own TTS instance's error events and closes
the whole session after a few unrecoverable ones — so clip synthesis sharing
that instance can kill a live session (prod Marathi outage, 2026-08-20).
"""

import pytest

from app.tts.base import BaseTTSClient


class _StubClient(BaseTTSClient):
    """Minimal client following the lazy _tts_instance pattern."""

    def __init__(self):
        super().__init__()
        self._tts_instance = None
        self.builds = 0

    @property
    def tts_instance(self):
        if self._tts_instance is None:
            self.builds += 1
            self._tts_instance = object()
        return self._tts_instance


class _NoLazyClient(BaseTTSClient):
    """Client without the lazy attribute — isolation impossible."""

    @property
    def tts_instance(self):
        return object()


@pytest.mark.unit
def test_clip_tts_is_a_distinct_instance():
    client = _StubClient()
    session_instance = client.tts_instance
    clip_instance = client.create_clip_tts()
    assert clip_instance is not None
    assert clip_instance is not session_instance
    # The session's own instance is untouched by the clone.
    assert client.tts_instance is session_instance


@pytest.mark.unit
def test_clip_tts_returns_none_when_not_isolatable():
    assert _NoLazyClient().create_clip_tts() is None
