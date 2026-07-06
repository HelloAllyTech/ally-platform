"""Unit tests for prompt-level LLM model/temperature precedence.

Precedence chain: code default → language llm_config → prompt-level → simulation
(temperature only). These tests patch ``create_llm_client`` to assert what the
resolver forwards, rather than constructing real provider clients.
"""

from unittest.mock import Mock, patch

import pytest

from app.core.agent.factory import (
    DEFAULT_MAIN_AGENT_PROMPT_CODE,
    build_llm_client_for_prompt,
    configure_llm_client,
    get_prompt_llm_overrides,
    resolve_call_site_llm_client,
)
from app.llms.factory import infer_provider_from_model


def _scenario(prompts=None, sim_temperature=None, selected_main=None, llm_config=None):
    scenario = Mock()
    scenario.language_config.llm_config = llm_config
    scenario.language_config.language_code = "en-IN"
    scenario.prompt_data.prompts = prompts or {}
    scenario.prompt_data.temperature = sim_temperature
    scenario.prompt_data.selected_main_prompt_code = selected_main
    return scenario


class TestInferProviderFromModel:
    @pytest.mark.unit
    @pytest.mark.parametrize(
        "model,expected",
        [
            ("gpt-4o", "openai"),
            ("gpt-4o-mini", "openai"),
            ("o3-mini", "openai"),
            ("gemini-2.5-flash", "gemini"),
            ("google/gemini-pro", "gemini"),  # 'google' prefix maps to Gemini
            ("claude-opus-4-7", None),  # Anthropic unsupported by the voice runtime
            (None, None),
            ("", None),
        ],
    )
    def test_infer(self, model, expected):
        assert infer_provider_from_model(model) == expected


class TestGetPromptLlmOverrides:
    @pytest.mark.unit
    def test_reads_provider_model_and_temperature(self):
        sc = _scenario(
            prompts={
                "p": {
                    "provider": "gemini",
                    "model": "gemini-2.5-pro",
                    "temperature": 0.3,
                }
            }
        )
        assert get_prompt_llm_overrides(sc.prompt_data, "p") == (
            "gemini",
            "gemini-2.5-pro",
            0.3,
        )

    @pytest.mark.unit
    def test_model_without_explicit_provider(self):
        sc = _scenario(prompts={"p": {"model": "gpt-4o", "temperature": 0.3}})
        assert get_prompt_llm_overrides(sc.prompt_data, "p") == (None, "gpt-4o", 0.3)

    @pytest.mark.unit
    def test_clamps_out_of_range(self):
        sc = _scenario(prompts={"p": {"temperature": 5}})
        assert get_prompt_llm_overrides(sc.prompt_data, "p") == (None, None, 2.0)

    @pytest.mark.unit
    def test_invalid_temperature_is_none(self):
        sc = _scenario(prompts={"p": {"temperature": "hot"}})
        assert get_prompt_llm_overrides(sc.prompt_data, "p") == (None, None, None)

    @pytest.mark.unit
    def test_missing_code_or_string_entry(self):
        sc = _scenario(prompts={"p": "just the prompt text"})
        assert get_prompt_llm_overrides(sc.prompt_data, "p") == (None, None, None)
        assert get_prompt_llm_overrides(sc.prompt_data, "absent") == (None, None, None)


class TestBuildLlmClientForPrompt:
    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_forwards_prompt_overrides(self, mock_create):
        sc = _scenario(prompts={"p": {"model": "gemini-2.5-flash", "temperature": 0.4}})
        build_llm_client_for_prompt(sc, "p", base_llm_config={"provider": "openai"})
        kwargs = mock_create.call_args.kwargs
        assert kwargs["model"] == "gemini-2.5-flash"
        assert kwargs["temperature"] == 0.4

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_simulation_temperature_wins(self, mock_create):
        sc = _scenario(prompts={"p": {"temperature": 0.4}})
        build_llm_client_for_prompt(sc, "p", simulation_temperature=0.9)
        assert mock_create.call_args.kwargs["temperature"] == 0.9

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_no_overrides_passes_none(self, mock_create):
        sc = _scenario(prompts={})
        build_llm_client_for_prompt(sc, "p")
        kwargs = mock_create.call_args.kwargs
        assert kwargs["model"] is None
        assert kwargs["temperature"] is None


class TestConfigureLlmClientPrecedence:
    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_main_agent_prompt_override_applied(self, mock_create):
        sc = _scenario(
            prompts={
                DEFAULT_MAIN_AGENT_PROMPT_CODE: {"model": "gpt-4o", "temperature": 0.2}
            }
        )
        configure_llm_client(sc)
        kwargs = mock_create.call_args.kwargs
        assert kwargs["model"] == "gpt-4o"
        assert kwargs["temperature"] == 0.2

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_simulation_temperature_overrides_prompt(self, mock_create):
        sc = _scenario(
            prompts={
                DEFAULT_MAIN_AGENT_PROMPT_CODE: {"model": "gpt-4o", "temperature": 0.2}
            },
            sim_temperature=0.95,
        )
        configure_llm_client(sc)
        kwargs = mock_create.call_args.kwargs
        assert kwargs["model"] == "gpt-4o"  # model still from prompt
        assert kwargs["temperature"] == 0.95  # simulation wins

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_selected_variant_code_used(self, mock_create):
        sc = _scenario(
            prompts={"ally_ai_learn_system_main_agent_prompt_v2": {"temperature": 0.1}},
            selected_main="ally_ai_learn_system_main_agent_prompt_v2",
        )
        configure_llm_client(sc)
        assert mock_create.call_args.kwargs["temperature"] == 0.1

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_unrunnable_model_falls_back_without_override(self, mock_create):
        # A prompt model the runtime can't build (e.g. provider with no key)
        # must NOT kill the session: the fallback drops the model override.
        fallback = Mock(name="fallback_client")

        def side_effect(*_args, **kwargs):
            if kwargs.get("model"):
                raise ValueError("no API key configured for provider")
            return fallback

        mock_create.side_effect = side_effect
        sc = _scenario(
            prompts={
                DEFAULT_MAIN_AGENT_PROMPT_CODE: {
                    "model": "gemini-2.5-pro",
                    "temperature": 0.3,
                }
            }
        )
        result = configure_llm_client(sc)
        assert result is fallback
        # The surviving call carries no model override (safe default).
        assert mock_create.call_args.kwargs.get("model") is None


class TestResolveCallSiteLlmClient:
    """Auxiliary call sites reuse the shared client unless the prompt overrides."""

    @pytest.mark.unit
    def test_no_override_returns_default_client(self):
        sc = _scenario(prompts={})
        default = Mock(name="default_client")
        result = resolve_call_site_llm_client(sc, "p", default_client=default)
        assert result is default  # identical client, zero behaviour change

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_override_builds_new_client(self, mock_create):
        built = Mock(name="built_client")
        mock_create.return_value = built
        sc = _scenario(prompts={"p": {"model": "gpt-4o-mini", "temperature": 0.5}})
        default = Mock(name="default_client")
        result = resolve_call_site_llm_client(sc, "p", default_client=default)
        assert result is built
        assert mock_create.call_args.kwargs["model"] == "gpt-4o-mini"
        assert mock_create.call_args.kwargs["temperature"] == 0.5

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client", side_effect=RuntimeError("boom"))
    def test_falls_back_to_default_on_error(self, _mock_create):
        sc = _scenario(prompts={"p": {"model": "gpt-4o"}})
        default = Mock(name="default_client")
        # A failure building the override must not break the call site.
        assert resolve_call_site_llm_client(sc, "p", default_client=default) is default
