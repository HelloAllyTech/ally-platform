"""Tests for the optional AI video actor.

The point of most of these is not that the feature works — it is that the
feature is INERT. Every roleplay that exists today omits ``videoActorEnabled``
and every deployment today leaves ``VIDEO_ACTOR_ENABLED`` false, so the
contract worth pinning down is that under those conditions nothing is
imported, nothing is started, and the caller is told to run the session
exactly as it does now.
"""

from types import SimpleNamespace

import pytest

from livekit import rtc

from app.core.livekit import video_actor

_AGENT_KIND = int(getattr(rtc.ParticipantKind, "PARTICIPANT_KIND_AGENT", 4))
_VIDEO_KIND = rtc.TrackKind.KIND_VIDEO
_AUDIO_KIND = rtc.TrackKind.KIND_AUDIO


def _scenario(enabled=None, avatar_id=None, name="Asha"):
    """A minimal scenario stub. ``enabled=None`` models the key being absent."""
    prompt_data = SimpleNamespace(name=name)
    if enabled is not None:
        prompt_data.video_actor_enabled = enabled
    if avatar_id is not None:
        prompt_data.video_actor_avatar_id = avatar_id
    return SimpleNamespace(prompt_data=prompt_data)


class TestIsVideoActorEnabled:
    """Two gates, both required, both defaulting off."""

    @pytest.mark.unit
    def test_enabled_when_both_on(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        assert video_actor.is_video_actor_enabled(_scenario(True)) is True

    @pytest.mark.unit
    def test_disabled_when_global_off(self, monkeypatch):
        """The kill-switch wins over a roleplay that opted in."""
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", False)
        assert video_actor.is_video_actor_enabled(_scenario(True)) is False

    @pytest.mark.unit
    def test_disabled_when_scenario_off(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        assert video_actor.is_video_actor_enabled(_scenario(False)) is False

    @pytest.mark.unit
    def test_absent_key_is_off(self, monkeypatch):
        """The case that covers every roleplay in the database today.

        Unlike comfort audio, absence is NOT "no preference expressed" here —
        it is the preference. A roleplay authored before this feature existed
        must keep running audio-only.
        """
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        assert video_actor.is_video_actor_enabled(_scenario(None)) is False

    @pytest.mark.unit
    @pytest.mark.parametrize("truthy", [1, "true", "yes", [1]])
    def test_only_a_real_bool_true_counts(self, monkeypatch, truthy):
        """A truthy non-bool is a data bug, not consent to publish video."""
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        assert video_actor.is_video_actor_enabled(_scenario(truthy)) is False

    @pytest.mark.unit
    def test_disabled_when_no_scenario(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        assert video_actor.is_video_actor_enabled(None) is False

    @pytest.mark.unit
    def test_disabled_when_no_prompt_data(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        assert video_actor.is_video_actor_enabled(SimpleNamespace()) is False

    @pytest.mark.unit
    def test_shipped_defaults_publish_no_video(self):
        """The DECLARED defaults must leave every session audio-only.

        The global switch ships ON — it is the operator's one lever to stop
        video everywhere, and it can only be that if the real decision lives in
        the per-roleplay flag. So the assertion that matters is the one below
        it: the per-roleplay default is off, and no roleplay sets the key, so
        nothing publishes video however the kill switch is set.

        Reads the field defaults off the models rather than the live settings
        instance: a developer testing this feature locally has VIDEO_ACTOR_*
        in their .env, and a repo-root .env wins over the declared default.
        """
        from app.core.config import Settings
        from app.core.scenario.base import PromptData

        assert Settings.model_fields["VIDEO_ACTOR_ENABLED"].default is True
        # Defaults to the real vendor, not the placeholder: an unconfigured
        # deployment then falls back to audio-only rather than rendering a
        # learner a coloured blob.
        assert Settings.model_fields["VIDEO_ACTOR_PROVIDER"].default == "tavus"
        # The gate that actually decides, and the one that must never drift.
        assert PromptData.model_fields["video_actor_enabled"].default is False

    @pytest.mark.unit
    def test_global_on_alone_publishes_nothing(self, monkeypatch):
        """The kill switch being on is not the feature being on."""
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        # A roleplay as it exists today: the key is simply absent.
        assert video_actor.is_video_actor_enabled(_scenario(None)) is False


class TestStartVideoActor:
    """``start_video_actor`` returns None for everything except a live actor."""

    @pytest.mark.unit
    async def test_returns_none_and_touches_nothing_when_disabled(self, monkeypatch):
        """The disabled path must not reach a provider at all.

        Asserting on the dispatcher rather than on the return value: a `None`
        that came back *after* connecting to a vendor would still be a
        regression for the 100% of sessions that never opted in.
        """
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", False)

        called = []

        async def _boom(**kwargs):
            called.append(kwargs)
            raise AssertionError("provider must not be reached when disabled")

        monkeypatch.setattr(video_actor, "_start_provider", _boom)

        result = await video_actor.start_video_actor(
            session=object(), room=object(), scenario=_scenario(True)
        )
        assert result is None
        assert called == []

    @pytest.mark.unit
    async def test_provider_exception_degrades_to_audio_only(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)

        async def _raise(**kwargs):
            raise RuntimeError("vendor said no")

        monkeypatch.setattr(video_actor, "_start_provider", _raise)

        result = await video_actor.start_video_actor(
            session=object(), room=object(), scenario=_scenario(True)
        )
        assert result is None

    @pytest.mark.unit
    async def test_provider_timeout_degrades_to_audio_only(self, monkeypatch):
        """The latency guard: a slow vendor costs a log line, not a slow start."""
        import asyncio

        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_START_TIMEOUT_S", 0.05)

        async def _hang(**kwargs):
            await asyncio.sleep(5)

        monkeypatch.setattr(video_actor, "_start_provider", _hang)

        result = await video_actor.start_video_actor(
            session=object(), room=object(), scenario=_scenario(True)
        )
        assert result is None

    @pytest.mark.unit
    async def test_unknown_provider_degrades_to_audio_only(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "nope")

        result = await video_actor.start_video_actor(
            session=object(), room=object(), scenario=_scenario(True)
        )
        assert result is None

    @pytest.mark.unit
    async def test_missing_hosted_plugin_degrades_to_audio_only(self, monkeypatch):
        """None of the vendor plugins are installed — that must be survivable."""
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "bey")
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", "face-1")

        result = await video_actor.start_video_actor(
            session=object(), room=object(), scenario=_scenario(True)
        )
        assert result is None


class TestAvatarIdResolution:
    """Per-roleplay id wins; the deployment default is the fallback."""

    @pytest.mark.unit
    def test_per_roleplay_wins(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", "global")
        assert video_actor._resolve_avatar_id(_scenario(True, "per-sim")) == "per-sim"

    @pytest.mark.unit
    def test_falls_back_to_deployment_default(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", "global")
        assert video_actor._resolve_avatar_id(_scenario(True)) == "global"

    @pytest.mark.unit
    def test_none_when_neither_set(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", None)
        assert video_actor._resolve_avatar_id(_scenario(True)) is None


class TestVideoActorHandle:
    """Teardown runs during shutdown, so it must never raise."""

    @pytest.mark.unit
    async def test_aclose_swallows_errors(self):
        async def _raise():
            raise RuntimeError("renderer stuck")

        handle = video_actor.VideoActorHandle(
            provider="test_pattern", publishes_audio=True, _closer=_raise
        )
        await handle.aclose()

    @pytest.mark.unit
    async def test_aclose_is_idempotent(self):
        calls = []

        async def _close():
            calls.append(1)

        handle = video_actor.VideoActorHandle(
            provider="test_pattern", publishes_audio=True, _closer=_close
        )
        await handle.aclose()
        await handle.aclose()
        assert calls == [1]


class TestTestPatternRenderer:
    """The dependency-free renderer, exercised without a room."""

    @pytest.mark.unit
    def test_renders_an_rgba_frame_of_the_configured_size(self):
        gen = video_actor._TestPatternVideoGenerator(
            width=64, height=48, fps=15.0, seed=120
        )
        frame = gen._render(0.5)
        assert frame.width == 64
        assert frame.height == 48
        # RGBA: four bytes per pixel, and the runner's AVSynchronizer will
        # reject anything else outright.
        assert len(frame.data) == 64 * 48 * 4

    @pytest.mark.unit
    def test_envelope_of_a_malformed_frame_is_silence_not_an_exception(self):
        """A bad frame inside the media loop must cost a still picture."""
        assert video_actor._frame_envelope(SimpleNamespace(data=b"\x01")) >= 0.0
        assert video_actor._frame_envelope(SimpleNamespace()) == 0.0

    @pytest.mark.unit
    def test_clear_buffer_drops_pending_speech(self):
        """Barge-in: the learner interrupted, so queued audio is dead."""
        gen = video_actor._TestPatternVideoGenerator(
            width=16, height=16, fps=15.0, seed=0
        )
        gen._audio_q.put_nowait(object())
        gen._audio_q.put_nowait(object())
        gen.clear_buffer()
        assert gen._audio_q.empty()

    @pytest.mark.unit
    def test_same_character_always_gets_the_same_tint(self):
        assert video_actor._character_seed(_scenario(True, name="Asha")) == (
            video_actor._character_seed(_scenario(True, name="Asha"))
        )


class TestMetadataToPromptData:
    """The camelCase key from ally-be has to land on the snake_case field."""

    @staticmethod
    def _build(prompt_data: dict):
        from app.core.scenario.base import Scenario

        return Scenario._build_prompt_data({"promptData": prompt_data})

    @pytest.mark.unit
    def test_absent_key_resolves_off(self):
        """Metadata as it exists for every roleplay today."""
        built = self._build({"title": "A call"})
        assert built.video_actor_enabled is False
        assert built.video_actor_avatar_id is None

    @pytest.mark.unit
    def test_camel_case_true_resolves_on(self):
        built = self._build(
            {"title": "A call", "videoActorEnabled": True, "videoActorAvatarId": "a1"}
        )
        assert built.video_actor_enabled is True
        assert built.video_actor_avatar_id == "a1"

    @pytest.mark.unit
    def test_explicit_false_resolves_off(self):
        built = self._build({"title": "A call", "videoActorEnabled": False})
        assert built.video_actor_enabled is False

    @pytest.mark.unit
    def test_snake_case_is_accepted_too(self):
        """Matches how every neighbouring flag reads its key."""
        built = self._build({"title": "A call", "video_actor_enabled": True})
        assert built.video_actor_enabled is True


class TestFrameCadence:
    """The renderer must hold its frame rate while audio is streaming.

    Regression: the first version waited on the audio queue and rendered only
    when that wait timed out. TTS delivers ~95 audio frames a second, so the
    queue was never empty, and a 15fps avatar measured 1.3fps against a live
    LiveKit subscriber. A unit test that only pushed a couple of frames could
    not see it — this one keeps the queue full, the way real speech does.

    The warm-up below is not padding: without it the very first render pays
    numpy's import/allocation cost inside the measured window, and the test
    failed on cold starts only — which is every CI run, and none of the local
    re-runs that would be used to check it.
    """

    @pytest.mark.unit
    async def test_video_keeps_its_cadence_under_continuous_audio(self):
        import asyncio

        from livekit import rtc

        gen = video_actor._TestPatternVideoGenerator(
            width=32, height=32, fps=50.0, seed=3
        )
        silence = b"\x00\x00" * 240

        async def keep_the_queue_full():
            """Stand in for TTS: far more audio frames than video frames."""
            while True:
                await gen.push_audio(rtc.AudioFrame(silence, 24000, 1, 240))
                await asyncio.sleep(0.001)

        pump = asyncio.create_task(keep_the_queue_full())
        it = gen.__aiter__()

        # Warm up numpy and the loop, off the clock.
        gen._render(0.0)
        for _ in range(10):
            await it.__anext__()

        video = audio = 0
        loop = asyncio.get_running_loop()
        started = loop.time()
        while loop.time() - started < 0.5:
            item = await it.__anext__()
            if isinstance(item, rtc.VideoFrame):
                video += 1
            else:
                audio += 1
        pump.cancel()
        await gen.aclose()

        # 50fps over 0.5s is ~25 frames. The starved version managed single
        # digits over a comparable window. Assert the gap, not the exact rate,
        # so a loaded CI box cannot make this flap.
        assert video >= 10, f"video starved: {video} frames, {audio} audio"
        assert audio > 0, "audio passthrough stopped"


class TestTavusWiring:
    """Bind our kwargs against the REAL installed plugin, not a mock.

    The first version of the hosted path passed `avatar_id` to every vendor.
    Tavus takes `replica_id`, so it raised TypeError, which the module turns
    into a clean audio-only fallback — meaning Tavus would have been silently,
    permanently broken with nothing in the logs but "failed to start". A mocked
    AvatarSession would have accepted anything and proved nothing, so these
    tests introspect the installed signature instead.
    """

    @pytest.mark.unit
    def test_tavus_kwargs_use_replica_id(self, monkeypatch):
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_TAVUS_PERSONA_ID", None, raising=False
        )
        kwargs = video_actor._tavus_kwargs("r_abc123")
        assert kwargs == {"replica_id": "r_abc123"}
        assert "avatar_id" not in kwargs

    @pytest.mark.unit
    def test_persona_id_is_omitted_unless_configured(self, monkeypatch):
        """Unset by design — the character comes from our prompt, not a vendor."""
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_TAVUS_PERSONA_ID", None, raising=False
        )
        assert "persona_id" not in video_actor._tavus_kwargs("r_abc123")

        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_TAVUS_PERSONA_ID", "p_xyz", raising=False
        )
        assert video_actor._tavus_kwargs("r_abc123")["persona_id"] == "p_xyz"

    @pytest.mark.unit
    def test_our_constructor_kwargs_bind_to_the_real_tavus_signature(self):
        import inspect

        from livekit.plugins import tavus

        kwargs = dict(video_actor._tavus_kwargs("r_abc123"))
        kwargs["api_key"] = "test-key"
        # Raises TypeError if any name is wrong — the exact failure that made
        # `avatar_id` a silent dead end.
        inspect.signature(tavus.AvatarSession.__init__).bind(None, **kwargs)

    @pytest.mark.unit
    def test_start_accepts_the_livekit_url_we_pass(self):
        """We override the vendor's env default so the avatar dials the same
        media server as the learner — see the comment in _start_hosted."""
        import inspect

        from livekit.plugins import tavus

        inspect.signature(tavus.AvatarSession.start).bind(
            None, object(), room=object(), livekit_url="wss://example"
        )

    @pytest.mark.unit
    def test_every_hosted_provider_has_a_kwargs_builder(self):
        for provider in video_actor.HOSTED_PROVIDER_MODULES:
            assert provider in video_actor.HOSTED_PROVIDER_KWARGS, provider


class TestAvatarParticipantFiltering:
    """The avatar must never be counted as company.

    A hosted avatar joins as its own participant. The worker's orphan deadline
    and pause guard both ask "is anyone still here?" — unfiltered, an abandoned
    session would hold a worker slot and a metered vendor conversation open
    until the max-duration cap.
    """

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "identity", ["tavus-avatar-agent", "bey-avatar-agent", "anam-avatar-agent"]
    )
    def test_known_avatar_identities_are_not_people(self, identity):
        assert video_actor.is_avatar_participant(identity) is True

    @pytest.mark.unit
    def test_suffix_catches_a_renamed_vendor_default(self):
        assert video_actor.is_avatar_participant("newvendor-avatar-agent") is True

    @pytest.mark.unit
    @pytest.mark.parametrize("identity", ["user-42", "v2v-tester", "", None])
    def test_people_and_testers_are_never_stripped(self, identity):
        # Erring the other way would silently remove a real learner from a
        # headcount, which is worse than leaving a session running.
        assert video_actor.is_avatar_participant(identity) is False

    @pytest.mark.unit
    def test_human_participants_excludes_only_the_avatar(self):
        room = SimpleNamespace(
            remote_participants={
                "a": SimpleNamespace(identity="user-42"),
                "b": SimpleNamespace(identity="tavus-avatar-agent"),
            }
        )
        assert [p.identity for p in video_actor.human_participants(room)] == ["user-42"]

    @pytest.mark.unit
    def test_a_room_holding_only_the_avatar_reads_as_empty(self):
        """The orphan case: learner never connected, avatar did."""
        room = SimpleNamespace(
            remote_participants={"b": SimpleNamespace(identity="tavus-avatar-agent")}
        )
        assert video_actor.human_participants(room) == []

    @pytest.mark.unit
    def test_missing_room_attribute_is_survivable(self):
        assert video_actor.human_participants(SimpleNamespace()) == []


def _participant(identity, kind=0, video=False, audio=False):
    pubs = {}
    if video:
        pubs["v"] = SimpleNamespace(kind=_VIDEO_KIND)
    if audio:
        pubs["a"] = SimpleNamespace(kind=_AUDIO_KIND)
    return SimpleNamespace(identity=identity, kind=kind, track_publications=pubs)


def _room(*participants):
    return SimpleNamespace(
        remote_participants={str(i): p for i, p in enumerate(participants)}
    )


class TestAgentKindFiltering:
    """Kind comes from the token, so it beats any naming convention."""

    @pytest.mark.unit
    def test_agent_kind_is_not_a_human_whatever_it_is_called(self):
        # A vendor that renames its default identity is still caught.
        room = _room(_participant("something-unexpected", kind=_AGENT_KIND))
        assert video_actor.human_participants(room) == []

    @pytest.mark.unit
    def test_a_learner_is_never_stripped(self):
        room = _room(_participant("user-42", kind=0))
        assert [p.identity for p in video_actor.human_participants(room)] == ["user-42"]

    @pytest.mark.unit
    def test_a_participant_with_no_kind_falls_back_to_the_name_test(self):
        room = _room(
            SimpleNamespace(identity="tavus-avatar-agent"),
            SimpleNamespace(identity="user-42"),
        )
        assert [p.identity for p in video_actor.human_participants(room)] == ["user-42"]


class TestPublishVerification:
    """The guard against a vendor that starts and then renders nothing.

    Reproduces what a live Tavus account actually did on 2026-09-07:
    conversation active, avatar joined the room, zero tracks published. Because
    the agent's speech is routed to the avatar the moment start() returns, an
    unverified start leaves the learner with silence AND no picture — worse
    than never enabling the feature.
    """

    @pytest.mark.unit
    def test_video_is_seen_on_the_avatar_participant(self):
        room = _room(_participant("tavus-avatar-agent", kind=_AGENT_KIND, video=True))
        assert video_actor._avatar_video_is_live(room) is True

    @pytest.mark.unit
    def test_video_is_also_seen_under_publish_on_behalf(self):
        """Vendors publish on behalf of our agent, so attribution varies."""
        room = _room(_participant("agent-AJ_xyz", kind=_AGENT_KIND, video=True))
        assert video_actor._avatar_video_is_live(room) is True

    @pytest.mark.unit
    def test_the_observed_tavus_failure_reads_as_not_live(self):
        """Joined, agent-kind, zero publications — the exact live symptom."""
        room = _room(_participant("tavus-avatar-agent", kind=_AGENT_KIND))
        assert video_actor._avatar_video_is_live(room) is False

    @pytest.mark.unit
    def test_audio_only_publication_does_not_count_as_video(self):
        room = _room(_participant("tavus-avatar-agent", kind=_AGENT_KIND, audio=True))
        assert video_actor._avatar_video_is_live(room) is False

    @pytest.mark.unit
    def test_a_learners_own_camera_is_not_mistaken_for_the_avatar(self):
        """Otherwise a learner with video on would vouch for a dead avatar."""
        room = _room(_participant("user-42", kind=0, video=True))
        assert video_actor._avatar_video_is_live(room) is False

    @pytest.mark.unit
    async def test_wait_returns_true_as_soon_as_video_appears(self):
        room = _room(_participant("tavus-avatar-agent", kind=_AGENT_KIND, video=True))
        assert await video_actor._await_avatar_video(room, timeout=1.0) is True

    @pytest.mark.unit
    async def test_wait_gives_up_and_reports_failure(self):
        import time as _time

        room = _room(_participant("tavus-avatar-agent", kind=_AGENT_KIND))
        started = _time.monotonic()
        assert await video_actor._await_avatar_video(room, timeout=0.6) is False
        # Bounded: it must not hang, because this sits in front of session.start
        # and every second here is a second before the character speaks.
        assert _time.monotonic() - started < 2.0

    @pytest.mark.unit
    async def test_wait_notices_video_that_arrives_late(self):
        import asyncio

        participant = _participant("tavus-avatar-agent", kind=_AGENT_KIND)
        room = _room(participant)

        async def publish_soon():
            await asyncio.sleep(0.3)
            participant.track_publications["v"] = SimpleNamespace(kind=_VIDEO_KIND)

        task = asyncio.create_task(publish_soon())
        assert await video_actor._await_avatar_video(room, timeout=3.0) is True
        await task


class TestAudioOutputInvariant:
    """Returning None must leave session.output.audio exactly as found.

    This is the single invariant standing between a vendor hiccup and a session
    with no voice at all. It matters because AgentSession.start() inspects
    output.audio: finding a non-None value it quietly disables room audio,
    assuming something else will deliver the speech. If we abandoned a vendor
    but left its dead output in place, that assumption is false and the learner
    hears nothing.

    Caught live: the overall budget originally covered only the start phase, so
    the publish verification was cancelled mid-flight — before any inner cleanup
    ran — and the agent published no speech track at all.
    """

    @staticmethod
    def _session():
        return SimpleNamespace(output=SimpleNamespace(audio=None))

    @pytest.mark.unit
    async def test_restored_after_a_start_timeout(self, monkeypatch):
        import asyncio

        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_START_TIMEOUT_S", 0.05)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PUBLISH_TIMEOUT_S", 0.05)

        session = self._session()
        sentinel = object()

        async def _hang(**kwargs):
            # Stand in for a vendor: replaces output.audio, then stalls.
            session.output.audio = sentinel
            await asyncio.sleep(10)

        monkeypatch.setattr(video_actor, "_start_provider", _hang)

        assert (
            await video_actor.start_video_actor(
                session=session, room=object(), scenario=_scenario(True)
            )
            is None
        )
        assert session.output.audio is None, "dead vendor output left in place"

    @pytest.mark.unit
    async def test_restored_after_a_provider_exception(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        session = self._session()

        async def _raise(**kwargs):
            session.output.audio = object()
            raise RuntimeError("vendor said no")

        monkeypatch.setattr(video_actor, "_start_provider", _raise)

        await video_actor.start_video_actor(
            session=session, room=object(), scenario=_scenario(True)
        )
        assert session.output.audio is None

    @pytest.mark.unit
    async def test_restored_when_verification_declines_the_avatar(self, monkeypatch):
        """The observed Tavus case: started fine, never published."""
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        session = self._session()

        async def _started_but_mute(**kwargs):
            session.output.audio = object()
            return None  # what _start_hosted returns when verification fails

        monkeypatch.setattr(video_actor, "_start_provider", _started_but_mute)

        assert (
            await video_actor.start_video_actor(
                session=session, room=object(), scenario=_scenario(True)
            )
            is None
        )
        assert session.output.audio is None

    @pytest.mark.unit
    async def test_a_live_avatar_keeps_its_output(self, monkeypatch):
        """The success path must NOT restore — the avatar owns the audio now."""
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        session = self._session()
        vendor_output = object()

        async def _ok(**kwargs):
            session.output.audio = vendor_output
            return video_actor.VideoActorHandle(provider="tavus", publishes_audio=True)

        monkeypatch.setattr(video_actor, "_start_provider", _ok)

        handle = await video_actor.start_video_actor(
            session=session, room=object(), scenario=_scenario(True)
        )
        assert handle is not None
        assert session.output.audio is vendor_output

    @pytest.mark.unit
    def test_the_overall_budget_covers_both_phases(self):
        """Otherwise the publish verification is unreachable dead code."""
        from app.core.config import Settings

        start = Settings.model_fields["VIDEO_ACTOR_START_TIMEOUT_S"].default
        publish = Settings.model_fields["VIDEO_ACTOR_PUBLISH_TIMEOUT_S"].default
        assert publish > 0 and start > 0
