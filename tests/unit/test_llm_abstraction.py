"""Comprehensive tests for LLM abstraction."""

from unittest.mock import Mock, patch

import pytest

from app.llms.base import BaseLLMClient
from app.llms.factory import create_llm_client
from app.llms.openai import OpenAILLMClient


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
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        client = OpenAILLMClient(model="gpt-4o-mini", language_code="en-IN")

        assert isinstance(client, BaseLLMClient)
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini", temperature=0.7, api_key="test-api-key"
        )
        assert client.llm_instance == mock_llm_instance

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_openai_llm_client_with_hi_in(self, mock_settings, mock_chat_openai_class):
        """Test OpenAILLMClient with Hindi language code."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        client = OpenAILLMClient(model="gpt-4o-mini", language_code="hi-IN")

        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini", temperature=0.7, api_key="test-api-key"
        )
        assert client.llm_instance == mock_llm_instance

    @pytest.mark.unit
    @patch("app.llms.openai.ChatOpenAI")
    def test_openai_llm_client_custom_temperature(self, mock_chat_openai_class):
        """Test OpenAILLMClient with custom temperature."""
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        client = OpenAILLMClient(
            model="gpt-4o-mini",
            language_code="en-IN",
            temperature=0.9,
            api_key="custom-key",
        )

        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini", temperature=0.9, api_key="custom-key"
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
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        config = {"model": "gpt-4", "temperature": 0.8}
        client = OpenAILLMClient.from_config(config=config, language_code="en-IN")

        assert isinstance(client, OpenAILLMClient)
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4", temperature=0.8, api_key="test-api-key"
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
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        # Simulate nested config structure (from factory)
        config = {"config": {"model": "gpt-4", "temperature": 0.8}}
        client = OpenAILLMClient.from_config(config=config, language_code="en-IN")

        assert isinstance(client, OpenAILLMClient)
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4", temperature=0.8, api_key="test-api-key"
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
    @patch("app.llms.factory.OpenAILLMClient")
    def test_create_llm_client_unsupported_provider(self, mock_llm_class):
        """Test create_llm_client with unsupported provider."""
        llm_config = {"provider": "unsupported", "config": {"model": "test-model"}}

        with pytest.raises(ValueError, match="Unsupported LLM provider"):
            create_llm_client(llm_config=llm_config, language_code="en-IN")


class TestLLMAbstractionIntegration:
    """Integration tests for LLM abstraction."""

    @pytest.mark.integration
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_full_llm_creation_flow(self, mock_settings, mock_chat_openai_class):
        """Test complete LLM creation flow."""
        mock_settings.OPENAI_API_KEY = "test-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        client = create_llm_client(language_code="en-IN")
        llm = client.llm_instance

        assert isinstance(client, OpenAILLMClient)
        assert llm == mock_llm_instance
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini", temperature=0.7, api_key="test-key"
        )

    @pytest.mark.integration
    @patch("app.llms.openai.ChatOpenAI")
    @patch("app.llms.openai.settings")
    def test_llm_with_different_languages(self, mock_settings, mock_chat_openai_class):
        """Test LLM creation with different language codes."""
        mock_settings.OPENAI_API_KEY = "test-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance

        # Test en-IN
        client1 = create_llm_client(language_code="en-IN")
        assert client1.llm_instance == mock_llm_instance

        # Test hi-IN
        client2 = create_llm_client(language_code="hi-IN")
        assert client2.llm_instance == mock_llm_instance
