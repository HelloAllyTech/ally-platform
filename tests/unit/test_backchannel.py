"""Tests for continuous back-channeling during the learner's turn."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

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
