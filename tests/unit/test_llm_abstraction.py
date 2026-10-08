"""Comprehensive tests for LLM abstraction."""

from unittest.mock import Mock, patch

import pytest

from app.llms.base import BaseLLMClient
from app.llms.factory import create_llm_client, model_supports_temperature
from app.llms.openai import OpenAILLMClient


class TestModelSupportsTemperature:
    """OpenAI reasoning models reject a custom temperature."""

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "model,expected",
        [
            ("gpt-4o", True),
            ("gpt-4o-mini", True),
            ("gpt-4.1", True),
            ("gemini-2.5-pro", True),
            ("gemini-2.5-flash", True),
            ("gemini-3-pro-preview", False),
            ("gemini-3.1-pro-preview", False),
            ("models/gemini-3.6-flash", False),
            ("gemini-flash-latest", False),
            ("gpt-5", False),
            ("gpt-5-mini", False),
            ("o1", False),
            ("o3-mini", False),
            ("o4-mini", False),
            (None, True),
        ],
    )
    def test_supports(self, model, expected):
        assert model_supports_temperature(model) is expected

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "model,sent",
        [("gemini-2.5-flash", 0.3), ("gemini-3-flash-preview", None)],
    )
    def test_gemini_client_omits_temperature_for_gemini_3(self, model, sent):
        """Gemini 3+ gets no temperature on the wire: neither the override nor
        langchain's 0.7 default (its request builder drops None fields)."""
        from app.llms.gemini import GeminiLLMClient

        client = GeminiLLMClient(
            model=model, language_code="en-IN", temperature=0.3, api_key="test"
        )
        assert client.llm_instance.temperature == sent

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_temperature_dropped_for_reasoning_model(self, mock_llm_class):
        """A custom temperature is omitted (not 400'd) for a no-temp model."""
        mock_llm_class.from_config.return_value = Mock()
        create_llm_client(language_code="en-IN", model="gpt-5", temperature=0.3)
        mock_llm_class.from_config.assert_called_once_with(
            config={"model": "gpt-5"},
            language_code="en-IN",
        )


class TestBaseLLMClient:
    """Test cases for BaseLLMClient abstract class."""

    @pytest.mark.unit
    def test_cannot_instantiate_base_class(self):
        """Test that BaseLLMClient cannot be instantiated directly."""
        with pytest.raises(TypeError):
            BaseLLMClient()

    @pytest.mark.unit
    def test_base_class_has_llm_instance_property(self):
        """Test that BaseLLMClient defines llm_instance property."""
        assert hasattr(BaseLLMClient, "llm_instance")


class TestOpenAILLMClient:
    """Test cases for OpenAILLMClient class."""

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_openai_llm_client_init_success(
        self, mock_settings, mock_chat_openai_class
    ):
        """Test successful OpenAILLMClient initialization."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        client = OpenAILLMClient(model="gpt-4o-mini", language_code="en-IN")

        assert isinstance(client, BaseLLMClient)
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-api-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
        )
        assert client.llm_instance == mock_llm_instance

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_openai_llm_client_with_hi_in(self, mock_settings, mock_chat_openai_class):
        """Test OpenAILLMClient with Hindi language code."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        client = OpenAILLMClient(model="gpt-4o-mini", language_code="hi-IN")

        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-api-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
        )
        assert client.llm_instance == mock_llm_instance

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_openai_llm_client_streaming_enabled(
        self, mock_settings, mock_chat_openai_class
    ):
        """STREAM_RESPONSE=True enables token streaming on the chat model."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = True
        mock_chat_openai_class.return_value = Mock()

        OpenAILLMClient(model="gpt-4o-mini", language_code="en-IN")

        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-api-key",
            timeout=30,
            max_retries=1,
            streaming=True,
            stream_usage=True,
        )

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_openai_llm_client_custom_temperature(
        self, mock_settings, mock_chat_openai_class
    ):
        """Test OpenAILLMClient with custom temperature."""
        mock_settings.STREAM_RESPONSE = False
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        client = OpenAILLMClient(
            model="gpt-4o-mini",
            language_code="en-IN",
            temperature=0.9,
            api_key="custom-key",
        )

        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.9,
            api_key="custom-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
        )
        assert client.llm_instance == mock_llm_instance

    @pytest.mark.unit
    def test_openai_llm_client_missing_model(self):
        """Test OpenAILLMClient with missing model."""
        with pytest.raises(ValueError, match="OpenAI LLM requires 'model' parameter"):
            OpenAILLMClient(model="", language_code="en-IN")

    @pytest.mark.unit
    def test_openai_llm_client_missing_language_code(self):
        """Test OpenAILLMClient with missing language code."""
        with pytest.raises(
            ValueError, match="OpenAI LLM requires 'language_code' parameter"
        ):
            OpenAILLMClient(model="gpt-4o-mini", language_code="")

    @pytest.mark.unit
    @patch("app.llms.openai.settings")
    def test_openai_llm_client_missing_api_key(self, mock_settings):
        """Test OpenAILLMClient with missing API key."""
        mock_settings.OPENAI_API_KEY = None
        mock_settings.LLM_TEMPERATURE = "0.7"

        with pytest.raises(ValueError, match="OpenAI LLM requires 'api_key' parameter"):
            OpenAILLMClient(model="gpt-4o-mini", language_code="en-IN")

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_openai_llm_client_from_config(self, mock_settings, mock_chat_openai_class):
        """Test OpenAILLMClient.from_config method."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        config = {"model": "gpt-4", "temperature": 0.8}
        client = OpenAILLMClient.from_config(config=config, language_code="en-IN")

        assert isinstance(client, OpenAILLMClient)
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4",
            temperature=0.8,
            api_key="test-api-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
        )
        assert client.llm_instance == mock_llm_instance

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_openai_llm_client_from_config_nested(
        self, mock_settings, mock_chat_openai_class
    ):
        """Test OpenAILLMClient.from_config with nested config structure."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        # Simulate nested config structure (from factory)
        config = {"config": {"model": "gpt-4", "temperature": 0.8}}
        client = OpenAILLMClient.from_config(config=config, language_code="en-IN")

        assert isinstance(client, OpenAILLMClient)
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4",
            temperature=0.8,
            api_key="test-api-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
        )


class TestLLMFactory:
    """Test cases for create_llm_client factory function."""

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_create_llm_client_with_defaults(self, mock_llm_class):
        """Test create_llm_client uses defaults when no config provided."""
        mock_client = Mock()
        mock_llm_class.from_config.return_value = mock_client

        result = create_llm_client(language_code="en-IN")

        mock_llm_class.from_config.assert_called_once_with(
            config={"model": "gpt-4o-mini"},
            language_code="en-IN",
        )
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_create_llm_client_with_metadata_config(self, mock_llm_class):
        """Test create_llm_client uses config from metadata with nested
        config structure."""
        mock_client = Mock()
        mock_llm_class.from_config.return_value = mock_client

        llm_config = {
            "provider": "openai",
            "config": {"model": "gpt-4", "temperature": 0.7},
        }
        result = create_llm_client(llm_config=llm_config, language_code="en-IN")

        mock_llm_class.from_config.assert_called_once_with(
            config={"model": "gpt-4", "temperature": 0.7},
            language_code="en-IN",
        )
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_create_llm_client_backward_compatible_flat_structure(self, mock_llm_class):
        """Test create_llm_client supports backward-compatible flat structure."""
        mock_client = Mock()
        mock_llm_class.from_config.return_value = mock_client

        # Old flat structure (backward compatibility)
        llm_config = {"provider": "openai", "model": "gpt-4", "temperature": 0.7}
        result = create_llm_client(llm_config=llm_config, language_code="en-IN")

        mock_llm_class.from_config.assert_called_once_with(
            config={"model": "gpt-4", "temperature": 0.7},
            language_code="en-IN",
        )
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.llms.factory.GeminiLLMClient")
    def test_create_llm_client_with_google_provider(self, mock_gemini_class):
        """Test create_llm_client with 'google' provider."""
        mock_client = Mock()
        mock_gemini_class.from_config.return_value = mock_client

        llm_config = {
            "provider": "google",
            "config": {"model": "gemini-pro", "temperature": 0.7},
        }
        result = create_llm_client(llm_config=llm_config, language_code="en-IN")

        mock_gemini_class.from_config.assert_called_once_with(
            config={"model": "gemini-pro", "temperature": 0.7},
            language_code="en-IN",
        )
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.llms.factory.GeminiLLMClient")
    def test_create_llm_client_with_gemini_provider(self, mock_gemini_class):
        """Test create_llm_client with 'gemini' provider (backward compatibility)."""
        mock_client = Mock()
        mock_gemini_class.from_config.return_value = mock_client

        llm_config = {
            "provider": "gemini",
            "config": {"model": "gemini-pro", "temperature": 0.7},
        }
        result = create_llm_client(llm_config=llm_config, language_code="en-IN")

        mock_gemini_class.from_config.assert_called_once_with(
            config={"model": "gemini-pro", "temperature": 0.7},
            language_code="en-IN",
        )
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_create_llm_client_unsupported_provider(self, mock_llm_class):
        """Test create_llm_client with unsupported provider."""
        llm_config = {"provider": "unsupported", "config": {"model": "test-model"}}

        with pytest.raises(ValueError, match="Unsupported LLM provider"):
            create_llm_client(llm_config=llm_config, language_code="en-IN")


class TestLLMFactoryTemperatureOverride:
    """Roleplay-level temperature override (promptData.temperature)."""

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_override_injected_when_no_config(self, mock_llm_class):
        """Override lands in config even when no llm_config is provided."""
        mock_llm_class.from_config.return_value = Mock()

        create_llm_client(language_code="en-IN", temperature=0.2)

        mock_llm_class.from_config.assert_called_once_with(
            config={"model": "gpt-4o-mini", "temperature": 0.2},
            language_code="en-IN",
        )

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_override_wins_over_llm_config_temperature(self, mock_llm_class):
        """Roleplay override takes precedence over llm.config.temperature."""
        mock_llm_class.from_config.return_value = Mock()

        llm_config = {
            "provider": "openai",
            "config": {"model": "gpt-4", "temperature": 0.7},
        }
        create_llm_client(llm_config=llm_config, language_code="en-IN", temperature=0.3)

        mock_llm_class.from_config.assert_called_once_with(
            config={"model": "gpt-4", "temperature": 0.3},
            language_code="en-IN",
        )

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_no_override_leaves_config_temperature_untouched(self, mock_llm_class):
        """temperature=None leaves the existing config temperature in place."""
        mock_llm_class.from_config.return_value = Mock()

        llm_config = {
            "provider": "openai",
            "config": {"model": "gpt-4", "temperature": 0.7},
        }
        create_llm_client(
            llm_config=llm_config, language_code="en-IN", temperature=None
        )

        mock_llm_class.from_config.assert_called_once_with(
            config={"model": "gpt-4", "temperature": 0.7},
            language_code="en-IN",
        )

    @pytest.mark.unit
    @patch("app.llms.factory.GeminiLLMClient")
    def test_override_applies_to_gemini(self, mock_gemini_class):
        """Override is provider-agnostic — also applied for Gemini."""
        mock_gemini_class.from_config.return_value = Mock()

        llm_config = {
            "provider": "gemini",
            "config": {"model": "gemini-pro", "temperature": 0.9},
        }
        create_llm_client(
            llm_config=llm_config, language_code="en-IN", temperature=0.25
        )

        mock_gemini_class.from_config.assert_called_once_with(
            config={"model": "gemini-pro", "temperature": 0.25},
            language_code="en-IN",
        )

    @pytest.mark.unit
    @patch("app.llms.factory.OpenAILLMClient")
    def test_override_zero_is_respected(self, mock_llm_class):
        """temperature=0.0 is a real override, not treated as 'unset'."""
        mock_llm_class.from_config.return_value = Mock()

        create_llm_client(language_code="en-IN", temperature=0.0)

        mock_llm_class.from_config.assert_called_once_with(
            config={"model": "gpt-4o-mini", "temperature": 0.0},
            language_code="en-IN",
        )


class TestConfigureLLMClientTemperature:
    """configure_llm_client forwards promptData.temperature to the factory."""

    def _make_scenario(self, temperature):
        """Minimal stub exposing only what configure_llm_client reads."""
        scenario = Mock()
        scenario.language_config.llm_config = None
        scenario.language_config.language_code = "en-IN"
        scenario.prompt_data.temperature = temperature
        return scenario

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_forwards_roleplay_temperature(self, mock_create):
        from app.core.agent.factory import configure_llm_client

        mock_create.return_value = Mock()
        configure_llm_client(self._make_scenario(0.2))

        assert mock_create.call_args.kwargs["temperature"] == 0.2

    @pytest.mark.unit
    @patch("app.core.agent.factory.create_llm_client")
    def test_forwards_none_when_unset(self, mock_create):
        from app.core.agent.factory import configure_llm_client

        mock_create.return_value = Mock()
        configure_llm_client(self._make_scenario(None))

        assert mock_create.call_args.kwargs["temperature"] is None


class TestOpenAILLMClientBaseUrl:
    """Test cases for OpenAILLMClient base_url support."""

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_base_url_passed_to_chat_openai(
        self, mock_settings, mock_chat_openai_class
    ):
        """Test that base_url is passed through to ChatOpenAI."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_chat_openai_class.return_value = Mock()

        OpenAILLMClient(
            model="llama3.2",
            language_code="en-IN",
            base_url="http://localhost:11434/v1",
        )

        mock_chat_openai_class.assert_called_once_with(
            model="llama3.2",
            temperature=0.7,
            api_key="test-api-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
            base_url="http://localhost:11434/v1",
        )

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_base_url_with_no_api_key_uses_placeholder(
        self, mock_settings, mock_chat_openai_class
    ):
        """Test that base_url with no API key uses placeholder."""
        mock_settings.OPENAI_API_KEY = None
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_chat_openai_class.return_value = Mock()

        client = OpenAILLMClient(
            model="llama3.2",
            language_code="en-IN",
            base_url="http://localhost:11434/v1",
        )

        mock_chat_openai_class.assert_called_once_with(
            model="llama3.2",
            temperature=0.7,
            api_key="not-needed",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
            base_url="http://localhost:11434/v1",
        )
        assert client.llm_instance is not None

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_no_base_url_omits_it_from_chat_openai(
        self, mock_settings, mock_chat_openai_class
    ):
        """Test that when base_url is None it is not passed to ChatOpenAI."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_chat_openai_class.return_value = Mock()

        OpenAILLMClient(model="gpt-4o-mini", language_code="en-IN")

        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-api-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
        )

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_from_config_extracts_base_url(self, mock_settings, mock_chat_openai_class):
        """Test that from_config extracts base_url from config dict."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_chat_openai_class.return_value = Mock()

        config = {
            "model": "llama3.2",
            "base_url": "http://localhost:11434/v1",
        }
        OpenAILLMClient.from_config(config=config, language_code="en-IN")

        mock_chat_openai_class.assert_called_once_with(
            model="llama3.2",
            temperature=0.7,
            api_key="test-api-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
            base_url="http://localhost:11434/v1",
        )


class TestLLMFactoryOllamaVllm:
    """Test cases for Ollama and vLLM factory routing."""

    @pytest.mark.unit
    @patch("app.llms.factory.settings")
    @patch("app.llms.factory.OpenAILLMClient")
    def test_ollama_provider_creates_client_with_correct_base_url(
        self, mock_llm_class, mock_settings
    ):
        """Test factory with provider 'ollama' uses OLLAMA_BASE_URL."""
        mock_client = Mock()
        mock_llm_class.from_config.return_value = mock_client
        mock_settings.OLLAMA_BASE_URL = "http://localhost:11434/v1"
        mock_settings.LOCAL_LLM_MODEL = None

        llm_config = {
            "provider": "ollama",
            "config": {"model": "llama3.2"},
        }
        result = create_llm_client(llm_config=llm_config, language_code="en-IN")

        call_config = mock_llm_class.from_config.call_args[1]["config"]
        assert call_config["base_url"] == "http://localhost:11434/v1"
        assert call_config["model"] == "llama3.2"
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.llms.factory.settings")
    @patch("app.llms.factory.OpenAILLMClient")
    def test_ollama_provider_uses_local_llm_model_default(
        self, mock_llm_class, mock_settings
    ):
        """Test factory with provider 'ollama' defaults model to LOCAL_LLM_MODEL."""
        mock_client = Mock()
        mock_llm_class.from_config.return_value = mock_client
        mock_settings.OLLAMA_BASE_URL = "http://localhost:11434/v1"
        mock_settings.LOCAL_LLM_MODEL = "mistral"

        llm_config = {"provider": "ollama", "config": {}}
        create_llm_client(llm_config=llm_config, language_code="en-IN")

        call_config = mock_llm_class.from_config.call_args[1]["config"]
        assert call_config["model"] == "mistral"

    @pytest.mark.unit
    @patch("app.llms.factory.settings")
    @patch("app.llms.factory.OpenAILLMClient")
    def test_vllm_provider_creates_client_with_correct_base_url(
        self, mock_llm_class, mock_settings
    ):
        """Test factory with provider 'vllm' uses VLLM_BASE_URL."""
        mock_client = Mock()
        mock_llm_class.from_config.return_value = mock_client
        mock_settings.VLLM_BASE_URL = "http://gpu-server:8000/v1"
        mock_settings.LOCAL_LLM_MODEL = None

        llm_config = {
            "provider": "vllm",
            "config": {"model": "meta-llama/Llama-3.2-8B-Instruct"},
        }
        result = create_llm_client(llm_config=llm_config, language_code="en-IN")

        call_config = mock_llm_class.from_config.call_args[1]["config"]
        assert call_config["base_url"] == "http://gpu-server:8000/v1"
        assert call_config["model"] == "meta-llama/Llama-3.2-8B-Instruct"
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.llms.factory.settings")
    @patch("app.llms.factory.OpenAILLMClient")
    def test_vllm_provider_no_base_url_raises_error(
        self, mock_llm_class, mock_settings
    ):
        """Test factory with provider 'vllm' and no VLLM_BASE_URL raises ValueError."""
        mock_settings.VLLM_BASE_URL = None
        mock_settings.LOCAL_LLM_MODEL = None

        llm_config = {
            "provider": "vllm",
            "config": {"model": "meta-llama/Llama-3.2-8B-Instruct"},
        }
        with pytest.raises(ValueError, match="vLLM provider requires VLLM_BASE_URL"):
            create_llm_client(llm_config=llm_config, language_code="en-IN")

    @pytest.mark.unit
    @patch("app.llms.factory.settings")
    @patch("app.llms.factory.OpenAILLMClient")
    def test_config_base_url_overrides_env_default(self, mock_llm_class, mock_settings):
        """Test that base_url in config overrides environment variable default."""
        mock_client = Mock()
        mock_llm_class.from_config.return_value = mock_client
        mock_settings.OLLAMA_BASE_URL = "http://localhost:11434/v1"
        mock_settings.LOCAL_LLM_MODEL = None

        llm_config = {
            "provider": "ollama",
            "config": {
                "model": "llama3.2",
                "base_url": "http://remote-ollama:11434/v1",
            },
        }
        create_llm_client(llm_config=llm_config, language_code="en-IN")

        call_config = mock_llm_class.from_config.call_args[1]["config"]
        assert call_config["base_url"] == "http://remote-ollama:11434/v1"


class TestLLMAbstractionIntegration:
    """Integration tests for LLM abstraction."""

    @pytest.mark.integration
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_full_llm_creation_flow(self, mock_settings, mock_chat_openai_class):
        """Test complete LLM creation flow."""
        mock_settings.OPENAI_API_KEY = "test-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        client = create_llm_client(language_code="en-IN")
        llm = client.llm_instance

        assert isinstance(client, OpenAILLMClient)
        assert llm == mock_llm_instance
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-key",
            timeout=30,
            max_retries=1,
            streaming=False,
            stream_usage=True,
        )

    @pytest.mark.integration
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_llm_with_different_languages(self, mock_settings, mock_chat_openai_class):
        """Test LLM creation with different language codes."""
        mock_settings.OPENAI_API_KEY = "test-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_settings.STREAM_RESPONSE = False
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        # Test en-IN
        client1 = create_llm_client(language_code="en-IN")
        assert client1.llm_instance == mock_llm_instance

        # Test hi-IN
        client2 = create_llm_client(language_code="hi-IN")
        assert client2.llm_instance == mock_llm_instance


class TestGeminiApiKeyAliases:
    """The Gemini API key must be settable via any common env-var name, so a
    plain API key works without gcloud / ADC."""

    def test_google_api_key_accepts_common_aliases(self):
        from app.core.config import Settings

        alias = Settings.model_fields["GOOGLE_API_KEY"].validation_alias
        names = set(getattr(alias, "choices", []) or [])
        assert {
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "GOOGLE_GENERATIVE_AI_API_KEY",
        }.issubset(names)
