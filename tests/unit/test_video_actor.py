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

from app.core.livekit import video_actor


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
            handle = await video_actor._start_hosted(
                provider=provider,
                module_path="fake",
                session=SimpleNamespace(),
                room=SimpleNamespace(name="r"),
                scenario=None,
                livekit_url="wss://example",
            )
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
