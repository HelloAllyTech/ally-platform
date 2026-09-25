"""The v2 NaturalnessController skips clip layers for a voice with no clip TTS.

Filler, back-channel and interim phrases are only ever heard as clips, so for a
voice the clip policy refuses (or that can't be isolated) the controller must
not publish those layers or pay for the LLM calls that write their phrases.
Mirrors the v1 worker's gate (tests/unit/test_worker.py).
"""

import asyncio
import types
from unittest.mock import AsyncMock, Mock

import pytest

from app.core.livekit.naturalness import NaturalnessController


class _RecordingSession:
    def __init__(self):
        self.handlers = {}

    def on(self, event):
        def decorator(fn):
            self.handlers.setdefault(event, []).append(fn)
            return fn

        return decorator


def _controller(clips: bool) -> NaturalnessController:
    return NaturalnessController(
        room=types.SimpleNamespace(name="room-1"),
        session=_RecordingSession(),
        tts_client=types.SimpleNamespace(
            tts_instance="TTS", can_create_clip_tts=lambda: clips
        ),
        llm_client=Mock(),
        scenario=types.SimpleNamespace(prompt_data=types.SimpleNamespace()),
        joined_iso=None,
        background_tasks=set(),
        read_history=lambda: [],
    )


@pytest.fixture
def all_layers_on(monkeypatch):
    for target in (
        "app.core.livekit.fillers.is_filler_enabled",
        "app.core.livekit.backchannel.is_backchannel_enabled",
        "app.core.livekit.interim_reply.is_interim_reply_enabled",
    ):
        monkeypatch.setattr(target, lambda s: True)


@pytest.fixture
def fake_player(monkeypatch):
    class FakePlayer:
        def __init__(self, ambient_sound=None):
            self.ambient_sound = ambient_sound

        async def start(self, room):
            self.room = room

    monkeypatch.setattr(
        "app.core.livekit.resilient_bg_audio.ResilientBackgroundAudioPlayer",
        FakePlayer,
    )
    return FakePlayer


@pytest.mark.unit
async def test_no_clips_and_no_comfort_publishes_nothing(monkeypatch, all_layers_on):
    c = _controller(clips=False)
    monkeypatch.setattr(c, "_resolve_comfort_audio", AsyncMock(return_value=None))
    deferred = AsyncMock()
    monkeypatch.setattr(c, "_setup_deferred_naturalness", deferred)

    await c.start()
    await asyncio.sleep(0)

    assert c._bg_audio is None
    assert c._interim_enabled is False
    deferred.assert_not_awaited()


@pytest.mark.unit
async def test_no_clips_keeps_comfort_only(monkeypatch, all_layers_on, fake_player):
    c = _controller(clips=False)
    monkeypatch.setattr(c, "_resolve_comfort_audio", AsyncMock(return_value="TONE"))
    deferred = AsyncMock()
    monkeypatch.setattr(c, "_setup_deferred_naturalness", deferred)

    await c.start()
    await asyncio.sleep(0)

    assert isinstance(c._bg_audio, fake_player)
    assert c._interim_enabled is False
    deferred.assert_not_awaited()


@pytest.mark.unit
async def test_clips_available_defers_the_layers(
    monkeypatch, all_layers_on, fake_player
):
    c = _controller(clips=True)
    monkeypatch.setattr(c, "_resolve_comfort_audio", AsyncMock(return_value=None))
    deferred = AsyncMock()
    monkeypatch.setattr(c, "_setup_deferred_naturalness", deferred)

    await c.start()
    await asyncio.sleep(0)

    assert isinstance(c._bg_audio, fake_player)
    assert c._interim_enabled is True
    deferred.assert_awaited_once()


@pytest.mark.unit
async def test_deferred_setup_makes_no_llm_calls_without_clips(
    monkeypatch, all_layers_on
):
    c = _controller(clips=False)
    c._bg_audio = Mock()
    backchannel_llm = AsyncMock(return_value=["mm-hmm"])
    monkeypatch.setattr(
        "app.core.livekit.backchannel.generate_backchannel_phrases", backchannel_llm
    )
    setup_interim = Mock()
    monkeypatch.setattr(c, "_setup_interim_reply", setup_interim)

    await c._setup_deferred_naturalness()

    backchannel_llm.assert_not_awaited()
    setup_interim.assert_not_called()
    assert c.session.handlers == {}
