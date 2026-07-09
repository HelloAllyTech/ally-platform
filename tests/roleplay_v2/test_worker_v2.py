"""worker_v2 tests: importability, engine-marker gate, configure wiring."""

import json
from types import SimpleNamespace

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
            captured.setdefault("llm_configs", []).append(
                (llm_config, language_code)
            )
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
        (actor_cfg, actor_lang), (director_cfg, director_lang) = captured[
            "llm_configs"
        ]
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


class TestConfigDefaults:
    def test_v2_settings_present(self):
        # AGENT_NAME_V2 is derived as f"{AGENT_NAME}V2" when not set explicitly,
        # so it inherits the v1 name's per-environment namespacing. With the
        # default AGENT_NAME="Agent" this is still "AgentV2".
        assert settings.AGENT_NAME_V2 == f"{settings.AGENT_NAME}V2"
        assert settings.DIRECTOR_TIMEOUT_S == 8.0
        assert settings.DIRECTOR_GRACE_MS == 0.0
        assert settings.REHEARSAL_CONCURRENCY_LIMIT == 2
        assert settings.REHEARSAL_TURNS_DEFAULT == 12
        assert settings.ROLEPLAY_V2_ENABLED is True
        assert settings.ACTOR_DEFAULT_MODEL
        assert settings.DIRECTOR_MODEL
        assert settings.REHEARSAL_JUDGE_MODEL

    def test_webhook_endpoint_constant(self):
        from app.core.constants import ROLEPLAY_REHEARSAL_WEBHOOK_ENDPOINT

        assert (
            ROLEPLAY_REHEARSAL_WEBHOOK_ENDPOINT
            == "/v1/roleplay-studio/rehearsals/webhook"
        )
