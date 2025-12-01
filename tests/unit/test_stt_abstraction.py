"""Comprehensive tests for STT abstraction."""
import pytest
from unittest.mock import Mock, patch

from app.stt.deepgram import DeepgramSTTClient
from app.stt.base import BaseSTTClient
from app.stt.factory import create_stt_client
from app.core.language.factory import resolve_config


class TestDeepgramSTTClient:
    """Test cases for Deepgram STT client."""
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    def test_deepgram_stt_client_init_success(self, mock_settings, mock_stt_class):
        """Test successful Deepgram STT client initialization with BCP 47 code."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        # Pass BCP 47 format - provider converts it internally
        client = DeepgramSTTClient(model="nova-3", language_code="en-IN")
        
        # Should convert "en-IN" to "en" (ISO 639-1)
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="en",
            api_key="test-api-key"
        )
        assert client.stt_instance == mock_stt_instance
        assert isinstance(client, BaseSTTClient)
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    def test_deepgram_stt_client_with_hi(self, mock_settings, mock_stt_class):
        """Test Deepgram STT client with Hindi BCP 47 code."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        # Pass BCP 47 format - provider converts to "hi"
        client = DeepgramSTTClient(model="nova-3", language_code="hi-IN")
        
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="hi",
            api_key="test-api-key"
        )
        assert client.stt_instance == mock_stt_instance
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.STT')
    def test_deepgram_stt_client_custom_api_key(self, mock_stt_class):
        """Test Deepgram STT client with custom API key."""
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        client = DeepgramSTTClient(
            model="nova-3",
            language_code="en-IN",
            api_key="custom-api-key"
        )
        
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="en",  # Converted from "en-IN"
            api_key="custom-api-key"
        )
        assert client.stt_instance == mock_stt_instance
    
    @pytest.mark.unit
    def test_deepgram_stt_client_missing_model(self):
        """Test Deepgram STT client with missing model."""
        with pytest.raises(ValueError, match="Deepgram STT requires 'model' parameter"):
            DeepgramSTTClient(model="", language_code="en-IN")
    
    @pytest.mark.unit
    def test_deepgram_stt_client_missing_language_code(self):
        """Test Deepgram STT client with missing language code."""
        with pytest.raises(ValueError, match="Deepgram STT requires 'language_code' parameter"):
            DeepgramSTTClient(model="nova-3", language_code="")
    
    @pytest.mark.unit
    @patch('app.stt.deepgram.settings')
    def test_deepgram_stt_client_missing_api_key(self, mock_settings):
        """Test Deepgram STT client with missing API key."""
        mock_settings.DEEPGRAM_API_KEY = None
        
        with pytest.raises(ValueError, match="Deepgram STT requires 'api_key' parameter"):
            DeepgramSTTClient(model="nova-3", language_code="en-IN")
    
    @pytest.mark.unit
    def test_deepgram_language_format(self):
        """Test that Deepgram declares ISO 639-1 format requirement."""
        assert DeepgramSTTClient.LANGUAGE_FORMAT == "iso6391"
    
    @pytest.mark.unit
    def test_deepgram_convert_language_code(self):
        """Test language code conversion in Deepgram client."""
        # Test BCP 47 to ISO 639-1 conversion
        assert DeepgramSTTClient.convert_language_code("en-IN") == "en"
        assert DeepgramSTTClient.convert_language_code("hi-IN") == "hi"
        assert DeepgramSTTClient.convert_language_code("en-US") == "en"
        assert DeepgramSTTClient.convert_language_code("en") == "en"


class TestResolveConfig:
    """Test cases for resolve_config function."""
    
    @pytest.mark.unit
    @patch('app.core.language.factory.get_capability_defaults')
    def test_resolve_config_from_language_defaults(self, mock_get_defaults):
        """Test resolve_config resolves config from unified registry."""
        mock_get_defaults.return_value = {
            "provider": "deepgram",
            "model": "nova-3"
        }
        
        config = resolve_config("stt", "en-IN")
        
        assert config["provider"] == "deepgram"
        assert config["model"] == "nova-3"
        assert config["language_code"] == "en-IN"  # BCP 47 - providers convert it
        assert config["api_key"] is None
    
    @pytest.mark.unit
    @patch('app.core.language.factory.get_capability_defaults')
    def test_resolve_config_with_override(self, mock_get_defaults):
        """Test resolve_config uses language registry defaults."""
        mock_get_defaults.return_value = {
            "provider": "deepgram",
            "model": "nova-3"
        }
        
        config = resolve_config("stt", "en-IN")
        
        assert config["provider"] == "deepgram"
        assert config["model"] == "nova-3"
        assert config["api_key"] is None  # API keys come from settings, not registry
        assert config["language_code"] == "en-IN"
    
    @pytest.mark.unit
    @patch('app.core.language.factory.get_capability_defaults')
    def test_resolve_config_fallback_to_default_language(self, mock_get_defaults):
        """Test resolve_config falls back to default language when language not found."""
        # First call returns empty (language not found)
        # Second call returns default language config
        mock_get_defaults.side_effect = [
            {},  # Language not found
            {"provider": "deepgram", "model": "nova-3"}  # Default language
        ]
        
        config = resolve_config("stt", "unknown-language")
        
        assert config["provider"] == "deepgram"
        assert config["model"] == "nova-3"


class TestSTTFactory:
    """Test cases for create_stt_client factory function."""
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    @patch('app.stt.factory.resolve_config')
    def test_create_stt_client_auto_selects_provider(
        self, mock_resolve_config, mock_settings, mock_stt_class
    ):
        """Test that factory function uses resolve_config to resolve config."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_resolve_config.return_value = {
            "provider": "deepgram",
            "model": "nova-3",
            "language_code": "en-IN",
            "api_key": None,
        }
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        client = create_stt_client("en-IN")
        
        # Verify resolve_config was called without override
        mock_resolve_config.assert_called_once_with("stt", "en-IN")
        
        # Verify DeepgramSTTClient was instantiated with BCP 47 code (provider converts it)
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="en",  # Provider converted "en-IN" to "en"
            api_key="test-api-key"
        )
        assert client.stt_instance == mock_stt_instance
        assert isinstance(client, DeepgramSTTClient)
    
    @pytest.mark.unit
    @patch('app.stt.factory.DeepgramSTTClient')
    @patch('app.stt.factory.resolve_config')
    def test_create_stt_client_uses_language_registry(
        self, mock_resolve_config, mock_stt_client_class
    ):
        """Test factory function uses language registry defaults."""
        mock_resolve_config.return_value = {
            "provider": "deepgram",
            "model": "nova-3",
            "language_code": "en-IN",
            "api_key": None,
        }
        mock_stt_instance = Mock()
        mock_client = Mock()
        mock_client.stt_instance = mock_stt_instance
        mock_stt_client_class.return_value = mock_client
        
        client = create_stt_client("en-IN")
        
        # Verify resolve_config was called without override (uses language registry)
        mock_resolve_config.assert_called_once_with("stt", "en-IN")
        
        # Verify DeepgramSTTClient was created with language registry values
        mock_stt_client_class.assert_called_once_with(
            model="nova-3",
            language_code="en-IN",
            api_key=None,  # Will use settings.DEEPGRAM_API_KEY in actual client
        )
        assert client == mock_client
    
    @pytest.mark.unit
    @patch('app.stt.factory.resolve_config')
    def test_create_stt_client_unsupported_provider(self, mock_resolve_config):
        """Test error handling for unsupported provider."""
        mock_resolve_config.return_value = {
            "provider": "unsupported",
            "model": "test-model",
            "language_code": "en-IN",
            "api_key": None,
        }
        
        with pytest.raises(ValueError, match="Unsupported STT provider"):
            create_stt_client("en-IN")


class TestSTTAbstractionIntegration:
    """Integration tests for STT abstraction."""
    
    @pytest.mark.integration
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    @patch('app.stt.factory.resolve_config')
    def test_full_stt_creation_flow(self, mock_resolve_config, mock_settings, mock_stt_class):
        """Test complete STT creation flow using factory."""
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_resolve_config.return_value = {
            "provider": "deepgram",
            "model": "nova-3",
            "language_code": "en-IN",
            "api_key": None,
        }
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        stt_client = create_stt_client("en-IN")
        
        assert stt_client.stt_instance == mock_stt_instance
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="en",  # Provider converted "en-IN" to "en"
            api_key="test-key"
        )
    
    @pytest.mark.integration
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    @patch('app.stt.factory.resolve_config')
    def test_stt_with_different_languages(self, mock_resolve_config, mock_settings, mock_stt_class):
        """Test STT creation with different language codes."""
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        # Test en-IN
        mock_resolve_config.return_value = {
            "provider": "deepgram",
            "model": "nova-3",
            "language_code": "en-IN",
            "api_key": None,
        }
        stt1 = create_stt_client("en-IN")
        assert mock_stt_class.call_args[1]["model"] == "nova-3"
        assert mock_stt_class.call_args[1]["language"] == "en"  # Converted
        
        # Reset mock
        mock_stt_class.reset_mock()
        mock_stt_class.return_value = mock_stt_instance
        
        # Test hi-IN
        mock_resolve_config.return_value = {
            "provider": "deepgram",
            "model": "nova-3",
            "language_code": "hi-IN",
            "api_key": None,
        }
        stt2 = create_stt_client("hi-IN")
        assert mock_stt_class.call_args[1]["model"] == "nova-3"
        assert mock_stt_class.call_args[1]["language"] == "hi"  # Converted
