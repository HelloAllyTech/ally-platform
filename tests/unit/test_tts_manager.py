"""Comprehensive tests for tts_manager module."""
import pytest
from unittest.mock import Mock, patch, MagicMock
from enum import Enum

from app.utils.tts_manager import (
    get_default_tts_config,
    validate_tts_config,
    create_provider_tts,
    get_tts_for_scenario,
    Gender
)
from app.core.constants import TTSProvider
from tests.utils.test_helpers import DataBuilder, AssertionHelpers


class MockConfig:
    """Mock configuration object for testing."""
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class TestGetDefaultTTSConfig:
    """Test cases for get_default_tts_config function."""
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_get_default_config_male(self, mock_settings, mock_tts_class):
        """Test getting default TTS config for male gender."""
        mock_settings.DEFAULT_MALE_VOICE_MODEL = "dg-male"
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        result = get_default_tts_config(Gender.MALE)
        
        assert result == mock_tts_instance
        mock_tts_class.assert_called_once_with(
            model="dg-male",
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key"
        )
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_get_default_config_female(self, mock_settings, mock_tts_class):
        """Test getting default TTS config for female gender."""
        mock_settings.DEFAULT_FEMALE_VOICE_MODEL = "dg-female"
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        result = get_default_tts_config(Gender.FEMALE)
        
        assert result == mock_tts_instance
        mock_tts_class.assert_called_once_with(
            model="dg-female",
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key"
        )
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_get_default_config_non_binary(self, mock_settings, mock_tts_class):
        """Test getting default TTS config for non-binary gender."""
        mock_settings.DEFAULT_NON_BINARY_VOICE_MODEL = "dg-nonbinary"
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        result = get_default_tts_config(Gender.NON_BINARY)
        
        assert result == mock_tts_instance
        mock_tts_class.assert_called_once_with(
            model="dg-nonbinary",
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key"
        )
    
    @pytest.mark.unit
    @patch('app.utils.tts_manager.settings')
    def test_get_default_config_missing_setting(self, mock_settings):
        """Test handling missing settings attribute."""
        # Remove the attribute to simulate missing configuration
        del mock_settings.DEFAULT_MALE_VOICE_MODEL
        
        with pytest.raises(ValueError, match="Missing default Deepgram TTS settings"):
            get_default_tts_config(Gender.MALE)
    
    @pytest.mark.unit
    @pytest.mark.parametrize("gender,expected_attr", [
        (Gender.MALE, "DEFAULT_MALE_VOICE_MODEL"),
        (Gender.FEMALE, "DEFAULT_FEMALE_VOICE_MODEL"),
        (Gender.NON_BINARY, "DEFAULT_NON_BINARY_VOICE_MODEL"),
    ])
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_get_default_config_all_genders(self, mock_settings, mock_tts_class, gender, expected_attr):
        """Test default config retrieval for all gender types."""
        expected_model = f"test-{gender.value}-model"
        setattr(mock_settings, expected_attr, expected_model)
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        result = get_default_tts_config(gender)
        
        assert result == mock_tts_instance
        mock_tts_class.assert_called_once_with(
            model=expected_model,
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key"
        )


class TestValidateTTSConfig:
    """Test cases for validate_tts_config function."""
    
    @pytest.mark.unit
    def test_validate_elevenlabs_config_valid(self):
        """Test validation of valid ElevenLabs config."""
        config = MockConfig(voice_id="test-voice", model="test-model")
        
        result = validate_tts_config(TTSProvider.ELEVENLABS, config)
        
        assert result is True
    
    @pytest.mark.unit
    @pytest.mark.parametrize("voice_id,model,expected", [
        ("test-voice", "test-model", True),
        ("test-voice", None, False),
        (None, "test-model", False),
        (None, None, False),
        ("", "test-model", False),
        ("test-voice", "", False),
    ])
    def test_validate_elevenlabs_config_variations(self, voice_id, model, expected):
        """Test ElevenLabs config validation with various inputs."""
        config = MockConfig(voice_id=voice_id, model=model)
        
        result = validate_tts_config(TTSProvider.ELEVENLABS, config)
        
        assert result is expected
    
    @pytest.mark.unit
    @pytest.mark.parametrize("model,expected", [
        ("test-model", True),
        (None, False),
        ("", False),
    ])
    def test_validate_deepgram_config_variations(self, model, expected):
        """Test Deepgram config validation with various inputs."""
        config = MockConfig(model=model)
        
        result = validate_tts_config(TTSProvider.DEEPGRAM, config)
        
        assert result is expected
    
    @pytest.mark.unit
    @pytest.mark.parametrize("speaker,expected", [
        ("test-speaker", True),
        (None, False),
        ("", False),
    ])
    def test_validate_sarvam_config_variations(self, speaker, expected):
        """Test Sarvam config validation with various inputs."""
        config = MockConfig(speaker=speaker)
        
        result = validate_tts_config(TTSProvider.SARVAM, config)
        
        assert result is expected
    
    @pytest.mark.unit
    def test_validate_unknown_provider(self):
        """Test validation with unknown provider."""
        config = MockConfig()
        
        result = validate_tts_config("unknown_provider", config)
        
        assert result is False


class TestCreateProviderTTS:
    """Test cases for create_provider_tts function."""
    
    @pytest.mark.unit
    @patch('app.utils.tts_manager.TTS_VALIDATORS')
    @patch('livekit.plugins.elevenlabs.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_create_elevenlabs_tts(self, mock_settings, mock_tts_class, mock_validators):
        """Test creating ElevenLabs TTS instance."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate = Mock(return_value=True)
        mock_validators.get.return_value = mock_validate
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = MockConfig(voice_id="test-voice", model="test-model")
        result = create_provider_tts(TTSProvider.ELEVENLABS, config)
        
        mock_validators.get.assert_called_once_with(TTSProvider.ELEVENLABS.lower())
        mock_validate.assert_called_once_with(voice_id="test-voice", model="test-model")
        mock_tts_class.assert_called_once_with(
            voice_id="test-voice",
            model="test-model",
            api_key="test-api-key"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.utils.tts_manager.TTS_VALIDATORS')
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_create_deepgram_tts(self, mock_settings, mock_tts_class, mock_validators):
        """Test creating Deepgram TTS instance."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_validate = Mock(return_value=True)
        mock_validators.get.return_value = mock_validate
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = MockConfig(model="test-model")
        result = create_provider_tts(TTSProvider.DEEPGRAM, config)
        
        mock_validate.assert_called_once_with(model="test-model")
        mock_tts_class.assert_called_once_with(
            model="test-model",
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.utils.tts_manager.TTS_VALIDATORS')
    @patch('livekit.plugins.sarvam.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_create_sarvam_tts(self, mock_settings, mock_tts_class, mock_validators):
        """Test creating Sarvam TTS instance."""
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_validate = Mock(return_value=True)
        mock_validators.get.return_value = mock_validate
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = MockConfig(speaker="test-speaker")
        result = create_provider_tts(TTSProvider.SARVAM, config)
        
        mock_validate.assert_called_once_with(speaker="test-speaker")
        mock_tts_class.assert_called_once_with(
            target_language_code="en-IN",
            speaker="test-speaker",
            api_key="test-api-key"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.utils.tts_manager.TTS_VALIDATORS')
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_create_provider_tts_validation_failure(self, mock_settings, mock_tts_class, mock_validators):
        """Test handling validation failure."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_validate = Mock(return_value=False)
        mock_validators.get.return_value = mock_validate
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        config = MockConfig(model="test-model")
        
        with pytest.raises(ValueError, match="Invalid TTSProvider.DEEPGRAM voice configuration"):
            create_provider_tts(TTSProvider.DEEPGRAM, config)
    
    @pytest.mark.unit
    def test_create_provider_tts_unsupported_provider(self):
        """Test handling unsupported provider."""
        config = MockConfig()
        
        with pytest.raises(ValueError, match="Unsupported TTS provider"):
            create_provider_tts("unknown_provider", config)


class TestGetTTSForScenario:
    """Test cases for get_tts_for_scenario function."""
    
    @pytest.mark.unit
    @patch('app.utils.tts_manager.get_default_tts_config')
    def test_get_tts_none_scenario_returns_default(self, mock_get_default):
        """Test getting TTS for None scenario returns default."""
        mock_tts_instance = Mock()
        mock_get_default.return_value = mock_tts_instance
        
        result = get_tts_for_scenario(None, Gender.MALE)
        
        mock_get_default.assert_called_once_with(Gender.MALE)
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.utils.tts_manager.validate_tts_config')
    @patch('app.utils.tts_manager.get_default_tts_config')
    def test_get_tts_invalid_config_falls_back(self, mock_get_default, mock_validate):
        """Test fallback to default when scenario config is invalid."""
        # Setup mocks
        mock_validate.return_value = False  # Invalid config
        mock_tts_instance = Mock()
        mock_get_default.return_value = mock_tts_instance
        
        # Create scenario voice with invalid config
        voice_config = MockConfig(voice_id="only")  # Missing model for ElevenLabs
        scenario_voice = Mock()
        scenario_voice.provider = TTSProvider.ELEVENLABS
        scenario_voice.config = voice_config
        
        result = get_tts_for_scenario(scenario_voice, Gender.FEMALE)
        
        mock_validate.assert_called_once_with(TTSProvider.ELEVENLABS.lower(), voice_config)
        mock_get_default.assert_called_once_with(Gender.FEMALE)
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.utils.tts_manager.validate_tts_config')
    @patch('app.utils.tts_manager.create_provider_tts')
    @patch('app.utils.tts_manager.get_default_tts_config')
    @patch('app.utils.tts_manager.logger')
    def test_get_tts_creation_failure_falls_back(self, mock_logger, mock_get_default, mock_create, mock_validate):
        """Test fallback to default when TTS creation fails."""
        # Setup mocks
        mock_validate.return_value = True  # Valid config
        mock_create.side_effect = RuntimeError("Creation failed")  # Creation fails
        mock_tts_instance = Mock()
        mock_get_default.return_value = mock_tts_instance
        
        # Create scenario voice with valid config
        voice_config = MockConfig(model="test-model")
        scenario_voice = Mock()
        scenario_voice.provider = TTSProvider.DEEPGRAM
        scenario_voice.config = voice_config
        
        result = get_tts_for_scenario(scenario_voice, Gender.NON_BINARY)
        
        # Should have called create once (failed) and then get_default
        mock_create.assert_called_once_with(TTSProvider.DEEPGRAM.lower(), voice_config)
        mock_get_default.assert_called_once_with(Gender.NON_BINARY)
        mock_logger.warning.assert_called_once()
        assert result == mock_tts_instance


class TestTTSManagerIntegration:
    """Integration tests for TTS manager functionality."""
    
    @pytest.mark.integration
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.utils.tts_manager.settings')
    def test_full_tts_creation_flow(self, mock_settings, mock_tts_class):
        """Test complete TTS creation flow with real components."""
        # Setup settings
        mock_settings.DEFAULT_MALE_VOICE_MODEL = "aura-asteria-en"
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        # Test the full flow
        tts_instance = get_default_tts_config(Gender.MALE)
        assert tts_instance == mock_tts_instance
        
        # Validate a config
        config = MockConfig(model="aura-asteria-en")
        is_valid = validate_tts_config(TTSProvider.DEEPGRAM, config)
        assert is_valid is True
    
    @pytest.mark.integration
    def test_error_handling_chain(self):
        """Test error handling throughout the TTS creation chain."""
        # Test with completely invalid inputs
        result = validate_tts_config("invalid_provider", MockConfig())
        assert result is False
        
        # Test unsupported provider creation
        with pytest.raises(ValueError):
            create_provider_tts("invalid_provider", MockConfig())
