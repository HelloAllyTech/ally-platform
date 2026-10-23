"""create_clip_tts: clip rendering must get an ISOLATED TTS instance.

The AgentSession subscribes to its own TTS instance's error events and closes
the whole session after a few unrecoverable ones — so clip synthesis sharing
that instance can kill a live session (prod Marathi outage, 2026-08-20).

These stubs cover the base-class mechanics (policy gate, logging, cleanup on
failure). The real provider clients are covered by test_tts_clip_real_clients.
"""

import logging

import pytest

from app.tts.base import BaseTTSClient


class _Instance:
    """A plugin-shaped TTS instance that records whether it was closed."""

    def __init__(self):
        self.closed = False

    async def aclose(self):
        self.closed = True


class _StubClient(BaseTTSClient):
    """Minimal client following the lazy _tts_instance pattern."""

    def __init__(self, allowed=True):
        super().__init__()
        self._tts_instance = None
        self._allowed = allowed
        self.builds = 0
        self.built = []

    def allows_clip_synthesis(self) -> bool:
        return self._allowed

    @property
    def tts_instance(self):
        if self._tts_instance is None:
            self.builds += 1
            self._tts_instance = _Instance()
            self.built.append(self._tts_instance)
        return self._tts_instance


class _NoLazyClient(BaseTTSClient):
    """Client without the lazy attribute — isolation impossible."""

    def allows_clip_synthesis(self) -> bool:
        return True

    @property
    def tts_instance(self):
        return object()


class _FailingApplyClient(_StubClient):
    """Builds its instance, then fails applying stored parameters."""

    def _apply_parameters_dict(self, params_dict):
        raise RuntimeError("update_options rejected")


class _NoBaseInitClient(BaseTTSClient):
    """The d35bb31 shape: a client that never calls super().__init__()."""

    def __init__(self):
        self._tts_instance = None

    def allows_clip_synthesis(self) -> bool:
        return True

    @property
    def tts_instance(self):
        if self._tts_instance is None:
            self._tts_instance = _Instance()
        return self._tts_instance


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
    assert _NoLazyClient().can_create_clip_tts() is False


@pytest.mark.unit
def test_client_without_base_init_still_gets_clips():
    """A missing _current_params must not disable clips (the d35bb31 bug)."""
    client = _NoBaseInitClient()
    session_instance = client.tts_instance
    clip = client.create_clip_tts()
    assert clip is not None
    assert clip is not session_instance


@pytest.mark.unit
def test_base_default_fails_closed():
    class _Unclassified(BaseTTSClient):
        def __init__(self):
            super().__init__()
            self._tts_instance = None

        @property
        def tts_instance(self):
            return object()

    client = _Unclassified()
    assert client.allows_clip_synthesis() is False
    assert client.can_create_clip_tts() is False
    assert client.create_clip_tts() is None


@pytest.mark.unit
def test_policy_refusal_builds_nothing_and_logs_once(caplog):
    client = _StubClient(allowed=False)
    _ = client.tts_instance
    with caplog.at_level(logging.INFO, logger="app.tts.base"):
        assert client.can_create_clip_tts() is False
        assert client.create_clip_tts() is None
        assert client.create_clip_tts() is None

    assert client.builds == 1  # only the session's own instance
    refusals = [r for r in caplog.records if "reason=generative_voice" in r.message]
    assert len(refusals) == 1
    assert refusals[0].levelno == logging.INFO


@pytest.mark.unit
def test_failure_after_build_logs_warning_and_closes_the_instance(caplog):
    client = _FailingApplyClient()
    session_instance = client.tts_instance
    client._current_params["speed"] = 1.1

    with caplog.at_level(logging.WARNING, logger="app.tts.base"):
        assert client.create_clip_tts() is None

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert warnings and warnings[0].exc_info is not None
    orphan = client.built[-1]
    assert orphan is not session_instance
    assert orphan.closed is True
    assert session_instance.closed is False


@pytest.mark.unit
async def test_failure_inside_a_running_loop_closes_in_the_background():
    import asyncio

    client = _FailingApplyClient()
    session_instance = client.tts_instance
    client._current_params["speed"] = 1.1

    assert client.create_clip_tts() is None
    await asyncio.sleep(0)

    assert client.built[-1].closed is True
    assert session_instance.closed is False
