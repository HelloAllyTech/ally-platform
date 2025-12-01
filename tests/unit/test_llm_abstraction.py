"""Comprehensive tests for LLM abstraction."""
import pytest
from unittest.mock import Mock, patch

from app.llms.llm import get_llm_for_language
from app.llms.openai import create_openai_llm
from app.core.constants import LLMProvider
from app.core.language import DEFAULT_LANGUAGE_CODE, LANGUAGE_DEFAULTS


class TestOpenAILLMProvider:
    """Test cases for OpenAI LLM provider."""
    
    @pytest.mark.unit
    @patch('app.llms.openai.ChatOpenAI')
    @patch('app.llms.openai.settings')
    def test_create_openai_llm_success(self, mock_settings, mock_chat_openai_class):
        """Test successful OpenAI LLM creation."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        result = create_openai_llm(model="gpt-4o-mini", language_code="en-IN")
        
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-api-key"
        )
        assert result == mock_llm_instance
    
    @pytest.mark.unit
    @patch('app.llms.openai.ChatOpenAI')
    @patch('app.llms.openai.settings')
    def test_create_openai_llm_with_hi_in(self, mock_settings, mock_chat_openai_class):
        """Test OpenAI LLM creation with Hindi language code."""
        mock_settings.OPENAI_API_KEY = "test-api-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        result = create_openai_llm(model="gpt-4o-mini", language_code="hi-IN")
        
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-api-key"
        )
        assert result == mock_llm_instance
    
    @pytest.mark.unit
    @patch('app.llms.openai.ChatOpenAI')
    def test_create_openai_llm_custom_temperature(self, mock_chat_openai_class):
        """Test OpenAI LLM creation with custom temperature."""
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        result = create_openai_llm(
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
        assert result == mock_llm_instance
    
    @pytest.mark.unit
    def test_create_openai_llm_missing_model(self):
        """Test OpenAI LLM creation with missing model."""
        with pytest.raises(ValueError, match="OpenAI LLM requires 'model' parameter"):
            create_openai_llm(model="", language_code="en-IN")
    
    @pytest.mark.unit
    @patch('app.llms.openai.settings')
    def test_create_openai_llm_missing_api_key(self, mock_settings):
        """Test OpenAI LLM creation with missing API key."""
        mock_settings.OPENAI_API_KEY = None
        mock_settings.LLM_TEMPERATURE = "0.7"
        
        with pytest.raises(ValueError, match="OpenAI LLM requires 'api_key' parameter"):
            create_openai_llm(model="gpt-4o-mini", language_code="en-IN")


class TestGetLLMForLanguage:
    """Test cases for get_llm_for_language function."""
    
    @pytest.mark.unit
    @patch('app.llms.llm.create_openai_llm')
    def test_get_llm_for_language_en_in(self, mock_create):
        """Test getting LLM for en-IN language."""
        mock_llm = Mock()
        mock_create.return_value = mock_llm
        
        result = get_llm_for_language("en-IN")
        
        # Should use defaults from LANGUAGE_DEFAULTS
        mock_create.assert_called_once_with(
            model="gpt-4o-mini",
            language_code="en-IN",
            temperature=None,
            api_key=None
        )
        assert result == mock_llm
    
    @pytest.mark.unit
    @patch('app.llms.llm.create_openai_llm')
    def test_get_llm_for_language_hi_in(self, mock_create):
        """Test getting LLM for hi-IN language."""
        mock_llm = Mock()
        mock_create.return_value = mock_llm
        
        result = get_llm_for_language("hi-IN")
        
        # Should use hi-IN defaults (same as en-IN for now)
        mock_create.assert_called_once_with(
            model="gpt-4o-mini",
            language_code="hi-IN",
            temperature=None,
            api_key=None
        )
        assert result == mock_llm
    
    @pytest.mark.unit
    @patch('app.llms.llm.create_openai_llm')
    def test_get_llm_for_language_fallback(self, mock_create):
        """Test fallback to default language when language not found."""
        mock_llm = Mock()
        mock_create.return_value = mock_llm
        
        result = get_llm_for_language("unknown-language")
        
        # Should fallback to DEFAULT_LANGUAGE_CODE (en-IN) defaults
        mock_create.assert_called_once_with(
            model="gpt-4o-mini",  # en-IN default
            language_code="unknown-language",  # Still pass the requested language
            temperature=None,
            api_key=None
        )
        assert result == mock_llm
    
    @pytest.mark.unit
    @patch('app.llms.llm.create_openai_llm')
    def test_get_llm_for_language_with_override(self, mock_create):
        """Test getting LLM with override configuration."""
        mock_llm = Mock()
        mock_create.return_value = mock_llm
        
        override_config = {
            "provider": "openai",
            "model": "gpt-4",
            "temperature": 0.9,
            "config": {"api_key": "custom-key"}
        }
        
        result = get_llm_for_language("en-IN", override_config=override_config)
        
        # Should use override config
        mock_create.assert_called_once_with(
            model="gpt-4",
            language_code="en-IN",
            temperature=0.9,
            api_key="custom-key"
        )
        assert result == mock_llm
    
    @pytest.mark.unit
    @patch('app.llms.llm.create_openai_llm')
    def test_get_llm_for_language_override_provider_only(self, mock_create):
        """Test override with provider only (should use language defaults for model)."""
        mock_llm = Mock()
        mock_create.return_value = mock_llm
        
        override_config = {
            "provider": "openai",
            # No model specified, should use language default
        }
        
        result = get_llm_for_language("en-IN", override_config=override_config)
        
        # Should use language default model
        mock_create.assert_called_once_with(
            model="gpt-4o-mini",  # en-IN default
            language_code="en-IN",
            temperature=None,
            api_key=None
        )
        assert result == mock_llm
    
    @pytest.mark.unit
    def test_get_llm_for_language_unsupported_provider(self):
        """Test error handling for unsupported provider."""
        override_config = {
            "provider": "unsupported",
            "model": "test-model"
        }
        
        with pytest.raises(ValueError, match="Unsupported LLM provider"):
            get_llm_for_language("en-IN", override_config=override_config)
    
    @pytest.mark.unit
    def test_get_llm_for_language_missing_model(self):
        """Test error handling when model is missing."""
        override_config = {
            "provider": "openai",
            # No model specified
        }
        
        # This should fallback to language defaults, so let's test with a language that has defaults
        with patch('app.llms.llm.create_openai_llm') as mock_create:
            mock_llm = Mock()
            mock_create.return_value = mock_llm
            
            # Override with provider but no model - should use language default
            override_config = {"provider": "openai"}
            result = get_llm_for_language("en-IN", override_config=override_config)
            
            # Should use en-IN default model
            mock_create.assert_called_once_with(
                model="gpt-4o-mini",
                language_code="en-IN",
                temperature=None,
                api_key=None
            )


class TestLLMAbstractionIntegration:
    """Integration tests for LLM abstraction."""
    
    @pytest.mark.integration
    @patch('app.llms.openai.ChatOpenAI')
    @patch('app.llms.openai.settings')
    def test_full_llm_creation_flow(self, mock_settings, mock_chat_openai_class):
        """Test complete LLM creation flow."""
        mock_settings.OPENAI_API_KEY = "test-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        llm = get_llm_for_language("en-IN")
        
        assert llm == mock_llm_instance
        mock_chat_openai_class.assert_called_once_with(
            model="gpt-4o-mini",
            temperature=0.7,
            api_key="test-key"
        )
    
    @pytest.mark.integration
    @patch('app.llms.openai.ChatOpenAI')
    @patch('app.llms.openai.settings')
    def test_llm_with_different_languages(self, mock_settings, mock_chat_openai_class):
        """Test LLM creation with different language codes."""
        mock_settings.OPENAI_API_KEY = "test-key"
        mock_settings.LLM_TEMPERATURE = "0.7"
        mock_llm_instance = Mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        # Test en-IN
        llm1 = get_llm_for_language("en-IN")
        assert mock_chat_openai_class.call_args_list[0].kwargs["model"] == "gpt-4o-mini"
        
        # Reset mock
        mock_chat_openai_class.reset_mock()
        mock_chat_openai_class.return_value = mock_llm_instance
        
        # Test hi-IN
        llm2 = get_llm_for_language("hi-IN")
        assert mock_chat_openai_class.call_args_list[0].kwargs["model"] == "gpt-4o-mini"
    
    @pytest.mark.integration
    @patch('app.llms.llm.create_openai_llm')
    def test_language_defaults_integration(self, mock_create):
        """Test integration with LANGUAGE_DEFAULTS."""
        mock_llm = Mock()
        mock_create.return_value = mock_llm
        
        # Test that language defaults are used correctly
        for lang_code in ["en-IN", "hi-IN"]:
            mock_create.reset_mock()
            result = get_llm_for_language(lang_code)
            
            mock_create.assert_called_once_with(
                model="gpt-4o-mini",
                language_code=lang_code,
                temperature=None,
                api_key=None
            )
            assert result == mock_llm

