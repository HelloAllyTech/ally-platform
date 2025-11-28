"""Comprehensive tests for STT abstraction."""
import pytest
from unittest.mock import Mock, patch

from app.stt.stt import get_stt_for_language
from app.stt.deepgram import create_deepgram_stt
from app.core.constants import STTProvider
from app.core.language_config import DEFAULT_LANGUAGE_CODE, LANGUAGE_DEFAULTS


class TestDeepgramSTTProvider:
    """Test cases for Deepgram STT provider."""
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    def test_create_deepgram_stt_success(self, mock_settings, mock_stt_class):
        """Test successful Deepgram STT creation."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        result = create_deepgram_stt(model="nova-3", language_code="en-IN")
        
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="en-IN",
            api_key="test-api-key"
        )
        assert result == mock_stt_instance
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    def test_create_deepgram_stt_with_hi_in(self, mock_settings, mock_stt_class):
        """Test Deepgram STT creation with Hindi language code."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        result = create_deepgram_stt(model="nova-2", language_code="hi-IN")
        
        mock_stt_class.assert_called_once_with(
            model="nova-2",
            language="hi-IN",
            api_key="test-api-key"
        )
        assert result == mock_stt_instance
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    def test_create_deepgram_stt_default_language(self, mock_settings, mock_stt_class):
        """Test Deepgram STT creation with default language when not provided."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        result = create_deepgram_stt(model="nova-3", language_code=None)
        
        # Should default to DEFAULT_LANGUAGE_CODE
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language=DEFAULT_LANGUAGE_CODE,
            api_key="test-api-key"
        )
        assert result == mock_stt_instance
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.STT')
    def test_create_deepgram_stt_custom_api_key(self, mock_stt_class):
        """Test Deepgram STT creation with custom API key."""
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        result = create_deepgram_stt(
            model="nova-3",
            language_code="en-IN",
            api_key="custom-api-key"
        )
        
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="en-IN",
            api_key="custom-api-key"
        )
        assert result == mock_stt_instance
    
    @pytest.mark.unit
    def test_create_deepgram_stt_missing_model(self):
        """Test Deepgram STT creation with missing model."""
        with pytest.raises(ValueError, match="Deepgram STT requires 'model' parameter"):
            create_deepgram_stt(model="", language_code="en-IN")
    
    @pytest.mark.unit
    @patch('app.stt.deepgram.settings')
    def test_create_deepgram_stt_missing_api_key(self, mock_settings):
        """Test Deepgram STT creation with missing API key."""
        mock_settings.DEEPGRAM_API_KEY = None
        
        with pytest.raises(ValueError, match="Deepgram STT requires 'api_key' parameter"):
            create_deepgram_stt(model="nova-3", language_code="en-IN")


class TestGetSTTForLanguage:
    """Test cases for get_stt_for_language function."""
    
    @pytest.mark.unit
    @patch('app.stt.stt.create_deepgram_stt')
    def test_get_stt_for_language_en_in(self, mock_create):
        """Test getting STT for en-IN language."""
        mock_stt = Mock()
        mock_create.return_value = mock_stt
        
        result = get_stt_for_language("en-IN")
        
        # Should use defaults from LANGUAGE_DEFAULTS
        mock_create.assert_called_once_with(
            model="nova-3",
            language_code="en-IN",
            api_key=None
        )
        assert result == mock_stt
    
    @pytest.mark.unit
    @patch('app.stt.stt.create_deepgram_stt')
    def test_get_stt_for_language_hi_in(self, mock_create):
        """Test getting STT for hi-IN language."""
        mock_stt = Mock()
        mock_create.return_value = mock_stt
        
        result = get_stt_for_language("hi-IN")
        
        # Should use hi-IN defaults (nova-2 model)
        mock_create.assert_called_once_with(
            model="nova-2",
            language_code="hi-IN",
            api_key=None
        )
        assert result == mock_stt
    
    @pytest.mark.unit
    @patch('app.stt.stt.create_deepgram_stt')
    def test_get_stt_for_language_fallback(self, mock_create):
        """Test fallback to default language when language not found."""
        mock_stt = Mock()
        mock_create.return_value = mock_stt
        
        result = get_stt_for_language("unknown-language")
        
        # Should fallback to DEFAULT_LANGUAGE_CODE (en-IN) defaults
        mock_create.assert_called_once_with(
            model="nova-3",  # en-IN default
            language_code="unknown-language",  # Still pass the requested language
            api_key=None
        )
        assert result == mock_stt
    
    @pytest.mark.unit
    @patch('app.stt.stt.create_deepgram_stt')
    def test_get_stt_for_language_with_override(self, mock_create):
        """Test getting STT with override configuration."""
        mock_stt = Mock()
        mock_create.return_value = mock_stt
        
        override_config = {
            "provider": "deepgram",
            "model": "nova-2",
            "config": {"api_key": "custom-key"}
        }
        
        result = get_stt_for_language("en-IN", override_config=override_config)
        
        # Should use override config
        mock_create.assert_called_once_with(
            model="nova-2",
            language_code="en-IN",
            api_key="custom-key"
        )
        assert result == mock_stt
    
    @pytest.mark.unit
    @patch('app.stt.stt.create_deepgram_stt')
    def test_get_stt_for_language_override_provider_only(self, mock_create):
        """Test override with provider only (should use language defaults for model)."""
        mock_stt = Mock()
        mock_create.return_value = mock_stt
        
        override_config = {
            "provider": "deepgram",
            # No model specified, should use language default
        }
        
        result = get_stt_for_language("en-IN", override_config=override_config)
        
        # Should use language default model
        mock_create.assert_called_once_with(
            model="nova-3",  # en-IN default
            language_code="en-IN",
            api_key=None
        )
        assert result == mock_stt
    
    @pytest.mark.unit
    def test_get_stt_for_language_unsupported_provider(self):
        """Test error handling for unsupported provider."""
        override_config = {
            "provider": "unsupported",
            "model": "test-model"
        }
        
        with pytest.raises(ValueError, match="Unsupported STT provider"):
            get_stt_for_language("en-IN", override_config=override_config)
    
    @pytest.mark.unit
    def test_get_stt_for_language_missing_model(self):
        """Test error handling when model is missing."""
        override_config = {
            "provider": "deepgram",
            # No model specified
        }
        
        # This should fallback to language defaults, but if those are missing, it should raise
        # Actually, it should use language defaults, so let's test with a language that has defaults
        with patch('app.stt.stt.create_deepgram_stt') as mock_create:
            mock_stt = Mock()
            mock_create.return_value = mock_stt
            
            # Override with provider but no model - should use language default
            override_config = {"provider": "deepgram"}
            result = get_stt_for_language("en-IN", override_config=override_config)
            
            # Should use en-IN default model
            mock_create.assert_called_once_with(
                model="nova-3",
                language_code="en-IN",
                api_key=None
            )


class TestSTTAbstractionIntegration:
    """Integration tests for STT abstraction."""
    
    @pytest.mark.integration
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    def test_full_stt_creation_flow(self, mock_settings, mock_stt_class):
        """Test complete STT creation flow."""
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        stt = get_stt_for_language("en-IN")
        
        assert stt == mock_stt_instance
        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="en-IN",
            api_key="test-key"
        )
    
    @pytest.mark.integration
    @patch('livekit.plugins.deepgram.STT')
    @patch('app.stt.deepgram.settings')
    def test_stt_with_different_languages(self, mock_settings, mock_stt_class):
        """Test STT creation with different language codes."""
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance
        
        # Test en-IN
        stt1 = get_stt_for_language("en-IN")
        assert mock_stt_class.call_args_list[0][1]["model"] == "nova-3"
        assert mock_stt_class.call_args_list[0][1]["language"] == "en-IN"
        
        # Reset mock
        mock_stt_class.reset_mock()
        mock_stt_class.return_value = mock_stt_instance
        
        # Test hi-IN
        stt2 = get_stt_for_language("hi-IN")
        assert mock_stt_class.call_args_list[0][1]["model"] == "nova-2"
        assert mock_stt_class.call_args_list[0][1]["language"] == "hi-IN"
    
    @pytest.mark.integration
    @patch('app.stt.stt.create_deepgram_stt')
    def test_language_defaults_integration(self, mock_create):
        """Test integration with LANGUAGE_DEFAULTS."""
        mock_stt = Mock()
        mock_create.return_value = mock_stt
        
        # Test that language defaults are used correctly
        for lang_code, expected_model in [("en-IN", "nova-3"), ("hi-IN", "nova-2")]:
            mock_create.reset_mock()
            result = get_stt_for_language(lang_code)
            
            mock_create.assert_called_once_with(
                model=expected_model,
                language_code=lang_code,
                api_key=None
            )
            assert result == mock_stt

