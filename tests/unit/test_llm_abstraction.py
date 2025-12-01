"""Comprehensive tests for LLM abstraction."""
import pytest
from unittest.mock import Mock, patch

from app.llms.base import BaseLLMClient
from app.llms.openai import OpenAILLMClient
from app.llms.factory import create_llm_client
from app.core.constants import LLMProvider
from app.core.language.factory import resolve_config
from app.core.language import DEFAULT_LANGUAGE_CODE


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
        assert hasattr(BaseLLMClient, 'llm_instance')


class TestOpenAILLMClient:
    """Test cases for OpenAILLMClient class."""
    
    @pytest.mark.unit
    @patch('app.llms.openai.ChatOpenAI')
    @patch('app.llms.openai.settings')
    def test_openai_llm_client_init_success(self, mock_settings, mock_chat_openai_class):
        """Test successful OpenAILLMClient initialization."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        client = OpenAILLMClient(
            model="gpt-4o-mini",
            language_code="en-IN"
        )
        
        assert isinstance(client, BaseLLMClient)
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-api-key"
        )
        assert client.llm_instance == mock_llm_instance
    
    @pytest.mark.unit
    @patch('app.llms.openai.ChatOpenAI')
    @patch('app.llms.openai.settings')
    def test_openai_llm_client_with_hi_in(self, mock_settings, mock_chat_openai_class):
        """Test OpenAILLMClient with Hindi language code."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        client = OpenAILLMClient(
            model="gpt-4o-mini",
            language_code="hi-IN"
        )
        
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-api-key"
        )
        assert client.llm_instance == mock_llm_instance
    
    @pytest.mark.unit
    @patch('app.llms.openai.ChatOpenAI')
    def test_openai_llm_client_custom_temperature(self, mock_chat_openai_class):
        """Test OpenAILLMClient with custom temperature."""
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        client = OpenAILLMClient(
            model="gpt-4o-mini",
            language_code="en-IN",
            temperature=0.9,
            api_key="custom-key"
        )
        
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.9,
            api_key="custom-key"
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
        with pytest.raises(ValueError, match="OpenAI LLM requires 'language_code' parameter"):
            OpenAILLMClient(model="gpt-4o-mini", language_code="")
    
    @pytest.mark.unit
    @patch('app.llms.openai.settings')
    def test_openai_llm_client_missing_api_key(self, mock_settings):
        """Test OpenAILLMClient with missing API key."""
        mock_settings.OPENAI_API_KEY = None
        mock_settings.LLM_TEMPERATURE = "0.7"
        
        with pytest.raises(ValueError, match="OpenAI LLM requires 'api_key' parameter"):
            OpenAILLMClient(model="gpt-4o-mini", language_code="en-IN")


class TestResolveConfig:
    """Test cases for resolve_config function (used by LLM factory)."""
    
    @pytest.mark.unit
    @patch('app.core.language.factory.get_capability_defaults')
    def test_resolve_config_from_language_defaults(self, mock_get_defaults):
        """Test resolve_config resolves config from unified registry."""
        mock_get_defaults.return_value = {
            "provider": "openai",
            "model": "gpt-4o-mini"
        }
        
        config = resolve_config("llm", "en-IN")
        
        assert config["provider"] == "openai"
        assert config["model"] == "gpt-4o-mini"
        assert config["language_code"] == "en-IN"
        assert config["api_key"] is None
        assert config.get("temperature") is None
    
    @pytest.mark.unit
    @patch('app.core.language.factory.get_capability_defaults')
    def test_resolve_config_with_override(self, mock_get_defaults):
        """Test resolve_config uses language registry defaults."""
        mock_get_defaults.return_value = {
            "provider": "openai",
            "model": "gpt-4o-mini"
        }
        
        config = resolve_config("llm", "en-IN")
        
        assert config["provider"] == "openai"
        assert config["model"] == "gpt-4o-mini"
        assert config.get("temperature") is None  # Temperature not in registry
        assert config["api_key"] is None  # API keys come from settings, not registry
        assert config["language_code"] == "en-IN"
    
    @pytest.mark.unit
    @patch('app.core.language.factory.get_capability_defaults')
    def test_resolve_config_fallback_to_default_language(self, mock_get_defaults):
        """Test resolve_config falls back to DEFAULT_LANGUAGE_CODE."""
        # First call returns empty (unknown language)
        # Second call returns defaults (DEFAULT_LANGUAGE_CODE)
        mock_get_defaults.side_effect = [
            {},  # Unknown language
            {"provider": "openai", "model": "gpt-4o-mini"}  # Default language
        ]
        
        config = resolve_config("llm", "unknown-language")
        
        assert config["provider"] == "openai"
        assert config["model"] == "gpt-4o-mini"
        assert config["language_code"] == "unknown-language"


class TestLLMFactory:
    """Test cases for create_llm_client factory function."""
    
    @pytest.mark.unit
    @patch('app.llms.factory.resolve_config')
    @patch('app.llms.factory.OpenAILLMClient')
    def test_create_llm_client_auto_selects_provider(
        self, mock_llm_class, mock_resolve_config
    ):
        """Test create_llm_client automatically selects provider from config."""
        mock_resolve_config.return_value = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "language_code": "en-IN",
            "api_key": None,
            "temperature": None,
        }
        mock_client = Mock()
        mock_llm_class.return_value = mock_client
        
        result = create_llm_client("en-IN")
        
        # Verify resolve_config was called without override (uses language registry)
        mock_resolve_config.assert_called_once_with("llm", "en-IN")
        mock_llm_class.assert_called_once_with(
            model="gpt-4o-mini",
            language_code="en-IN",
            temperature=None,
            api_key=None,
        )
        assert result == mock_client
    
    @pytest.mark.unit
    @patch('app.llms.factory.resolve_config')
    @patch('app.llms.factory.OpenAILLMClient')
    def test_create_llm_client_uses_language_registry(
        self, mock_llm_class, mock_resolve_config
    ):
        """Test create_llm_client uses language registry defaults."""
        mock_resolve_config.return_value = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "language_code": "en-IN",
            "api_key": None,
            "temperature": None,
        }
        mock_client = Mock()
        mock_llm_class.return_value = mock_client
        
        result = create_llm_client("en-IN")
        
        # Verify resolve_config was called without override (uses language registry)
        mock_resolve_config.assert_called_once_with("llm", "en-IN")
        mock_llm_class.assert_called_once_with(
            model="gpt-4o-mini",
            language_code="en-IN",
            temperature=None,  # Not set in language registry
            api_key=None,  # Will use settings.OPENAI_API_KEY in actual client
        )
        assert result == mock_client
    
    @pytest.mark.unit
    @patch('app.llms.factory.resolve_config')
    def test_create_llm_client_unsupported_provider(self, mock_resolve_config):
        """Test create_llm_client with unsupported provider."""
        mock_resolve_config.return_value = {
            "provider": "unsupported",
            "model": "test-model",
            "language_code": "en-IN",
        }
        
        with pytest.raises(ValueError, match="Unsupported LLM provider"):
            create_llm_client("en-IN")


class TestLLMAbstractionIntegration:
    """Integration tests for LLM abstraction."""
    
    @pytest.mark.integration
    @patch('app.llms.openai.ChatOpenAI')
    @patch('app.llms.openai.settings')
    @patch('app.llms.factory.resolve_config')
    def test_full_llm_creation_flow(
        self, mock_resolve_config, mock_settings, mock_chat_openai_class
    ):
        """Test complete LLM creation flow."""
        mock_settings.OPENAI_API_KEY = "test-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_resolve_config.return_value = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "language_code": "en-IN",
            "api_key": None,
            "temperature": None,
        }
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        client = create_llm_client("en-IN")
        llm = client.llm_instance
        
        assert isinstance(client, OpenAILLMClient)
        assert llm == mock_llm_instance
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-key"
        )
    
    @pytest.mark.integration
    @patch('app.llms.openai.ChatOpenAI')
    @patch('app.llms.openai.settings')
    @patch('app.llms.factory.resolve_config')
    def test_llm_with_different_languages(
        self, mock_resolve_config, mock_settings, mock_chat_openai_class
    ):
        """Test LLM creation with different language codes."""
        mock_settings.OPENAI_API_KEY = "test-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        # Test en-IN
        mock_resolve_config.return_value = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "language_code": "en-IN",
            "api_key": None,
            "temperature": None,
        }
        client1 = create_llm_client("en-IN")
        assert client1.llm_instance == mock_llm_instance
        
        # Test hi-IN
        mock_resolve_config.return_value = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "language_code": "hi-IN",
            "api_key": None,
            "temperature": None,
        }
        client2 = create_llm_client("hi-IN")
        assert client2.llm_instance == mock_llm_instance
