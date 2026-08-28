"""Tests for the voice-naturalness wiring in Roleplay Studio v2.

Covers the shared NaturalnessController's no-op path and worker_v2's scenario
shim mapping (spec flags + persona context -> the duck-typed object the
gating/phrase-generation helpers read).
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.core.livekit.naturalness import NaturalnessController


def _scenario(**flags):
    prompt_data = SimpleNamespace(
        language_label="en-US",
        allowed_fillers=None,
        gender=None,
        title="t",
        name=None,
        profession=None,
        description=None,
        context="ctx",
        role_instructions="be a distressed caller",
        **flags,
    )
    return SimpleNamespace(
        prompt_data=prompt_data,
        language_config=SimpleNamespace(language_code="en-US"),
        voice=None,
    )


class TestNaturalnessController:
    def test_constructs_with_defaults(self):
        controller = NaturalnessController(
            room=SimpleNamespace(name="room-1"),
            session=SimpleNamespace(on=lambda *a, **k: (lambda f: f)),
            tts_client=None,
            llm_client=None,
            scenario=_scenario(
                filler_enabled=False,
                comfort_audio_enabled=False,
                continuous_backchanneling=False,
                interim_reply_enabled=False,
            ),
            joined_iso="2026-07-08T00:00:00Z",
            background_tasks=set(),
            read_history=lambda: [],
        )
        assert controller.room_name == "room-1"
        assert controller._interim_state == "idle"
        assert controller._bg_audio is None

    async def test_all_flags_off_publishes_no_track(self):
        """With every per-session lever off, start() must not publish a track."""
        tasks: set = set()
        controller = NaturalnessController(
            room=SimpleNamespace(name="room-1"),
            session=SimpleNamespace(on=lambda *a, **k: (lambda f: f)),
            tts_client=None,
            llm_client=None,
            scenario=_scenario(
                filler_enabled=False,
                comfort_audio_enabled=False,
                continuous_backchanneling=False,
                interim_reply_enabled=False,
            ),
            joined_iso="2026-07-08T00:00:00Z",
            background_tasks=tasks,
            read_history=lambda: [],
        )
        await controller.start()
        assert controller._bg_audio is None
        assert tasks == set()
        # Teardown is a no-op and must never raise.
        await controller.aclose()

    async def test_comfort_resolver_none_when_disabled(self):
        controller = NaturalnessController(
            room=SimpleNamespace(name="room-1"),
            session=SimpleNamespace(on=lambda *a, **k: (lambda f: f)),
            tts_client=None,
            llm_client=None,
            scenario=_scenario(comfort_audio_enabled=False),
            joined_iso=None,
            background_tasks=set(),
            read_history=lambda: [],
        )
        assert await controller._resolve_comfort_audio() is None


def _controller():
    return NaturalnessController(
        room=SimpleNamespace(name="room-1"),
        session=SimpleNamespace(on=lambda *a, **k: (lambda f: f)),
        tts_client=None,
        llm_client=None,
        scenario=_scenario(
            filler_enabled=False,
            comfort_audio_enabled=False,
            continuous_backchanneling=True,
            interim_reply_enabled=False,
        ),
        joined_iso="2026-07-08T00:00:00Z",
        background_tasks=set(),
        read_history=lambda: [],
    )


class TestBackchannelUserStateStop:
    """Leaving 'speaking' must cut a still-playing back-channel clip immediately."""

    def test_leaving_speaking_flushes_playing_clip(self):
        controller = _controller()
        controller._bg_audio = MagicMock()
        controller._backchannel_clips = [("mm-hmm", "/tmp/mmhmm.wav")]
        handle = MagicMock()
        handle.done.return_value = False
        controller._backchannel_handle = handle
        controller._user_speaking = True

        controller._on_backchannel_user_state(
            SimpleNamespace(new_state="listening")
        )

        handle.stop.assert_called_once()
        # stop() only halts the feeder; frames already buffered in the shared
        # AudioSource keep playing for up to ~1s and bleed into the agent's
        # real reply on its own track unless the queue is flushed too.
        controller._bg_audio.flush.assert_called_once()
        assert controller._backchannel_handle is None


class TestWorkerV2NaturalnessShim:
    async def test_configure_builds_naturalness_scenario(
        self, sample_envelope_dict, monkeypatch
    ):
        """configure() maps spec flags + persona -> the naturalness scenario shim."""
        import app.worker_v2 as worker_v2
        from app.worker_v2 import AgentWorkerV2

        # Turn every flag on so the mapping is observable.
        spec = sample_envelope_dict["spec"]
        spec["fillerEnabled"] = True
        spec["comfortAudioEnabled"] = True
        spec["continuousBackchanneling"] = True
        spec["interimReplyEnabled"] = True

        monkeypatch.setattr(
            worker_v2,
            "configure_stt_client",
            lambda shim: SimpleNamespace(stt_instance=object()),
        )
        monkeypatch.setattr(
            worker_v2,
            "configure_tts_client",
            lambda shim: SimpleNamespace(tts_instance=object()),
        )
        monkeypatch.setattr(
            worker_v2,
            "create_llm_client",
            lambda llm_config=None, language_code=None, **kw: SimpleNamespace(
                llm_instance=object()
            ),
        )

        ctx = SimpleNamespace(
            job=SimpleNamespace(metadata=json.dumps(sample_envelope_dict), id="job-1")
        )
        worker = AgentWorkerV2(ctx)
        await worker.configure()

        scen = worker._naturalness_scenario
        assert scen is not None
        pd = scen.prompt_data
        assert pd.filler_enabled is True
        assert pd.comfort_audio_enabled is True
        assert pd.continuous_backchanneling is True
        assert pd.interim_reply_enabled is True
        # Persona grounding is threaded through for phrase generation.
        assert pd.role_instructions == worker.spec.persona.identity_core
        assert pd.context == worker.spec.persona.scenario_context
        assert scen.language_config.language_code == worker.spec.language_code
