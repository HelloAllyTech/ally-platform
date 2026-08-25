"""worker_v2 tests: importability, engine-marker gate, configure wiring."""

import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.core.config import settings
from app.core.constants import Environment


def _ctx(metadata: str):
    return SimpleNamespace(job=SimpleNamespace(metadata=metadata, id="job-1"))


class TestModule:
    def test_module_imports(self):
        import app.worker_v2 as worker_v2

        assert callable(worker_v2.entrypoint)
        assert callable(worker_v2.prewarm)

    def test_worker_v1_untouched_and_importable(self):
        import app.worker as worker

        assert callable(worker.entrypoint)


class TestEngineMarkerGate:
    async def test_refuses_non_v2_metadata_outside_local(self, monkeypatch):
        from app.worker_v2 import AgentWorkerV2

        monkeypatch.setattr(settings, "ENV", Environment.DEV)
        metadata = json.dumps({"engine": "v1-scenario", "spec": None})
        worker = AgentWorkerV2(_ctx(metadata))
        with pytest.raises(ValueError, match="refusing"):
            await worker.configure()

    async def test_missing_metadata_outside_local_raises(self, monkeypatch):
        from app.worker_v2 import AgentWorkerV2

        monkeypatch.setattr(settings, "ENV", Environment.DEV)
        worker = AgentWorkerV2(_ctx(""))
        with pytest.raises(ValueError, match="missing or invalid"):
            await worker.configure()


class TestConfigure:
    async def test_configure_builds_clients_from_sample_envelope(
        self, sample_envelope_dict, monkeypatch
    ):
        """configure() wires spec → STT/TTS shims → actor/director LLMs.

        The real client factories are faked (no network in tests); the
        assertions cover the duck-typed shim shape and the LLM configs
        derived from the spec's actorModel/directorModel.
        """
        import app.worker_v2 as worker_v2
        from app.worker_v2 import AgentWorkerV2

        captured = {}

        def fake_stt(shim):
            captured["stt_shim"] = shim
            return SimpleNamespace(stt_instance=object())

        def fake_tts(shim):
            captured["tts_shim"] = shim
            return SimpleNamespace(tts_instance=object())

        def fake_llm(llm_config=None, language_code=None, **kwargs):
            captured.setdefault("llm_configs", []).append((llm_config, language_code))
            return SimpleNamespace(llm_instance=object())

        monkeypatch.setattr(worker_v2, "configure_stt_client", fake_stt)
        monkeypatch.setattr(worker_v2, "configure_tts_client", fake_tts)
        monkeypatch.setattr(worker_v2, "create_llm_client", fake_llm)

        worker = AgentWorkerV2(_ctx(json.dumps(sample_envelope_dict)))
        await worker.configure()

        assert worker.spec is not None
        assert worker.spec.title.startswith("Maya")
        assert worker.joined_iso is not None

        # The shim exposes exactly what the v1 factories duck-type on.
        shim = captured["tts_shim"]
        assert shim.language_config.language_code == "en-IN"
        assert shim.voice.provider == "elevenlabs"
        assert shim.voice.config.voice_id == "EXAVITQu4vr4xnSDxMaL"
        assert shim.prompt_data.gender is None
        assert captured["stt_shim"] is shim or (
            captured["stt_shim"].language_config.language_code == "en-IN"
        )

        # Actor + director LLMs built from the spec's model choices.
        (actor_cfg, actor_lang), (director_cfg, director_lang) = captured["llm_configs"]
        assert actor_cfg["provider"] == "openai"
        assert actor_cfg["config"]["model"] == "gpt-4o-mini"
        assert actor_lang == "en-IN"
        assert director_cfg["config"]["temperature"] == 0
        assert director_lang == "en-IN"

    async def test_turn_detection_falls_back_without_vad(self, sample_envelope_dict):
        from app.worker_v2 import AgentWorkerV2

        worker = AgentWorkerV2(_ctx(json.dumps(sample_envelope_dict)))
        detection, kwargs = worker._resolve_turn_detection(None)
        assert detection is None
        assert kwargs == {}


class TestNoiseCancellationRequiresCloud:
    """Krisp BVC only runs on LiveKit Cloud (mirrors the v1 worker test).

    On the self-hosted SFU the Rust SDK rejects the filter ("audio filter
    cannot be enabled: LiveKit Cloud is required") and the session runs with
    noise cancellation off regardless, so v2 must not pass one there.
    """

    def _prepare(self, monkeypatch, captured):
        import app.worker_v2 as worker_v2
        from app.worker_v2 import AgentWorkerV2

        class DummyRIO:
            def __init__(self, **kwargs):
                captured["noise_cancellation"] = kwargs.get("noise_cancellation")

        class DummySession:
            async def start(self, room, agent, room_input_options):
                self.started = True

            def generate_reply(self):
                return None

        monkeypatch.setattr(worker_v2, "RoomInputOptions", DummyRIO)
        monkeypatch.setattr(worker_v2.noise_cancellation, "BVC", lambda: "FRESH_BVC")

        async def _connect():
            return None

        ctx = SimpleNamespace(
            room=SimpleNamespace(name="room-1", remote_participants={}),
            proc=SimpleNamespace(userdata={"bvc": "PREWARMED_BVC"}),
            connect=_connect,
        )

        class DummyNaturalness:
            def __init__(self, **kwargs):
                pass

            async def start(self):
                return None

        w = AgentWorkerV2(ctx)
        w.session = DummySession()
        w.agent = object()
        w.spec = SimpleNamespace(opening_statement=None)
        w.director = SimpleNamespace(start_time_events=lambda: None)
        # Orphan deadline, naturalness and start metrics are side paths; the
        # assertion is only about what session.start() was handed.

        async def _noop_orphan(timeout):
            return None

        monkeypatch.setattr(w, "_arm_orphan_deadline", _noop_orphan)
        monkeypatch.setattr(w, "_emit_start_metrics", lambda: None)
        monkeypatch.setattr(
            "app.core.livekit.naturalness.NaturalnessController", DummyNaturalness
        )
        return w

    async def test_self_hosted_deployment_gets_no_filter(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(settings, "LIVEKIT_URL", "wss://livekit.internal")
        w = self._prepare(monkeypatch, captured)

        await w.start()

        assert captured["noise_cancellation"] is None

    async def test_cloud_deployment_still_gets_the_filter(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(settings, "LIVEKIT_URL", "wss://ally.livekit.cloud")
        w = self._prepare(monkeypatch, captured)

        await w.start()

        assert captured["noise_cancellation"] == "PREWARMED_BVC"

    async def test_job_assigned_to_a_non_cloud_media_url_gets_no_filter(
        self, monkeypatch
    ):
        # The room connects to RunningJobInfo.url, not to the URL the worker
        # registered with — judge the former (mirrors the v1 worker test).
        captured = {}
        monkeypatch.setattr(settings, "LIVEKIT_URL", "wss://ally.livekit.cloud")
        w = self._prepare(monkeypatch, captured)
        w.ctx._info = SimpleNamespace(url="wss://sfu.internal")

        await w.start()

        assert captured["noise_cancellation"] is None

    async def test_kill_switch_off_declines_the_filter_on_cloud(self, monkeypatch):
        captured = {}
        monkeypatch.setattr(settings, "LIVEKIT_URL", "wss://ally.livekit.cloud")
        monkeypatch.setattr(settings, "LIVEKIT_NOISE_CANCELLATION_ENABLED", False)
        w = self._prepare(monkeypatch, captured)

        await w.start()

        assert captured["noise_cancellation"] is None


class TestConfigDefaults:
    def test_v2_settings_present(self):
        # AGENT_NAME_V2 is derived as f"{AGENT_NAME}V2" when not set explicitly,
        # so it inherits the v1 name's per-environment namespacing. With the
        # default AGENT_NAME="Agent" this is still "AgentV2".
        assert settings.AGENT_NAME_V2 == f"{settings.AGENT_NAME}V2"
        assert settings.DIRECTOR_TIMEOUT_S == 8.0
        assert settings.DIRECTOR_GRACE_MS == 0.0
        assert settings.ROLEPLAY_V2_ENABLED is True
        assert settings.ACTOR_DEFAULT_MODEL
        assert settings.DIRECTOR_MODEL


class TestStartupFailureShutsDownJob:
    """A startup failure (configure/initialize/start, all pre-connect or
    racing it) must call ctx.shutdown() explicitly.

    livekit-agents' run_job() only resolves its shutdown future when
    ctx.connect(), ctx.shutdown(), or a room-disconnect event fires — an
    unhandled exception in the job task alone does none of those, so the
    job process hangs forever, the agent never joins, and the room is never
    freed. This is the same failure mode fixed once already for a specific
    cause (commit dd61115, "roleplay_v2: coerce numeric IDs in spec envelope
    (fix v2 agent-join hang)"); this test guards the general case so any
    future configure()/initialize()/start() failure fails the job cleanly
    instead of hanging silently.
    """

    def _ctx(self):
        return SimpleNamespace(
            job=SimpleNamespace(id="job-1"),
            room=SimpleNamespace(name="room-1"),
            shutdown=Mock(),
        )

    async def test_configure_failure_shuts_down_the_job(self, monkeypatch):
        import app.worker_v2 as worker_v2

        class ExplodingWorker:
            _timing: dict = {}

            def __init__(self, ctx):
                pass

            async def configure(self):
                raise ValueError("bad metadata")

        monkeypatch.setattr(settings, "ROLEPLAY_V2_ENABLED", True)
        monkeypatch.setattr(worker_v2, "AgentWorkerV2", ExplodingWorker)

        ctx = self._ctx()
        with pytest.raises(ValueError, match="bad metadata"):
            await worker_v2.entrypoint(ctx)

        ctx.shutdown.assert_called_once()

    async def test_initialize_failure_shuts_down_the_job(self, monkeypatch):
        import app.worker_v2 as worker_v2

        class ExplodingWorker:
            _timing: dict = {}

            def __init__(self, ctx):
                pass

            async def configure(self):
                pass

            async def initialize(self):
                raise RuntimeError("director wiring failed")

        monkeypatch.setattr(settings, "ROLEPLAY_V2_ENABLED", True)
        monkeypatch.setattr(worker_v2, "AgentWorkerV2", ExplodingWorker)

        ctx = self._ctx()
        with pytest.raises(RuntimeError, match="director wiring failed"):
            await worker_v2.entrypoint(ctx)

        ctx.shutdown.assert_called_once()
