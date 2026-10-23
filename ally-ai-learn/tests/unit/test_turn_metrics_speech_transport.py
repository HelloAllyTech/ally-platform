"""Which output carried a turn's speech, recorded so latency stays comparable.

``response_latency_ms`` comes from the ``agent_state == "speaking"``
transition, and the two audio outputs do not mean the same thing by it. The
room output reports the first frame actually captured into the published
source; ``DataStreamAudioOutput`` reports the first frame written to the VENDOR,
excluding its transport, render and republish time. So an avatar turn's latency
is optimistic by an unmeasured amount, and no vendor offers a "playback
started" signal to fix it with.

Recording the transport is the honest alternative — the dashboards can segment
or exclude those turns instead of averaging two different measurements into one
trend.
"""

import types
from unittest.mock import MagicMock

import pytest

from app import worker
from app.core.metrics import turn_metrics

ROOM = "room-transport"


@pytest.fixture(autouse=True)
def _clean():
    turn_metrics.discard(ROOM)
    yield
    turn_metrics.discard(ROOM)


def _finalize(*, user_end=1.0, speaking_at=2.0):
    turn_metrics.note_user_speech_end(ROOM, user_end)
    return turn_metrics.finalize(ROOM, speaking_at)


class TestRecording:
    @pytest.mark.unit
    def test_a_plain_audio_turn_says_so_explicitly(self):
        """Not left absent: a NULL that means both "room output" and "emitted
        before this shipped" is the ambiguity this exists to remove."""
        turn_metrics.note_speech_transport(ROOM, "room")
        rec = _finalize()
        assert rec["metadata"]["speechTransport"] == "room"
        assert "speechTransportProvider" not in rec["metadata"]

    @pytest.mark.unit
    def test_an_avatar_turn_carries_its_vendor(self):
        """Two vendors have very different lag, so an aggregate over 'avatar'
        that cannot tell them apart is not worth much."""
        turn_metrics.note_speech_transport(ROOM, "avatar", "bey")
        rec = _finalize()
        assert rec["metadata"]["speechTransport"] == "avatar"
        assert rec["metadata"]["speechTransportProvider"] == "bey"

    @pytest.mark.unit
    def test_it_survives_turn_boundaries(self):
        """Session state, not turn state: finalize() clears the turn, and the
        transport must outlive that or only the first turn would be labelled."""
        turn_metrics.note_speech_transport(ROOM, "avatar", "bey")
        for _ in range(3):
            rec = _finalize()
            assert rec["metadata"]["speechTransport"] == "avatar"

    @pytest.mark.unit
    def test_one_session_can_report_both_transports(self):
        """A deferred session starts on its own audio and swaps mid-session, so
        its early turns really did measure something different from its later
        ones."""
        turn_metrics.note_speech_transport(ROOM, "room")
        before = _finalize()
        turn_metrics.note_speech_transport(ROOM, "avatar", "bey")
        after = _finalize()

        assert before["metadata"]["speechTransport"] == "room"
        assert after["metadata"]["speechTransport"] == "avatar"

    @pytest.mark.unit
    def test_an_unknown_transport_is_not_stored(self):
        """Same contract as note_filler_decision: a typo must not create a
        phantom bucket a dashboard then reports on."""
        turn_metrics.note_speech_transport(ROOM, "room")
        turn_metrics.note_speech_transport(ROOM, "telepathy")
        rec = _finalize()
        assert rec["metadata"]["speechTransport"] == "room"

    @pytest.mark.unit
    def test_it_does_not_clobber_other_metadata_writers(self):
        turn_metrics.note_speech_transport(ROOM, "avatar", "bey")
        turn_metrics.note_filler_decision(ROOM, "skipped_video_actor")
        rec = _finalize()
        assert rec["metadata"]["fillerDecision"] == "skipped_video_actor"
        assert rec["metadata"]["speechTransport"] == "avatar"


class TestLifecycle:
    @pytest.mark.unit
    def test_a_pause_keeps_the_transport(self):
        """discard_inflight drops a paused turn while the session continues on
        the same output — clearing the transport there would silently
        unlabel every turn after a pause."""
        turn_metrics.note_speech_transport(ROOM, "avatar", "bey")
        turn_metrics.note_user_speech_end(ROOM, 1.0)
        turn_metrics.discard_inflight(ROOM)

        rec = _finalize()
        assert rec["metadata"]["speechTransport"] == "avatar"

    @pytest.mark.unit
    def test_session_shutdown_clears_it(self):
        turn_metrics.note_speech_transport(ROOM, "avatar", "bey")
        turn_metrics.discard(ROOM)
        assert ROOM not in turn_metrics._transports


class _MockCtx:
    def __init__(self):
        self.room = types.SimpleNamespace(name=ROOM)
        self.proc = types.SimpleNamespace(userdata={})
        self.job = types.SimpleNamespace(metadata="{}", id="test-job")


def _worker():
    w = worker.AgentWorker(_MockCtx())
    w._bg_audio = MagicMock()
    return w


class TestWorkerReporting:
    @pytest.mark.unit
    def test_no_actor_reports_the_room(self):
        w = _worker()
        w._video_actor = None
        w._note_speech_transport()
        assert _finalize()["metadata"]["speechTransport"] == "room"

    @pytest.mark.unit
    def test_a_pending_attach_still_reports_the_room(self):
        """Pre-attach turns genuinely went out on the agent's own track, so
        their latency is the accurate kind."""
        w = _worker()
        w._video_actor = types.SimpleNamespace(provider="bey", publishes_audio=False)
        w._note_speech_transport()
        assert _finalize()["metadata"]["speechTransport"] == "room"

    @pytest.mark.unit
    def test_a_committed_swap_reports_the_avatar_and_vendor(self):
        w = _worker()
        w._video_actor = types.SimpleNamespace(provider="bey", publishes_audio=True)
        w._note_speech_transport()
        meta = _finalize()["metadata"]
        assert meta["speechTransport"] == "avatar"
        assert meta["speechTransportProvider"] == "bey"

    @pytest.mark.unit
    def test_the_filler_preference_cannot_relabel_the_transport(self, monkeypatch):
        """The trap this predicate split exists to avoid. VIDEO_ACTOR_MUTE_
        VOICE_LAYERS is a preference about fillers; if the transport followed
        it, turning it off would report every avatar turn as plain audio and
        quietly corrupt the latency segmentation."""
        monkeypatch.setattr(
            worker.settings, "VIDEO_ACTOR_MUTE_VOICE_LAYERS", False, raising=False
        )
        w = _worker()
        w._video_actor = types.SimpleNamespace(provider="bey", publishes_audio=True)

        assert w._voice_on_avatar() is False  # the preference is off
        w._note_speech_transport()
        # ...but the speech is still riding the avatar, and the row says so.
        assert _finalize()["metadata"]["speechTransport"] == "avatar"


class TestTtsModel:
    """A clip-less voice (eleven_v3) gets no spoken masking, so its turns are
    reply-first by construction; the dashboard needs the voice to tell a mix
    shift from a latency regression."""

    @pytest.mark.unit
    def test_every_turn_carries_the_voice_model(self):
        turn_metrics.note_tts_model(ROOM, "elevenlabs", "eleven_v3")
        for _ in range(2):
            assert _finalize()["metadata"]["ttsModel"] == "elevenlabs/eleven_v3"

    @pytest.mark.unit
    def test_absent_when_unknown_and_gone_with_the_session(self):
        turn_metrics.note_tts_model(ROOM, "elevenlabs", None)
        assert "ttsModel" not in _finalize()["metadata"]
        turn_metrics.note_tts_model(ROOM, "elevenlabs", "eleven_v3")
        turn_metrics.discard(ROOM)
        assert "ttsModel" not in _finalize()["metadata"]


class TestInterimSource:
    """A bridge line and the legacy interim are both firstAudioSource='interim';
    interimSource says which system masked the turn."""

    @pytest.mark.unit
    @pytest.mark.parametrize("source", ["bridge", "legacy"])
    def test_an_interim_first_turn_names_its_source(self, source):
        turn_metrics.note_user_speech_end(ROOM, 1.0)
        turn_metrics.note_filler_started(
            ROOM, 1.3, kind="interim", interim_source=source
        )
        meta = turn_metrics.finalize(ROOM, 3.0)["metadata"]
        assert meta["firstAudioSource"] == "interim"
        assert meta["interimSource"] == source

    @pytest.mark.unit
    def test_only_the_first_audio_labels_it(self):
        turn_metrics.note_user_speech_end(ROOM, 1.0)
        turn_metrics.note_filler_started(ROOM, 1.2, kind="filler")
        turn_metrics.note_filler_started(
            ROOM, 1.9, kind="interim", interim_source="legacy"
        )
        meta = turn_metrics.finalize(ROOM, 3.0)["metadata"]
        assert meta["firstAudioSource"] == "filler"
        assert "interimSource" not in meta
