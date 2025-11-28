"""Comprehensive tests for new TTS directory structure."""
import pytest
from unittest.mock import Mock, patch, MagicMock

from app.tts.tts import (
    get_default_tts_config,
    get_tts_for_scenario,
    Gender,
)
from app.tts.deepgram import create_deepgram_tts
from app.tts.elevenlabs import create_elevenlabs_tts
from app.tts.sarvam import create_sarvam_tts
from app.core.constants import TTSProvider
from app.core.scenario.base import VoiceConfig, ScenarioVoice


class TestDeepgramProvider:
    """Test cases for Deepgram TTS provider."""
    
    @pytest.mark.unit
    @patch('app.tts.deepgram.validate_deepgram_voice')
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.tts.deepgram.settings')
    def test_create_deepgram_tts_success(self, mock_settings, mock_tts_class, mock_validate):
        """Test successful Deepgram TTS creation."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = VoiceConfig(model="nova-2")
        result = create_deepgram_tts(config)
        
        mock_validate.assert_called_once_with(model="nova-2")
        mock_tts_class.assert_called_once_with(
            model="nova-2",
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.tts.deepgram.validate_deepgram_voice')
    def test_create_deepgram_tts_missing_model(self, mock_validate):
        """Test Deepgram TTS creation with missing model."""
        config = VoiceConfig(model=None)
        
        with pytest.raises(ValueError, match="Deepgram TTS requires 'model' in config"):
            create_deepgram_tts(config)
    
    @pytest.mark.unit
    @patch('app.tts.deepgram.validate_deepgram_voice')
    def test_create_deepgram_tts_invalid_model(self, mock_validate):
        """Test Deepgram TTS creation with invalid model."""
        mock_validate.return_value = False
        config = VoiceConfig(model="invalid-model")
        
        with pytest.raises(ValueError, match="Invalid Deepgram model"):
            create_deepgram_tts(config)
    
    @pytest.mark.unit
    @patch('app.tts.deepgram.validate_deepgram_voice')
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.tts.deepgram.settings')
    def test_create_deepgram_tts_with_language_code(self, mock_settings, mock_tts_class, mock_validate):
        """Test Deepgram TTS creation with language_code (should be ignored)."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = VoiceConfig(model="nova-2")
        result = create_deepgram_tts(config, language_code="hi-IN")
        
        # Language code should not affect Deepgram TTS creation
        mock_tts_class.assert_called_once_with(
            model="nova-2",
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key"
        )
        assert result == mock_tts_instance


class TestElevenLabsProvider:
    """Test cases for ElevenLabs TTS provider."""
    
    @pytest.mark.unit
    @patch('app.tts.elevenlabs.validate_elevenlabs_voice')
    @patch('livekit.plugins.elevenlabs.TTS')
    @patch('app.tts.elevenlabs.settings')
    def test_create_elevenlabs_tts_success(self, mock_settings, mock_tts_class, mock_validate):
        """Test successful ElevenLabs TTS creation."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = VoiceConfig(voice_id="test-voice-id", model="eleven_multilingual_v2")
        result = create_elevenlabs_tts(config)
        
        mock_validate.assert_called_once_with(voice_id="test-voice-id")
        mock_tts_class.assert_called_once_with(
            voice_id="test-voice-id",
            model="eleven_multilingual_v2",
            api_key="test-api-key"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    def test_create_elevenlabs_tts_missing_voice_id(self):
        """Test ElevenLabs TTS creation with missing voice_id."""
        config = VoiceConfig(model="eleven_multilingual_v2")
        
        with pytest.raises(ValueError, match="ElevenLabs TTS requires 'voice_id' in config"):
            create_elevenlabs_tts(config)
    
    @pytest.mark.unit
    def test_create_elevenlabs_tts_missing_model(self):
        """Test ElevenLabs TTS creation with missing model."""
        config = VoiceConfig(voice_id="test-voice-id")
        
        with pytest.raises(ValueError, match="ElevenLabs TTS requires 'model' in config"):
            create_elevenlabs_tts(config)
    
    @pytest.mark.unit
    @patch('app.tts.elevenlabs.validate_elevenlabs_voice')
    def test_create_elevenlabs_tts_invalid_voice_id(self, mock_validate):
        """Test ElevenLabs TTS creation with invalid voice_id."""
        mock_validate.return_value = False
        config = VoiceConfig(voice_id="invalid-voice", model="eleven_multilingual_v2")
        
        with pytest.raises(ValueError, match="Invalid ElevenLabs voice_id"):
            create_elevenlabs_tts(config)


class TestSarvamProvider:
    """Test cases for Sarvam TTS provider."""
    
    @pytest.mark.unit
    @patch('app.tts.sarvam.validate_sarvam_voice')
    @patch('livekit.plugins.sarvam.TTS')
    @patch('app.tts.sarvam.settings')
    def test_create_sarvam_tts_success(self, mock_settings, mock_tts_class, mock_validate):
        """Test successful Sarvam TTS creation."""
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = VoiceConfig(model="bulbul:v2", speaker="anushka")
        result = create_sarvam_tts(config, language_code="en-IN")
        
        mock_validate.assert_called_once_with(model="bulbul:v2", speaker="anushka")
        mock_tts_class.assert_called_once_with(
            target_language_code="en-IN",
            speaker="anushka",
            api_key="test-api-key"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.tts.sarvam.validate_sarvam_voice')
    @patch('livekit.plugins.sarvam.TTS')
    @patch('app.tts.sarvam.settings')
    def test_create_sarvam_tts_with_hi_in(self, mock_settings, mock_tts_class, mock_validate):
        """Test Sarvam TTS creation with Hindi language code."""
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = VoiceConfig(model="bulbul:v2", speaker="anushka")
        result = create_sarvam_tts(config, language_code="hi-IN")
        
        mock_tts_class.assert_called_once_with(
            target_language_code="hi-IN",
            speaker="anushka",
            api_key="test-api-key"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.tts.sarvam.validate_sarvam_voice')
    @patch('livekit.plugins.sarvam.TTS')
    @patch('app.tts.sarvam.settings')
    def test_create_sarvam_tts_default_language(self, mock_settings, mock_tts_class, mock_validate):
        """Test Sarvam TTS creation with default language when not provided."""
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = VoiceConfig(model="bulbul:v2", speaker="anushka")
        result = create_sarvam_tts(config, language_code=None)
        
        # Should default to "en-IN"
        mock_tts_class.assert_called_once_with(
            target_language_code="en-IN",
            speaker="anushka",
            api_key="test-api-key"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    def test_create_sarvam_tts_missing_speaker(self):
        """Test Sarvam TTS creation with missing speaker."""
        config = VoiceConfig(model="bulbul:v2")
        
        with pytest.raises(ValueError, match="Sarvam TTS requires 'speaker' in config"):
            create_sarvam_tts(config)
    
    @pytest.mark.unit
    def test_create_sarvam_tts_missing_model(self):
        """Test Sarvam TTS creation with missing model."""
        config = VoiceConfig(speaker="anushka")
        
        with pytest.raises(ValueError, match="Sarvam TTS requires 'model' in config"):
            create_sarvam_tts(config)
    
    @pytest.mark.unit
    @patch('app.tts.sarvam.validate_sarvam_voice')
    def test_create_sarvam_tts_invalid_config(self, mock_validate):
        """Test Sarvam TTS creation with invalid configuration."""
        mock_validate.return_value = False
        config = VoiceConfig(model="bulbul:v2", speaker="invalid-speaker")
        
        with pytest.raises(ValueError, match="Invalid Sarvam configuration"):
            create_sarvam_tts(config)


class TestGetDefaultTTSConfig:
    """Test cases for get_default_tts_config function."""
    
    @pytest.mark.unit
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.tts.tts.settings')
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
    @patch('app.tts.tts.settings')
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
    @patch('app.tts.tts.settings')
    def test_get_default_config_missing_setting(self, mock_settings):
        """Test handling missing settings attribute."""
        del mock_settings.DEFAULT_MALE_VOICE_MODEL
        
        with pytest.raises(ValueError, match="Missing default Deepgram TTS settings"):
            get_default_tts_config(Gender.MALE)


class TestGetTTSForScenario:
    """Test cases for get_tts_for_scenario function."""
    
    @pytest.mark.unit
    @patch('app.tts.tts.get_default_tts_config')
    def test_get_tts_none_voice_returns_default(self, mock_get_default):
        """Test getting TTS for None voice returns default."""
        mock_tts_instance = Mock()
        mock_get_default.return_value = mock_tts_instance
        
        result = get_tts_for_scenario(None, Gender.MALE)
        
        mock_get_default.assert_called_once_with(Gender.MALE)
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.tts.tts._validate_tts_config')
    @patch('app.tts.tts.get_default_tts_config')
    def test_get_tts_invalid_config_falls_back(self, mock_get_default, mock_validate):
        """Test fallback to default when voice config is invalid."""
        mock_validate.return_value = False
        mock_tts_instance = Mock()
        mock_get_default.return_value = mock_tts_instance
        
        voice_config = VoiceConfig(voice_id="only")  # Missing model for ElevenLabs
        scenario_voice = ScenarioVoice(
            name="test",
            provider=TTSProvider.ELEVENLABS,
            config=voice_config
        )
        
        result = get_tts_for_scenario(scenario_voice, Gender.FEMALE)
        
        mock_validate.assert_called_once_with(TTSProvider.ELEVENLABS.lower(), voice_config)
        mock_get_default.assert_called_once_with(Gender.FEMALE)
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.tts.tts._create_provider_tts')
    @patch('app.tts.tts._validate_tts_config')
    def test_get_tts_success_with_language_code(self, mock_validate, mock_create):
        """Test successful TTS creation with language code."""
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_create.return_value = mock_tts_instance
        
        voice_config = VoiceConfig(model="bulbul:v2", speaker="anushka")
        scenario_voice = ScenarioVoice(
            name="test",
            provider=TTSProvider.SARVAM,
            config=voice_config
        )
        
        result = get_tts_for_scenario(scenario_voice, Gender.MALE, language_code="hi-IN")
        
        mock_create.assert_called_once_with(
            TTSProvider.SARVAM.lower(),
            voice_config,
            "hi-IN"
        )
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.tts.tts._create_provider_tts')
    @patch('app.tts.tts._validate_tts_config')
    @patch('app.tts.tts.get_default_tts_config')
    @patch('app.tts.tts.logger')
    def test_get_tts_creation_failure_falls_back(self, mock_logger, mock_get_default, mock_validate, mock_create):
        """Test fallback to default when TTS creation fails."""
        mock_validate.return_value = True
        mock_create.side_effect = RuntimeError("Creation failed")
        mock_tts_instance = Mock()
        mock_get_default.return_value = mock_tts_instance
        
        voice_config = VoiceConfig(model="test-model")
        scenario_voice = ScenarioVoice(
            name="test",
            provider=TTSProvider.DEEPGRAM,
            config=voice_config
        )
        
        result = get_tts_for_scenario(scenario_voice, Gender.NON_BINARY)
        
        mock_create.assert_called_once_with(
            TTSProvider.DEEPGRAM.lower(),
            voice_config,
            None
        )
        mock_get_default.assert_called_once_with(Gender.NON_BINARY)
        mock_logger.warning.assert_called_once()
        assert result == mock_tts_instance
    
    @pytest.mark.unit
    @patch('app.tts.tts._create_provider_tts')
    @patch('app.tts.tts._validate_tts_config')
    def test_get_tts_without_language_code(self, mock_validate, mock_create):
        """Test TTS creation without language code parameter."""
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_create.return_value = mock_tts_instance
        
        voice_config = VoiceConfig(model="nova-2")
        scenario_voice = ScenarioVoice(
            name="test",
            provider=TTSProvider.DEEPGRAM,
            config=voice_config
        )
        
        result = get_tts_for_scenario(scenario_voice, Gender.MALE)
        
        mock_create.assert_called_once_with(
            TTSProvider.DEEPGRAM.lower(),
            voice_config,
            None
        )
        assert result == mock_tts_instance


class TestTTSNewStructureIntegration:
    """Integration tests for new TTS structure."""
    
    @pytest.mark.integration
    @patch('livekit.plugins.deepgram.TTS')
    @patch('app.tts.tts.settings')
    def test_full_tts_creation_flow(self, mock_settings, mock_tts_class):
        """Test complete TTS creation flow with new structure."""
        mock_settings.DEFAULT_MALE_VOICE_MODEL = "aura-asteria-en"
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        tts_instance = get_default_tts_config(Gender.MALE)
        assert tts_instance == mock_tts_instance
    
    @pytest.mark.integration
    @patch('app.tts.sarvam.validate_sarvam_voice')
    @patch('livekit.plugins.sarvam.TTS')
    @patch('app.tts.sarvam.settings')
    def test_sarvam_with_language_code_integration(self, mock_settings, mock_tts_class, mock_validate):
        """Test Sarvam TTS with language code in integration scenario."""
        mock_settings.SARVAM_API_KEY = "test-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance
        
        config = VoiceConfig(model="bulbul:v2", speaker="anushka")
        result = create_sarvam_tts(config, language_code="hi-IN")
        
        mock_tts_class.assert_called_once_with(
            target_language_code="hi-IN",
            speaker="anushka",
            api_key="test-key"
        )
        assert result == mock_tts_instance

