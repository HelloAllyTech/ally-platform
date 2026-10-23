"""Tests for continuous back-channeling during the learner's turn."""

import types
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage

import app.worker as worker
from app.core.livekit import backchannel


class TestIsBackchannelEnabled:
    """Gated by the global kill-switch AND the per-simulation toggle."""

    @staticmethod
    def _scenario(continuous_backchanneling):
        return SimpleNamespace(
            prompt_data=SimpleNamespace(
                continuous_backchanneling=continuous_backchanneling
            )
        )

    @pytest.mark.unit
    def test_enabled_when_global_and_per_sim_on(self, monkeypatch):
        monkeypatch.setattr(backchannel.settings, "BACKCHANNEL_GLOBALLY_ENABLED", True)
        assert backchannel.is_backchannel_enabled(self._scenario(True)) is True

    @pytest.mark.unit
    def test_disabled_by_default_per_sim_off(self, monkeypatch):
        monkeypatch.setattr(backchannel.settings, "BACKCHANNEL_GLOBALLY_ENABLED", True)
        assert backchannel.is_backchannel_enabled(self._scenario(False)) is False

    @pytest.mark.unit
    def test_disabled_when_global_flag_off(self, monkeypatch):
        monkeypatch.setattr(backchannel.settings, "BACKCHANNEL_GLOBALLY_ENABLED", False)
        assert backchannel.is_backchannel_enabled(self._scenario(True)) is False

    @pytest.mark.unit
    def test_disabled_when_prompt_data_missing(self, monkeypatch):
        monkeypatch.setattr(backchannel.settings, "BACKCHANNEL_GLOBALLY_ENABLED", True)
        assert backchannel.is_backchannel_enabled(SimpleNamespace()) is False


def _make_scenario(language_code="hi-IN", language_label="Hindi"):
    prompt_data = SimpleNamespace(
        title="Angry customer",
        name="Ravi",
        profession="Shopkeeper",
        description="A frustrated customer",
        context="A returns counter",
        role_instructions="Be terse",
        language_label=language_label,
    )
    language_config = SimpleNamespace(language_code=language_code)
    return SimpleNamespace(prompt_data=prompt_data, language_config=language_config)


class TestBuildScenarioContext:
    @pytest.mark.unit
    def test_includes_present_fields(self):
        ctx = backchannel._build_scenario_context(_make_scenario())
        assert "Character: Ravi" in ctx
        assert "Profession: Shopkeeper" in ctx

    @pytest.mark.unit
    def test_empty_when_no_prompt_data(self):
        assert backchannel._build_scenario_context(SimpleNamespace()) == ""


class TestGenerateBackchannelPhrases:
    """LLM phrase generation — best-effort, never raises."""

    @pytest.mark.unit
    async def test_returns_empty_without_llm(self):
        out = await backchannel.generate_backchannel_phrases(None, _make_scenario())
        assert out == []

    @pytest.mark.unit
    async def test_returns_empty_for_nonpositive_count(self):
        llm = MagicMock()
        out = await backchannel.generate_backchannel_phrases(
            llm, _make_scenario(), count=0
        )
        assert out == []

    @pytest.mark.unit
    async def test_cleans_and_dedupes(self, monkeypatch):
        # Stub the prompt resolution so no template/IO is needed.
        monkeypatch.setattr(
            backchannel, "load_and_format", lambda *a, **k: "SYSTEM PROMPT"
        )
        structured = AsyncMock()
        structured.ainvoke = AsyncMock(
            return_value=SimpleNamespace(
                phrases=["हाँ", " हाँ ", "अच्छा", "", 5, "ठीक है"]
            )
        )
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        llm_client = SimpleNamespace(llm_instance=llm_instance)

        out = await backchannel.generate_backchannel_phrases(
            llm_client, _make_scenario(), count=6
        )
        # Duplicate ("हाँ" twice), empty, and non-str (5) dropped.
        assert out == ["हाँ", "अच्छा", "ठीक है"]

    @pytest.mark.unit
    async def test_respects_count_cap(self, monkeypatch):
        monkeypatch.setattr(
            backchannel, "load_and_format", lambda *a, **k: "SYSTEM PROMPT"
        )
        structured = AsyncMock()
        structured.ainvoke = AsyncMock(
            return_value=SimpleNamespace(phrases=["a", "b", "c", "d"])
        )
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        llm_client = SimpleNamespace(llm_instance=llm_instance)

        out = await backchannel.generate_backchannel_phrases(
            llm_client, _make_scenario(), count=2
        )
        assert out == ["a", "b"]

    @pytest.mark.unit
    async def test_empty_template_skips(self, monkeypatch):
        monkeypatch.setattr(backchannel, "load_and_format", lambda *a, **k: "")
        llm_client = SimpleNamespace(llm_instance=MagicMock())
        out = await backchannel.generate_backchannel_phrases(
            llm_client, _make_scenario()
        )
        assert out == []

    @pytest.mark.unit
    async def test_never_raises_on_llm_error(self, monkeypatch):
        monkeypatch.setattr(
            backchannel, "load_and_format", lambda *a, **k: "SYSTEM PROMPT"
        )

        def boom(*_a, **_k):
            raise RuntimeError("llm down")

        llm_instance = MagicMock()
        llm_instance.with_structured_output = boom
        llm_client = SimpleNamespace(llm_instance=llm_instance)

        out = await backchannel.generate_backchannel_phrases(
            llm_client, _make_scenario()
        )
        assert out == []


class TestBackchannelUsage:
    """The call's tokens reach llm_usage under their own label."""

    @staticmethod
    def _client(result):
        structured = AsyncMock()
        structured.ainvoke = AsyncMock(return_value=result)
        llm_instance = MagicMock(model_name="gpt-4o-mini")
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        return SimpleNamespace(llm_instance=llm_instance, provider="openai")

    @staticmethod
    def _raw():
        return AIMessage(
            content="",
            usage_metadata={
                "input_tokens": 120,
                "output_tokens": 30,
                "total_tokens": 150,
            },
        )

    @pytest.fixture
    def emitted(self, monkeypatch):
        monkeypatch.setattr(
            backchannel, "load_and_format", lambda *a, **k: "SYSTEM PROMPT"
        )
        calls = []
        monkeypatch.setattr(
            "app.core.llm_usage.emitter.emit_llm_usage",
            lambda **kwargs: calls.append(kwargs),
        )
        return calls

    @pytest.mark.unit
    async def test_emits_usage_under_backchannel_label(self, emitted):
        llm_client = self._client(
            {
                "raw": self._raw(),
                "parsed": backchannel._BackchannelPhrases(phrases=["हाँ", "अच्छा"]),
                "parsing_error": None,
            }
        )
        scenario = _make_scenario()
        scenario.id = 42

        out = await backchannel.generate_backchannel_phrases(
            llm_client, scenario, count=6, room_id="room-1"
        )

        assert out == ["हाँ", "अच्छा"]
        llm_client.llm_instance.with_structured_output.assert_called_once_with(
            backchannel._BackchannelPhrases, include_raw=True
        )
        assert emitted == [
            {
                "room_id": "room-1",
                "provider": "openai",
                "model": "gpt-4o-mini",
                "task": "backchannel_phrases",
                "usage": (120, 30, 150, 0),
                "scenario_id": 42,
            }
        ]

    @pytest.mark.unit
    async def test_parse_failure_still_emits_usage(self, emitted):
        llm_client = self._client(
            {"raw": self._raw(), "parsed": None, "parsing_error": ValueError("bad")}
        )

        out = await backchannel.generate_backchannel_phrases(
            llm_client, _make_scenario(), room_id="room-1"
        )

        assert out == []
        assert [c["task"] for c in emitted] == ["backchannel_phrases"]

    @pytest.mark.unit
    async def test_no_usage_metadata_emits_nothing(self, emitted):
        llm_client = self._client(
            {
                "raw": AIMessage(content=""),
                "parsed": backchannel._BackchannelPhrases(phrases=["mm-hmm"]),
                "parsing_error": None,
            }
        )

        out = await backchannel.generate_backchannel_phrases(
            llm_client, _make_scenario(), room_id="room-1"
        )

        assert out == ["mm-hmm"]
        assert emitted == []


class _MockCtx:
    def __init__(self):
        self.room = types.SimpleNamespace(name="room-1")
        self.proc = types.SimpleNamespace(userdata={})
        self.job = types.SimpleNamespace(metadata="{}", id="test-job")


def _backchannel_worker(monkeypatch):
    """A bare AgentWorker wired up just enough to exercise backchannel stop."""
    w = worker.AgentWorker(_MockCtx())
    w._bg_audio = MagicMock()
    w._backchannel_clips = [("mm-hmm", "/tmp/mmhmm.wav")]
    return w


class TestUserStateStop:
    """Leaving 'speaking' must cut a still-playing back-channel clip immediately."""

    @pytest.mark.unit
    def test_leaving_speaking_flushes_playing_clip(self, monkeypatch):
        w = _backchannel_worker(monkeypatch)
        handle = MagicMock()
        handle.done.return_value = False
        w._backchannel_handle = handle
        w._user_speaking = True

        w._on_backchannel_user_state(types.SimpleNamespace(new_state="listening"))

        handle.stop.assert_called_once()
        # stop() only halts the feeder; frames already buffered in the shared
        # AudioSource keep playing for up to ~1s and bleed into the agent's
        # real reply on its own track unless the queue is flushed too.
        w._bg_audio.flush.assert_called_once()
        assert w._backchannel_handle is None

    @pytest.mark.unit
    def test_no_flush_when_no_clip_playing(self, monkeypatch):
        w = _backchannel_worker(monkeypatch)
        w._backchannel_handle = None
        w._user_speaking = True

        w._on_backchannel_user_state(types.SimpleNamespace(new_state="listening"))

        w._bg_audio.flush.assert_not_called()
