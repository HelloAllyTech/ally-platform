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

    @pytest.mark.unit
    async def test_bey_missing_api_key_degrades_to_audio_only(
        self, monkeypatch, caplog
    ):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "bey")
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", "face-1")
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_BEY_API_KEY", None)
        # The fallback key too: a developer .env that sets it made "no key"
        # untrue and sent this test down the start path.
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_API_KEY", None)

        with caplog.at_level("WARNING"):
            result = await video_actor.start_video_actor(
                session=object(), room=object(), scenario=_scenario(True)
            )
        assert result is None
        assert "provider=bey" in caplog.text
        assert "needs an API key" in caplog.text


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


class TestVendorConstructorMapping:
    """Bind every vendor's kwargs against its REAL installed signature.

    This is the test that keeps being needed. The first implementation sent
    `avatar_id` to every vendor; three of the four reject it — Tavus wants
    `replica_id`, Anam a `PersonaConfig`, Simli a `SimliConfig` — and a wrong
    kwarg raises TypeError, which the module converts into a clean audio-only
    fallback. The vendors would have been permanently broken with nothing in
    the logs but "failed to start".

    A mocked AvatarSession accepts anything and proves none of this, so these
    bind against the installed plugin instead. Published vendor docs track a
    newer livekit-agents than we pin and describe different argument names, so
    the wheel is the only trustworthy source.
    """

    # Only the vendors we actually depend on can be bound in CI. anam and simli
    # are mapped but their plugins are deliberately NOT in pyproject.toml —
    # shipping four vendor SDKs to run one would be silly — so their tests skip
    # unless someone has installed the plugin, which is exactly when the binding
    # starts to matter. Installed-but-undeclared is what broke this first: the
    # tests passed locally and failed in CI.
    INSTALLED = {"tavus", "bey"}

    @classmethod
    def _bind(cls, provider, module_path):
        import importlib
        import inspect

        if provider in cls.INSTALLED:
            plugin = importlib.import_module(module_path)
        else:
            plugin = pytest.importorskip(
                module_path,
                reason=(
                    f"livekit-plugins-{provider} is not a dependency; this binding "
                    f"is verified when the plugin is installed to use it"
                ),
            )
        build = video_actor.HOSTED_PROVIDER_KWARGS[provider]
        kwargs = build(
            plugin, avatar_id="face-123", api_key="test-key", character_name="Asha"
        )
        # Raises TypeError on any wrong or missing argument name.
        inspect.signature(plugin.AvatarSession.__init__).bind(None, **kwargs)
        return kwargs

    @pytest.mark.unit
    def test_declared_dependencies_match_what_is_hard_bound(self):
        """Keeps INSTALLED honest against pyproject.toml.

        If someone adds a vendor plugin as a dependency without moving it here,
        its binding silently degrades to a skip and stops protecting anything.
        """
        import pathlib
        import re

        pyproject = pathlib.Path(__file__).parents[2] / "pyproject.toml"
        declared = set(re.findall(r"livekit-plugins-(\w+) = ", pyproject.read_text()))
        vendors = declared & set(video_actor.HOSTED_PROVIDER_MODULES)
        assert vendors == self.INSTALLED, (
            f"declared avatar plugins {sorted(vendors)} != hard-bound "
            f"{sorted(self.INSTALLED)}"
        )

    @pytest.mark.unit
    def test_tavus_binds_and_uses_replica_id(self):
        kwargs = self._bind("tavus", "livekit.plugins.tavus")
        assert kwargs["replica_id"] == "face-123"
        assert "avatar_id" not in kwargs

    @pytest.mark.unit
    def test_bey_binds_and_uses_avatar_id(self):
        kwargs = self._bind("bey", "livekit.plugins.bey")
        assert kwargs["avatar_id"] == "face-123"

    @pytest.mark.unit
    def test_anam_binds_and_builds_a_persona_config(self):
        kwargs = self._bind("anam", "livekit.plugins.anam")
        assert kwargs["persona_config"].avatarId == "face-123"
        # Cosmetic in Anam's dashboard, but it is what someone debugging one
        # roleplay from that end would search for.
        assert kwargs["persona_config"].name == "Asha"

    @pytest.mark.unit
    def test_simli_binds_and_keeps_its_key_inside_the_config(self):
        kwargs = self._bind("simli", "livekit.plugins.simli")
        assert kwargs["simli_config"].face_id == "face-123"
        assert kwargs["simli_config"].api_key == "test-key"
        # Simli has no top-level api_key; passing one is a TypeError.
        assert "api_key" not in kwargs

    @pytest.mark.unit
    def test_every_module_in_the_map_has_a_kwargs_builder(self):
        """A provider without one must not fall through to a guess."""
        for provider in video_actor.HOSTED_PROVIDER_MODULES:
            assert provider in video_actor.HOSTED_PROVIDER_KWARGS, provider

    @pytest.mark.unit
    @pytest.mark.unit
    def test_bey_gets_a_single_attempt_not_the_plugin_default(self):
        """One attempt, because a retry is one more avatar joining and leaving.

        The plugin's `_start_agent` loops `max_retry` times and each pass
        commissions an avatar that joins the room and drops when the attempt
        fails. In prod that rendered as a participant flickering in and out of
        the learner's session three times in 13 seconds, against a 400 the
        vendor had already flagged `retryable=False` — its loop does not read
        that flag, so the retries could never have helped.

        Pinned on the VALUE, not just the keyword: the signature binding in
        `_bind` proves `conn_options` is accepted, which would stay true if the
        budget drifted back to the default.
        """
        import livekit.plugins.bey as bey

        build = video_actor.HOSTED_PROVIDER_KWARGS["bey"]
        kwargs = build(bey, avatar_id="face-123", api_key="k", character_name="Asha")
        assert kwargs["conn_options"].max_retry == 1
        # The rest of the budget stays whatever livekit-agents ships.
        from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS as default

        assert kwargs["conn_options"].retry_interval == default.retry_interval

    def test_persona_id_is_omitted_unless_configured(self, monkeypatch):
        """Unset by design — the character comes from our prompt, not a vendor."""
        import livekit.plugins.tavus as tavus

        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_TAVUS_PERSONA_ID", None, raising=False
        )
        build = video_actor.HOSTED_PROVIDER_KWARGS["tavus"]
        assert "persona_id" not in build(
            tavus, avatar_id="r1", api_key=None, character_name=None
        )

        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_TAVUS_PERSONA_ID", "p_xyz", raising=False
        )
        assert (
            build(tavus, avatar_id="r1", api_key=None, character_name=None)[
                "persona_id"
            ]
            == "p_xyz"
        )

    @pytest.mark.unit
    def test_start_accepts_the_livekit_url_we_pass(self):
        """We override the vendor's env default so the avatar dials the same
        media server as the learner — see the comment in _start_hosted."""
        import inspect

        from livekit.plugins import bey, tavus

        for mod in (tavus, bey):
            inspect.signature(mod.AvatarSession.start).bind(
                None, object(), room=object(), livekit_url="wss://example"
            )


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


class TestLiveKitUrlScheme:
    """A vendor dials LiveKit itself, and wants the client-form URL.

    The job URL the SDK hands us can carry an http(s) scheme — the API form.
    Tavus normalises it silently; Beyond Presence returns
    "400 Invalid LiveKit URL. Expected format: ws[s]://<host>[:<port>]", which
    reaches us only as "failed to start" and a session that quietly runs
    audio-only. Found by replaying the vendor's own HTTP call by hand.
    """

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "given,expected",
        [
            ("https://h.livekit.cloud", "wss://h.livekit.cloud"),
            ("http://h:7880", "ws://h:7880"),
            # Already client-form: left exactly alone.
            ("wss://h.livekit.cloud", "wss://h.livekit.cloud"),
            ("ws://h:7880", "ws://h:7880"),
        ],
    )
    def test_scheme_is_coerced_to_websocket(self, given, expected):
        assert video_actor._as_websocket_url(given) == expected

    @pytest.mark.unit
    def test_the_regional_host_is_preserved(self):
        """The host was never the problem — only the scheme."""
        assert (
            video_actor._as_websocket_url(
                "https://proj-abc.ohyderabad1a.production.livekit.cloud"
            )
            == "wss://proj-abc.ohyderabad1a.production.livekit.cloud"
        )

    @pytest.mark.unit
    @pytest.mark.parametrize("empty", [None, ""])
    def test_empty_passes_through(self, empty):
        """No URL means "let the plugin read its own env", not a broken string."""
        assert video_actor._as_websocket_url(empty) == empty


class TestTavusConversationTeardown:
    """Ending the Tavus conversation, which the vendor plugin never does.

    The leak is not cosmetic. A conversation left open counts against the
    account's concurrent-conversation cap, and past the cap Tavus still
    returns a conversation_id and still joins the room — it publishes no
    track. So a conversation this worker fails to end is a silent session
    later, not a stray row in a dashboard.
    """

    @pytest.mark.unit
    async def test_no_conversation_id_is_a_no_op(self):
        """Nothing to end, and nothing to complain about."""
        await video_actor._end_tavus_conversation(SimpleNamespace())

    @pytest.mark.unit
    async def test_missing_key_warns_rather_than_failing_silently(
        self, monkeypatch, caplog
    ):
        """The plugin can resolve a key this worker cannot see.

        That is the one case where we know a conversation is leaking and
        cannot stop it, so it earns a warning: the cost lands on the NEXT
        session, which will look healthy and be silent.
        """
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_API_KEY", None)
        monkeypatch.delenv("TAVUS_API_KEY", raising=False)

        with caplog.at_level("WARNING"):
            await video_actor._end_tavus_conversation(
                SimpleNamespace(conversation_id="c00318f5a463545b")
            )

        assert "cannot be ended" in caplog.text
        assert "c00318f5a463545b" in caplog.text

    @pytest.mark.unit
    async def test_ends_the_conversation_it_opened(self, monkeypatch):
        """The end call carries the id and the key, as Tavus wants them."""
        seen: dict = {}

        class _Response:
            status = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

        class _Session:
            def __init__(self, *_, **kwargs):
                seen["timeout"] = kwargs.get("timeout")

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            def post(self, url, headers=None):
                seen["url"] = url
                seen["headers"] = headers
                return _Response()

        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_API_KEY", "sk-test")
        monkeypatch.setattr(video_actor.aiohttp, "ClientSession", _Session)

        await video_actor._end_tavus_conversation(
            SimpleNamespace(conversation_id="conv_1")
        )

        assert seen["url"] == "https://tavusapi.com/v2/conversations/conv_1/end"
        assert seen["headers"] == {"x-api-key": "sk-test"}
        # Teardown runs during shutdown: it must be time-boxed, not best-effort
        # forever, or a slow vendor holds a worker slot behind a dead session.
        assert seen["timeout"] is not None

    @pytest.mark.unit
    async def test_vendor_error_is_reported_not_raised(self, monkeypatch, caplog):
        """Shutdown must survive a vendor that refuses the end call."""

        class _Response:
            status = 500

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

        class _Session:
            def __init__(self, *_, **__):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            def post(self, *_, **__):
                return _Response()

        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_API_KEY", "sk-test")
        monkeypatch.setattr(video_actor.aiohttp, "ClientSession", _Session)

        with caplog.at_level("WARNING"):
            await video_actor._end_tavus_conversation(
                SimpleNamespace(conversation_id="conv_2")
            )

        assert "failed to end tavus conversation conv_2" in caplog.text

    @pytest.mark.unit
    async def test_handle_close_never_raises_when_teardown_breaks(self, monkeypatch):
        """The handle's aclose is the shutdown guard; teardown sits behind it."""

        async def _boom():
            raise RuntimeError("tavus unreachable")

        handle = video_actor.VideoActorHandle(
            provider="tavus", publishes_audio=True, _closer=_boom
        )
        await handle.aclose()

    @pytest.mark.unit
    async def test_only_tavus_gets_the_end_call(self, monkeypatch):
        """Bey's session dies with the room; Tavus's does not.

        Routing this by provider rather than calling it for everyone keeps a
        vendor-specific HTTP call out of every other vendor's shutdown path.
        """
        ended: list = []

        async def _record(avatar):
            ended.append(getattr(avatar, "conversation_id", None))

        monkeypatch.setattr(video_actor, "_end_tavus_conversation", _record)

        class _Avatar:
            conversation_id = "conv_9"

            def __init__(self, **_):
                pass

            async def start(self, *_, **__):
                return None

        for provider in ("tavus", "bey"):
            plugin = SimpleNamespace(
                AvatarSession=_Avatar,
                PersonaConfig=None,
                SimliConfig=None,
            )
            monkeypatch.setattr(
                video_actor.importlib, "import_module", lambda _p, _m=plugin: _m
            )
            monkeypatch.setattr(
                video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", "a1", raising=False
            )
            # The room has to show published video and the session a real
            # output slot: _start_hosted verifies the avatar before it hands
            # back a handle, and restores output.audio when it declines one.
            room = _room(
                _participant("tavus-avatar-agent", kind=_AGENT_KIND, video=True)
            )
            room.name = "r"
            handle = await video_actor._start_hosted(
                provider=provider,
                module_path="fake",
                session=SimpleNamespace(output=SimpleNamespace(audio=None)),
                room=room,
                scenario=None,
                livekit_url="wss://example",
            )
            if handle:
                await handle.aclose()

        assert ended == ["conv_9"]


class TestVendorLiveKitUrl:
    """Which LiveKit URL each vendor is told to dial.

    Tavus cannot publish into a room that already has participants when it is
    pointed at a regional media host — it joins and publishes nothing, which
    reads as a healthy start here and leaves the session silent. Measured
    2026-09-07 across the full matrix; only regional+occupied fails.
    """

    @pytest.mark.unit
    def test_tavus_gets_the_registration_url(self, monkeypatch):
        monkeypatch.setattr(
            video_actor.settings, "LIVEKIT_URL", "wss://proj.livekit.cloud"
        )
        assert (
            video_actor._vendor_livekit_url(
                "tavus", "wss://proj.ohyderabad1a.production.livekit.cloud"
            )
            == "wss://proj.livekit.cloud"
        )

    @pytest.mark.unit
    def test_other_vendors_keep_the_job_url(self, monkeypatch):
        """Beyond Presence handles the regional host, and the job URL is what
        keeps a vendor on the same media server as the learner."""
        monkeypatch.setattr(
            video_actor.settings, "LIVEKIT_URL", "wss://proj.livekit.cloud"
        )
        regional = "wss://proj.ohyderabad1a.production.livekit.cloud"
        for provider in ("bey", "anam", "simli"):
            assert video_actor._vendor_livekit_url(provider, regional) == regional

    @pytest.mark.unit
    def test_falls_back_to_the_job_url_when_unconfigured(self, monkeypatch):
        """A vendor dialling the wrong host may still work; none at all cannot."""
        monkeypatch.setattr(video_actor.settings, "LIVEKIT_URL", None)
        assert (
            video_actor._vendor_livekit_url("tavus", "wss://regional.example")
            == "wss://regional.example"
        )

    @pytest.mark.unit
    def test_scheme_coercion_still_applies_to_the_substituted_url(self, monkeypatch):
        """The registration URL is not exempt from the ws:// contract that
        Beyond Presence rejects an https:// form for."""
        monkeypatch.setattr(
            video_actor.settings, "LIVEKIT_URL", "https://proj.livekit.cloud"
        )
        chosen = video_actor._vendor_livekit_url("tavus", "wss://regional.example")
        assert video_actor._as_websocket_url(chosen) == "wss://proj.livekit.cloud"


class TestProviderResolution:
    """Which vendor a session renders with, and whose key it uses.

    The choice is per-roleplay because it is editorial — which face suits a
    character, and whose lip-sync holds up in the language it is played in —
    while the env var stays the deployment default so nothing that predates
    the field changed behaviour.
    """

    @pytest.mark.unit
    def test_roleplay_choice_wins(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "tavus")
        scenario = SimpleNamespace(
            prompt_data=SimpleNamespace(video_actor_provider="bey")
        )
        assert video_actor._resolve_provider(scenario) == "bey"

    @pytest.mark.unit
    @pytest.mark.parametrize("absent", [None, ""])
    def test_falls_back_to_the_deployment_default(self, monkeypatch, absent):
        """A roleplay that named no vendor behaves exactly as it did before."""
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "bey")
        scenario = SimpleNamespace(
            prompt_data=SimpleNamespace(video_actor_provider=absent)
        )
        assert video_actor._resolve_provider(scenario) == "bey"

    @pytest.mark.unit
    def test_no_scenario_at_all_uses_the_default(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "tavus")
        assert video_actor._resolve_provider(None) == "tavus"

    @pytest.mark.unit
    def test_stored_value_is_normalised(self, monkeypatch):
        """The runtime compares lower-case provider ids, and Studio is not the
        only thing that can write this field."""
        scenario = SimpleNamespace(
            prompt_data=SimpleNamespace(video_actor_provider="  TAVUS  ")
        )
        assert video_actor._resolve_provider(scenario) == "tavus"

    @pytest.mark.unit
    def test_each_vendor_reads_its_own_key(self, monkeypatch):
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_BEY_API_KEY", "bey-key", raising=False
        )
        monkeypatch.setattr(
            video_actor.settings,
            "VIDEO_ACTOR_TAVUS_API_KEY",
            "tavus-key",
            raising=False,
        )
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_API_KEY", "shared-key", raising=False
        )
        assert video_actor._resolve_api_key("bey") == "bey-key"
        assert video_actor._resolve_api_key("tavus") == "tavus-key"

    @pytest.mark.unit
    def test_single_key_deployment_still_works(self, monkeypatch):
        """The fallback is the whole reason this is not a breaking change."""
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_BEY_API_KEY", None, raising=False
        )
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_TAVUS_API_KEY", None, raising=False
        )
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_API_KEY", "shared-key", raising=False
        )
        for provider in ("bey", "tavus"):
            assert video_actor._resolve_api_key(provider) == "shared-key"


class TestDeferralGate:
    """Which sessions bring the avatar up after they start talking."""

    @pytest.mark.unit
    def test_hosted_providers_defer_by_default(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "bey")
        assert video_actor.defers_attach(None) is True

    @pytest.mark.unit
    def test_test_pattern_never_defers(self, monkeypatch):
        """It renders in-process in milliseconds — no delay to hide."""
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_PROVIDER", "test_pattern"
        )
        assert video_actor.defers_attach(None) is False

    @pytest.mark.unit
    def test_the_flag_restores_the_blocking_order(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "bey")
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_DEFER_ATTACH", False, raising=False
        )
        assert video_actor.defers_attach(None) is False

    @pytest.mark.unit
    def test_the_roleplays_own_provider_decides(self, monkeypatch):
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_PROVIDER", "test_pattern"
        )
        scenario = SimpleNamespace(
            prompt_data=SimpleNamespace(video_actor_provider="tavus")
        )
        assert video_actor.defers_attach(scenario) is True


class TestDeferredAttach:
    """The learner must be hearing the character the whole time.

    In the blocking order the agent's audio is suppressed on the strength of a
    vendor promise, and a vendor that accepts the job and renders nothing leaves
    the session silent — observed live, twice. Deferring removes that rather
    than mitigating it: the speech never leaves the agent's own room track until
    an avatar is verifiably rendering, so the worst a vendor can do is leave the
    session faceless.
    """

    ROOM_AUDIO = "room-audio-output"
    VENDOR_AUDIO = "vendor-data-stream-output"

    def _session(self, current_speech=None):
        return SimpleNamespace(
            output=SimpleNamespace(audio=self.ROOM_AUDIO),
            current_speech=current_speech,
        )

    def _install_vendor(self, monkeypatch, *, start=None, published=True):
        """A plugin whose start() hijacks output.audio, as every real one does."""
        vendor_audio = self.VENDOR_AUDIO

        class _Avatar:
            conversation_id = "conv_1"
            started = []

            def __init__(self, **_):
                pass

            async def start(self, session, **kwargs):
                if start is not None:
                    await start(session, **kwargs)
                type(self).started.append(kwargs)
                # Exactly what livekit-plugins-bey/tavus do as the last
                # statement of start(): point the session at their data stream,
                # which withholds every frame until video exists.
                session.output.audio = vendor_audio

        _Avatar.started = []
        plugin = SimpleNamespace(
            AvatarSession=_Avatar, PersonaConfig=None, SimliConfig=None
        )
        monkeypatch.setattr(
            video_actor.importlib, "import_module", lambda _p, _m=plugin: _m
        )
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "bey")
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", "a1", raising=False
        )
        room = _room(
            _participant("bey-avatar-agent", kind=_AGENT_KIND, video=published)
        )
        room.name = "r"
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_BEY_API_KEY", "dummy-api-key"
        )
        return _Avatar, room

    @pytest.mark.unit
    async def test_the_room_track_is_taken_back_before_the_render_wait(
        self, monkeypatch
    ):
        """The invariant. The vendor's output is installed by its start() and
        mutes the character until video arrives, so it must not survive the
        return of that call — the learner is mid-sentence."""
        _, room = self._install_vendor(monkeypatch)
        session = self._session()
        seen = []

        async def _record(room_, timeout):
            seen.append(session.output.audio)
            return True

        monkeypatch.setattr(video_actor, "_await_avatar_video", _record)

        handle = await video_actor.attach_video_actor(
            session=session, room=room, scenario=_scenario(enabled=True)
        )

        assert seen == [self.ROOM_AUDIO]
        assert handle is not None

    @pytest.mark.unit
    async def test_the_swap_commits_once_video_is_live(self, monkeypatch):
        _, room = self._install_vendor(monkeypatch)
        session = self._session()

        handle = await video_actor.attach_video_actor(
            session=session, room=room, scenario=_scenario(enabled=True)
        )

        assert session.output.audio == self.VENDOR_AUDIO
        assert handle is not None
        # True only from the moment the swap lands, so the flag means "the
        # character's voice is on the avatar track" and not "an avatar was
        # requested".
        assert handle.publishes_audio is True

    @pytest.mark.unit
    async def test_a_vendor_that_never_renders_costs_a_face_not_a_voice(
        self, monkeypatch
    ):
        monkeypatch.setattr(
            video_actor.settings,
            "VIDEO_ACTOR_ATTACH_PUBLISH_TIMEOUT_S",
            0.05,
            raising=False,
        )
        _, room = self._install_vendor(monkeypatch, published=False)
        session = self._session()

        handle = await video_actor.attach_video_actor(
            session=session, room=room, scenario=_scenario(enabled=True)
        )

        assert handle is None
        assert session.output.audio == self.ROOM_AUDIO

    @pytest.mark.unit
    async def test_a_raising_start_leaves_the_session_on_its_own_audio(
        self, monkeypatch
    ):
        """The vendor may install its output and then fail; the finally clause
        is what stops that muting a live session."""

        async def _boom(session, **kwargs):
            session.output.audio = self.VENDOR_AUDIO
            raise RuntimeError("vendor down")

        _, room = self._install_vendor(monkeypatch, start=_boom)
        session = self._session()

        handle = await video_actor.attach_video_actor(
            session=session, room=room, scenario=_scenario(enabled=True)
        )

        assert handle is None
        assert session.output.audio == self.ROOM_AUDIO

    @pytest.mark.unit
    async def test_teardown_is_registered_before_the_render_wait(self, monkeypatch):
        """A learner who leaves mid-render must not strand a metered vendor
        conversation, so the handle is handed over before video is verified."""
        monkeypatch.setattr(
            video_actor.settings,
            "VIDEO_ACTOR_ATTACH_PUBLISH_TIMEOUT_S",
            0.05,
            raising=False,
        )
        _, room = self._install_vendor(monkeypatch, published=False)
        held = []

        handle = await video_actor.attach_video_actor(
            session=self._session(),
            room=room,
            scenario=_scenario(enabled=True),
            on_vendor_session=held.append,
        )

        assert handle is None  # the vendor never rendered
        assert len(held) == 1  # but we were given something to close
        assert held[0].publishes_audio is False

    @pytest.mark.unit
    async def test_a_start_that_installs_no_output_is_not_an_avatar(self, monkeypatch):
        class _Avatar:
            def __init__(self, **_):
                pass

            async def start(self, session, **kwargs):
                return None

        plugin = SimpleNamespace(
            AvatarSession=_Avatar, PersonaConfig=None, SimliConfig=None
        )
        monkeypatch.setattr(
            video_actor.importlib, "import_module", lambda _p, _m=plugin: _m
        )
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "bey")
        monkeypatch.setattr(
            video_actor.settings, "VIDEO_ACTOR_AVATAR_ID", "a1", raising=False
        )
        room = _room(_participant("bey-avatar-agent", kind=_AGENT_KIND, video=True))
        room.name = "r"
        session = self._session()

        handle = await video_actor.attach_video_actor(
            session=session, room=room, scenario=_scenario(enabled=True)
        )

        assert handle is None
        assert session.output.audio == self.ROOM_AUDIO

    @pytest.mark.unit
    async def test_inert_when_the_roleplay_has_not_opted_in(self, monkeypatch):
        def _explode(_):
            raise AssertionError("nothing may be imported for an opted-out session")

        monkeypatch.setattr(video_actor.importlib, "import_module", _explode)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)

        assert (
            await video_actor.attach_video_actor(
                session=self._session(), room=_room(), scenario=_scenario()
            )
            is None
        )

    @pytest.mark.unit
    async def test_an_unknown_provider_is_declined(self, monkeypatch):
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_ENABLED", True)
        monkeypatch.setattr(video_actor.settings, "VIDEO_ACTOR_PROVIDER", "nope")
        session = self._session()

        assert (
            await video_actor.attach_video_actor(
                session=session, room=_room(), scenario=_scenario(enabled=True)
            )
            is None
        )
        assert session.output.audio == self.ROOM_AUDIO


class TestQuietMomentWait:
    """When the swap lands. A seam mid-utterance is safe but audible."""

    @pytest.mark.unit
    async def test_idle_session_is_immediately_quiet(self):
        session = SimpleNamespace(current_speech=None)
        assert await video_actor._await_quiet(session, timeout=1.0) is True

    @pytest.mark.unit
    async def test_a_finished_handle_counts_as_quiet(self):
        session = SimpleNamespace(current_speech=SimpleNamespace(done=lambda: True))
        assert await video_actor._await_quiet(session, timeout=1.0) is True

    @pytest.mark.unit
    async def test_it_gives_up_rather_than_waiting_out_a_monologue(self):
        import time as _time

        session = SimpleNamespace(current_speech=SimpleNamespace(done=lambda: False))
        started = _time.monotonic()
        assert await video_actor._await_quiet(session, timeout=0.3) is False
        # Bounded: swapping mid-speech only costs one un-lip-synced line, so
        # waiting longer than this delays the face for less than it saves.
        assert _time.monotonic() - started < 2.0

    @pytest.mark.unit
    async def test_it_waits_for_speech_to_finish(self):
        speaking = {"done": False}
        session = SimpleNamespace(
            current_speech=SimpleNamespace(done=lambda: speaking["done"])
        )

        async def finish_soon():
            import asyncio

            await asyncio.sleep(0.2)
            speaking["done"] = True

        import asyncio

        task = asyncio.create_task(finish_soon())
        assert await video_actor._await_quiet(session, timeout=3.0) is True
        await task
