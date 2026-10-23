"""The character's voice must come out of its face once it has one.

The thinking filler, the back-channel and the interim reply all play through
BackgroundAudioPlayer's OWN published track, which never reaches the avatar
renderer. Left alone, a video session puts the character's voice in the room
with a motionless mouth to look at — audio and video plainly disagreeing, which
a learner reads as a broken session rather than as naturalness.

The comfort room tone is deliberately NOT covered by any of this: it is the
player's ``ambient_sound``, not a ``play()`` call, and ambient sound has no
mouth to disagree with.
"""

import asyncio
import types
from unittest.mock import MagicMock

import pytest

from app import worker


class _MockCtx:
    def __init__(self):
        self.room = types.SimpleNamespace(name="room-1")
        self.proc = types.SimpleNamespace(userdata={})
        self.job = types.SimpleNamespace(metadata="{}", id="test-job")


def _worker():
    w = worker.AgentWorker(_MockCtx())
    w._bg_audio = MagicMock()
    return w


def _actor(*, publishes_audio):
    return types.SimpleNamespace(
        provider="bey", publishes_audio=publishes_audio, aclose=None
    )


class TestVoiceOnAvatar:
    @pytest.mark.unit
    def test_no_actor_means_the_layers_are_free_to_play(self):
        w = _worker()
        w._video_actor = None
        assert w._voice_on_avatar() is False

    @pytest.mark.unit
    def test_a_pending_attach_does_not_suppress_anything(self):
        """The whole point of the deferred attach: for the first 5-12s the
        character genuinely has no face, and those are exactly the seconds a
        filler is worth most. Only a COMMITTED swap suppresses."""
        w = _worker()
        w._video_actor = _actor(publishes_audio=False)
        assert w._voice_on_avatar() is False

    @pytest.mark.unit
    def test_a_committed_swap_suppresses(self):
        w = _worker()
        w._video_actor = _actor(publishes_audio=True)
        assert w._voice_on_avatar() is True

    @pytest.mark.unit
    def test_the_setting_is_the_escape_hatch(self, monkeypatch):
        monkeypatch.setattr(
            worker.settings, "VIDEO_ACTOR_MUTE_VOICE_LAYERS", False, raising=False
        )
        w = _worker()
        w._video_actor = _actor(publishes_audio=True)
        assert w._voice_on_avatar() is False


class TestFillerSuppression:
    @pytest.mark.unit
    async def test_no_filler_plays_once_the_character_has_a_face(self):
        w = _worker()
        w._video_actor = _actor(publishes_audio=True)
        w._agent_thinking = True
        pool = MagicMock()
        w._filler_pool = pool

        await w._play_filler(None, 900.0, True)

        w._bg_audio.play.assert_not_called()
        # Guarded before the pool is touched, so a suppressed turn cannot burn
        # a clip's recency budget on audio nobody hears.
        pool.choose.assert_not_called()
        pool.mark_played.assert_not_called()

    @pytest.mark.unit
    async def test_suppression_still_settles_the_turn(self):
        """_filler_decided gates the interim's chaining, so a suppressed filler
        that never set it would leave that task waiting out its full timeout."""
        w = _worker()
        w._video_actor = _actor(publishes_audio=True)
        w._agent_thinking = True
        w._filler_pool = MagicMock()

        await w._play_filler(None, 900.0, True)

        assert w._filler_decided.is_set()

    @pytest.mark.unit
    async def test_the_pool_is_still_consulted_before_the_avatar_attaches(self):
        w = _worker()
        w._video_actor = _actor(publishes_audio=False)
        w._agent_thinking = True
        pool = MagicMock()
        pool.choose.return_value = None  # stop before any real playback
        w._filler_pool = pool

        await w._play_filler(None, 900.0, True)

        pool.choose.assert_called_once()


class TestInterimSuppression:
    @pytest.mark.unit
    async def test_no_interim_is_made_once_the_character_has_a_face(self, monkeypatch):
        """The OpenerPlayer plays the interim and refuses an avatar turn
        (``voice_on_avatar``); the generator also skips the LLM call and the
        render, so a face costs nothing per turn."""
        calls = []

        async def _generate(*a, **k):
            calls.append(1)
            return "I hear you."

        monkeypatch.setattr(
            "app.core.livekit.interim_reply.generate_interim_reply", _generate
        )
        w = _worker()
        w._video_actor = _actor(publishes_audio=True)
        w._interim_state = "generating"

        await w._interim_generate("a long partial transcript from the learner")

        assert calls == []
        w._bg_audio.play.assert_not_called()
        # Back to idle, the same resting state every other bail-out path uses,
        # so the next turn can generate a fresh one.
        assert w._interim_state == "idle"


class TestBackchannelSuppression:
    @pytest.mark.unit
    async def test_the_loop_stops_once_the_character_has_a_face(self, monkeypatch):
        """Re-checked per iteration, because the avatar can attach while the
        learner is mid-utterance and the loop is already running."""
        for name, value in (
            ("BACKCHANNEL_MIN_UTTERANCE_MS", 0.0),
            ("BACKCHANNEL_MIN_GAP_MS", 0.0),
            ("BACKCHANNEL_MAX_GAP_MS", 0.0),
            ("BACKCHANNEL_PLAY_PROBABILITY", 1.0),
        ):
            monkeypatch.setattr(worker.settings, name, value, raising=False)

        w = _worker()
        w._video_actor = _actor(publishes_audio=True)
        w._user_speaking = True
        w._backchannel_clips = [types.SimpleNamespace(phrase="mm-hmm")]

        # Bounded: with the gaps set to zero, a regression here is an infinite
        # busy loop rather than a wrong value, and an unbounded await would
        # hang CI instead of failing it.
        await asyncio.wait_for(w._backchannel_loop(), timeout=2.0)

        w._bg_audio.play.assert_not_called()


class TestFillerDecisionRecord:
    """A suppressed turn must be recorded as suppressed, not as something else.

    ``fillerDecision`` is how coverage — the share of SLOW turns that actually
    got masked — is measured. Folding these turns into ``skipped_probability``
    would make the cadence gate look like it declined turns it never saw.
    """

    @pytest.mark.unit
    def test_the_avatar_is_decided_before_anything_about_the_gap(self, monkeypatch):
        w = _worker()
        w._video_actor = _actor(publishes_audio=True)
        w._filler_consecutive_turns = 0
        # A gap far above the certainty threshold, so without this gate the
        # answer would be an unconditional "played".
        monkeypatch.setattr(
            worker.settings, "FILLER_CERTAIN_GAP_MS", 1200.0, raising=False
        )

        assert w._should_play_filler(5000.0) == (False, "skipped_video_actor")

    @pytest.mark.unit
    def test_the_ordinary_decision_is_untouched_without_a_face(self, monkeypatch):
        w = _worker()
        w._video_actor = None
        w._filler_consecutive_turns = 0
        monkeypatch.setattr(
            worker.settings, "FILLER_CERTAIN_GAP_MS", 1200.0, raising=False
        )

        assert w._should_play_filler(5000.0) == (True, "played")

    @pytest.mark.unit
    def test_the_reason_survives_note_filler_decision(self):
        """note_filler_decision is a deliberate no-op for an unknown decision,
        so an unregistered reason would be dropped and the turn would record no
        decision at all — the exact hole this bucket exists to fill."""
        from app.core.metrics import turn_metrics

        assert "skipped_video_actor" in turn_metrics.FILLER_DECISIONS

        turn_metrics.note_user_speech_end("room-record", 1.0)
        turn_metrics.note_filler_decision("room-record", "skipped_video_actor")
        try:
            meta = turn_metrics._turns["room-record"]["metadata"]
            assert meta["fillerDecision"] == "skipped_video_actor"
        finally:
            turn_metrics.discard("room-record")
