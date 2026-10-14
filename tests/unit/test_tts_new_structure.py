"""Comprehensive tests for new TTS directory structure."""

from unittest.mock import Mock, patch

import pytest

from app.tts import Gender, create_tts_client, get_default_tts_config
from app.tts.deepgram import DeepgramTTSClient
from app.tts.elevenlabs import ElevenLabsTTSClient
from app.tts.google import GoogleTTSClient
from app.tts.sarvam import SarvamTTSClient


class TestDeepgramProvider:
    """Test cases for Deepgram TTS provider."""

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient.validate_voice")
    @patch("livekit.plugins.deepgram.TTS")
    @patch("app.tts.deepgram.settings")
    def test_create_deepgram_tts_success(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test successful Deepgram TTS creation."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        client = DeepgramTTSClient(
            model="nova-2", language_code="en-IN", api_key="test-api-key"
        )
        result = client.tts_instance

        mock_tts_class.assert_called_once_with(
            model="nova-2",
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key",
        )
        assert result == mock_tts_instance

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient.validate_voice")
    def test_create_deepgram_tts_missing_model(self, mock_validate):
        """Test Deepgram TTS creation with missing model."""
        with pytest.raises(ValueError, match="Deepgram TTS requires 'model'"):
            DeepgramTTSClient(model="", language_code="en-IN")

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient.validate_voice")
    @patch("livekit.plugins.deepgram.TTS")
    @patch("app.tts.deepgram.settings")
    def test_create_deepgram_tts_with_language_code(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test Deepgram TTS creation with language_code (should be ignored)."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        client = DeepgramTTSClient(
            model="nova-2", language_code="hi-IN", api_key="test-api-key"
        )
        result = client.tts_instance

        # Language code should not affect Deepgram TTS creation
        mock_tts_class.assert_called_once_with(
            model="nova-2",
            encoding="linear16",
            sample_rate=24000,
            api_key="test-api-key",
        )
        assert result == mock_tts_instance


class TestElevenLabsProvider:
    """Test cases for ElevenLabs TTS provider."""

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_create_elevenlabs_tts_success(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test successful ElevenLabs TTS creation."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        client = ElevenLabsTTSClient(
            model="eleven_multilingual_v2",
            voice_id="test-voice-id",
            language_code="en-IN",
            api_key="test-api-key",
        )
        result = client.tts_instance

        mock_tts_class.assert_called_once_with(
            voice_id="test-voice-id",
            model="eleven_multilingual_v2",
            api_key="test-api-key",
            inactivity_timeout=30.0,
        )
        assert result == mock_tts_instance

    @pytest.mark.unit
    def test_create_elevenlabs_tts_missing_voice_id(self):
        """Test ElevenLabs TTS creation with missing voice_id."""
        with pytest.raises(ValueError, match="ElevenLabs TTS requires 'voice_id'"):
            ElevenLabsTTSClient(
                model="eleven_multilingual_v2", voice_id="", language_code="en-IN"
            )

    @pytest.mark.unit
    def test_create_elevenlabs_tts_missing_model(self):
        """Test ElevenLabs TTS creation with missing model."""
        with pytest.raises(ValueError, match="ElevenLabs TTS requires 'model'"):
            ElevenLabsTTSClient(
                model="", voice_id="test-voice-id", language_code="en-IN"
            )

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_elevenlabs_from_config_with_camelcase_voice_id(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test ElevenLabs from_config with camelCase voiceId (backward compat)."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        config = {
            "model": "eleven_multilingual_v2",
            "voiceId": "test-voice-id-camel",  # camelCase
        }

        client = ElevenLabsTTSClient.from_config(config=config, language_code="en-IN")

        assert client._model == "eleven_multilingual_v2"
        assert client._voice_id == "test-voice-id-camel"

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_elevenlabs_from_config_with_snake_case_voice_id(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test ElevenLabs from_config with snake_case voice_id (preferred format)."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        config = {
            "model": "eleven_multilingual_v2",
            "voice_id": "test-voice-id-snake",  # snake_case
        }

        client = ElevenLabsTTSClient.from_config(config=config, language_code="en-IN")

        assert client._model == "eleven_multilingual_v2"
        assert client._voice_id == "test-voice-id-snake"

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("app.tts.elevenlabs.agents_tts.StreamAdapter")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_v3_model_wraps_with_stream_adapter(
        self, mock_settings, mock_tts_class, mock_stream_adapter, mock_validate
    ):
        """eleven_v3 must route through StreamAdapter (HTTP chunked) since the
        WS multi-stream-input endpoint is unsupported for v3."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True
        base_tts = Mock()
        mock_tts_class.return_value = base_tts
        wrapped = Mock()
        mock_stream_adapter.return_value = wrapped

        client = ElevenLabsTTSClient(
            model="eleven_v3",
            voice_id="test-voice-id",
            language_code="hi-IN",
            api_key="test-api-key",
        )

        assert client._is_v3_model is True
        result = client.tts_instance

        mock_tts_class.assert_called_once_with(
            voice_id="test-voice-id",
            model="eleven_v3",
            api_key="test-api-key",
            inactivity_timeout=30.0,
        )
        mock_stream_adapter.assert_called_once_with(tts=base_tts)
        assert result is wrapped
        assert client._base_tts is base_tts

    @pytest.mark.unit
    @pytest.mark.parametrize("model", ["eleven_v4", "eleven_v4_turbo"])
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("app.tts.elevenlabs.agents_tts.StreamAdapter")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_v4_models_wrap_with_stream_adapter(
        self, mock_settings, mock_tts_class, mock_stream_adapter, mock_validate, model
    ):
        """eleven_v4 / eleven_v4_turbo must take the same HTTP StreamAdapter
        path as v3: the multi-stream-input socket rejects them (verified live)."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True
        base_tts = Mock()
        mock_tts_class.return_value = base_tts
        wrapped = Mock()
        mock_stream_adapter.return_value = wrapped
        client = ElevenLabsTTSClient(
            model=model,
            voice_id="test-voice-id",
            language_code="en-IN",
            api_key="test-api-key",
        )
        assert client._is_generative_model is True
        assert client.tts_instance is wrapped
        mock_stream_adapter.assert_called_once_with(tts=base_tts)
        _, kwargs = base_tts.update_options.call_args
        assert kwargs["voice_settings"].stability == 0.95

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("app.tts.elevenlabs.agents_tts.StreamAdapter")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_non_v3_model_does_not_wrap(
        self, mock_settings, mock_tts_class, mock_stream_adapter, mock_validate
    ):
        """Non-v3 models must use the plugin's WS path directly — no StreamAdapter."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True
        base_tts = Mock()
        mock_tts_class.return_value = base_tts

        client = ElevenLabsTTSClient(
            model="eleven_multilingual_v2",
            voice_id="test-voice-id",
            language_code="en-IN",
            api_key="test-api-key",
        )

        assert client._is_v3_model is False
        result = client.tts_instance

        mock_stream_adapter.assert_not_called()
        assert result is base_tts
        assert client._base_tts is base_tts

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("app.tts.elevenlabs.agents_tts.StreamAdapter")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_v3_apply_parameters_updates_underlying_tts(
        self, mock_settings, mock_tts_class, mock_stream_adapter, mock_validate
    ):
        """Voice settings must apply to the underlying elevenlabs.TTS even when
        wrapped in StreamAdapter — StreamAdapter does not forward update_options."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True
        base_tts = Mock()
        mock_tts_class.return_value = base_tts
        mock_stream_adapter.return_value = Mock(spec=[])  # no update_options

        client = ElevenLabsTTSClient(
            model="eleven_v3",
            voice_id="test-voice-id",
            language_code="hi-IN",
            api_key="test-api-key",
        )
        client._apply_parameters_dict(
            {"speed": 1.05, "stability": 0.7, "similarity_boost": 0.6}
        )

        # tts_instance property calls update_options, then _apply_parameters_dict does.
        assert base_tts.update_options.call_count == 2

        # Check the call from _apply_parameters_dict (it's the last one)
        _, kwargs = base_tts.update_options.call_args
        vs = kwargs["voice_settings"]
        assert vs.speed == 1.05
        assert vs.stability == 0.7
        assert vs.similarity_boost == 0.6

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "model,expected_v3",
        [
            ("eleven_v3", True),
            ("eleven_multilingual_v3", True),
            ("Eleven_V3", True),  # case-insensitive
            ("eleven_v3_conversational", True),
            ("eleven_v4", True),
            ("eleven_v4_turbo", True),
            ("eleven_multilingual_v2", False),
            ("eleven_turbo_v2_5", False),
            ("eleven_flash_v2_5", False),
        ],
    )
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    def test_v3_detection(self, mock_validate, model, expected_v3):
        """Generative detection must accept v3 and v4 variants and reject
        v2/turbo/flash (eleven_v4 / eleven_v4_turbo fail the WS path live)."""
        mock_validate.return_value = True
        client = ElevenLabsTTSClient(
            model=model,
            voice_id="test-voice-id",
            language_code="en-IN",
            api_key="test-api-key",
        )
        assert client._is_v3_model is expected_v3
        assert client._is_generative_model is expected_v3
        assert client._supports_audio_tags is expected_v3


class TestSarvamProvider:
    """Test cases for Sarvam TTS provider."""

    @pytest.mark.unit
    @patch("app.tts.sarvam.SarvamTTSClient.validate_voice")
    @patch("livekit.plugins.sarvam.TTS")
    @patch("app.tts.sarvam.settings")
    def test_create_sarvam_tts_success(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test successful Sarvam TTS creation."""
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        client = SarvamTTSClient(
            model="bulbul:v2",
            speaker="anushka",
            language_code="en-IN",
            api_key="test-api-key",
        )
        result = client.tts_instance

        mock_tts_class.assert_called_once_with(
            target_language_code="en-IN",
            model="bulbul:v2",
            speaker="anushka",
            api_key="test-api-key",
        )
        assert result == mock_tts_instance

    @pytest.mark.unit
    @patch("app.tts.sarvam.SarvamTTSClient.validate_voice")
    @patch("livekit.plugins.sarvam.TTS")
    @patch("app.tts.sarvam.settings")
    def test_create_sarvam_tts_with_hi_in(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test Sarvam TTS creation with Hindi language code."""
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        client = SarvamTTSClient(
            model="bulbul:v2",
            speaker="anushka",
            language_code="hi-IN",
            api_key="test-api-key",
        )
        result = client.tts_instance

        mock_tts_class.assert_called_once_with(
            target_language_code="hi-IN",
            model="bulbul:v2",
            speaker="anushka",
            api_key="test-api-key",
        )
        assert result == mock_tts_instance

    @pytest.mark.unit
    @patch("app.tts.sarvam.SarvamTTSClient.validate_voice")
    @patch("livekit.plugins.sarvam.TTS")
    @patch("app.tts.sarvam.settings")
    def test_create_sarvam_tts_default_language(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test Sarvam TTS creation with default language when not provided."""
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        client = SarvamTTSClient(
            model="bulbul:v2",
            speaker="anushka",
            language_code=None,  # Will default to "en-IN" in _convert_language_code
            api_key="test-api-key",
        )
        result = client.tts_instance

        # Should default to "en-IN"
        mock_tts_class.assert_called_once_with(
            target_language_code="en-IN",
            model="bulbul:v2",
            speaker="anushka",
            api_key="test-api-key",
        )
        assert result == mock_tts_instance

    @pytest.mark.unit
    def test_create_sarvam_tts_missing_speaker(self):
        """Test Sarvam TTS creation with missing speaker."""
        with pytest.raises(ValueError, match="Sarvam TTS requires 'speaker'"):
            SarvamTTSClient(model="bulbul:v2", speaker="", language_code="en-IN")

    @pytest.mark.unit
    def test_create_sarvam_tts_missing_model(self):
        """Test Sarvam TTS creation with missing model."""
        with pytest.raises(ValueError, match="Sarvam TTS requires 'model'"):
            SarvamTTSClient(model="", speaker="anushka", language_code="en-IN")


class TestCreateTTSClientWithDefaults:
    """Test cases for create_tts_client function with defaults."""

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_default_male(self, mock_settings, mock_deepgram_client):
        """Test creating TTS client with defaults for male gender."""
        mock_settings.DEFAULT_MALE_VOICE_MODEL = "nova-2-male"
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_client = Mock()
        mock_deepgram_client.return_value = mock_client

        result = create_tts_client(language_code="en-IN", gender=Gender.MALE)

        assert result == mock_client
        mock_deepgram_client.assert_called_once_with(
            model="nova-2-male",
            language_code="en-IN",
            api_key="test-key",
        )

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_default_female(
        self, mock_settings, mock_deepgram_client
    ):
        """Test creating TTS client with defaults for female gender."""
        mock_settings.DEFAULT_FEMALE_VOICE_MODEL = "nova-2-female"
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_client = Mock()
        mock_deepgram_client.return_value = mock_client

        result = create_tts_client(language_code="en-IN", gender=Gender.FEMALE)

        assert result == mock_client
        mock_deepgram_client.assert_called_once_with(
            model="nova-2-female",
            language_code="en-IN",
            api_key="test-key",
        )

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_default_non_binary(
        self, mock_settings, mock_deepgram_client
    ):
        """Test creating TTS client with defaults for non-binary gender."""
        mock_settings.DEFAULT_NON_BINARY_VOICE_MODEL = "nova-2-nb"
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_client = Mock()
        mock_deepgram_client.return_value = mock_client

        result = create_tts_client(language_code="en-IN", gender=Gender.NON_BINARY)

        assert result == mock_client
        mock_deepgram_client.assert_called_once_with(
            model="nova-2-nb",
            language_code="en-IN",
            api_key="test-key",
        )

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_missing_setting_raises(
        self, mock_settings, mock_deepgram_client
    ):
        """Test that missing gender-specific setting raises ValueError."""
        mock_settings.DEFAULT_MALE_VOICE_MODEL = None
        delattr(mock_settings, "DEFAULT_MALE_VOICE_MODEL")
        mock_settings.DEEPGRAM_API_KEY = "test-key"

        with pytest.raises(ValueError, match="Missing default Deepgram TTS settings"):
            create_tts_client(language_code="en-IN", gender=Gender.MALE)

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_creation_exception_raises(
        self, mock_settings, mock_deepgram_client
    ):
        """Test that non-AttributeError exceptions in _get_default_tts_client
        are raised."""
        mock_settings.DEFAULT_MALE_VOICE_MODEL = "nova-2"
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_deepgram_client.side_effect = RuntimeError("Connection failed")

        with pytest.raises(RuntimeError, match="Connection failed"):
            create_tts_client(language_code="en-IN", gender=Gender.MALE)

    @pytest.mark.unit
    def test_create_tts_client_requires_gender_when_no_config(self):
        """Test that gender is required when tts_config is None."""
        with pytest.raises(ValueError, match="gender is required"):
            create_tts_client(language_code="en-IN")

    @pytest.mark.unit
    @patch("app.tts.factory.settings")
    def test_create_tts_client_missing_setting(self, mock_settings):
        """Test handling missing settings attribute."""
        del mock_settings.DEFAULT_MALE_VOICE_MODEL

        with pytest.raises((ValueError, AttributeError), match="Missing|default"):
            create_tts_client(language_code="en-IN", gender=Gender.MALE)


class TestCreateTTSClientWithConfig:
    """Test cases for create_tts_client function with config."""

    @pytest.mark.unit
    @patch("app.tts.sarvam.SarvamTTSClient")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_with_sarvam_config(
        self, mock_settings, mock_sarvam_client
    ):
        """Test creating TTS client with Sarvam config from metadata."""
        mock_settings.SARVAM_API_KEY = "test-key"
        mock_client = Mock()
        mock_sarvam_client.from_config.return_value = mock_client

        tts_config = {
            "provider": "sarvam",
            "name": "test-voice",
            "config": {"model": "bulbul:v2", "speaker": "anushka"},
        }

        result = create_tts_client(tts_config=tts_config, language_code="hi-IN")

        mock_sarvam_client.from_config.assert_called_once_with(
            config={"model": "bulbul:v2", "speaker": "anushka"},
            language_code="hi-IN",
        )
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_with_deepgram_config(
        self, mock_settings, mock_deepgram_client
    ):
        """Test creating TTS client with Deepgram config."""
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_client = Mock()
        mock_deepgram_client.from_config.return_value = mock_client

        tts_config = {
            "provider": "deepgram",
            "name": "test-voice",
            "config": {"model": "nova-2"},
        }

        result = create_tts_client(tts_config=tts_config, language_code="en-IN")

        mock_deepgram_client.from_config.assert_called_once_with(
            config={"model": "nova-2"},
            language_code="en-IN",
        )
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.tts.factory._get_default_tts_client")
    @patch("app.tts.factory.logger")
    def test_create_tts_client_invalid_config_falls_back(
        self, mock_logger, mock_get_default
    ):
        """Test fallback to default when config is invalid."""
        mock_client = Mock()
        mock_get_default.return_value = mock_client

        tts_config = {
            "provider": "elevenlabs",
            "config": {"voice_id": "only"},  # Missing model
        }

        result = create_tts_client(
            tts_config=tts_config, language_code="en-IN", gender=Gender.FEMALE
        )

        mock_get_default.assert_called_once_with(Gender.FEMALE, "en-IN")
        mock_logger.warning.assert_called_once()
        assert result == mock_client

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory._get_default_tts_client")
    @patch("app.tts.factory.logger")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_creation_failure_falls_back(
        self, mock_settings, mock_logger, mock_get_default, mock_deepgram_client
    ):
        """Test fallback to default when TTS creation fails."""
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_deepgram_client.from_config.side_effect = RuntimeError("Creation failed")
        mock_client = Mock()
        mock_get_default.return_value = mock_client

        tts_config = {"provider": "deepgram", "config": {"model": "test-model"}}

        result = create_tts_client(
            tts_config=tts_config, language_code="en-IN", gender=Gender.NON_BINARY
        )

        mock_get_default.assert_called_once_with(Gender.NON_BINARY, "en-IN")
        mock_logger.warning.assert_called_once()
        assert result == mock_client

    @pytest.mark.unit
    def test_create_tts_client_missing_provider_falls_back(self):
        """Test that missing provider falls back to defaults."""
        tts_config = {"name": "test-voice", "config": {}}

        with pytest.raises(ValueError, match="gender is required"):
            create_tts_client(tts_config=tts_config, language_code="en-IN")

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory.settings")
    def test_create_tts_client_missing_provider_with_gender_falls_back(
        self, mock_settings, mock_deepgram_client
    ):
        """Test that missing provider falls back to defaults when gender provided."""
        mock_settings.DEFAULT_MALE_VOICE_MODEL = "nova-2"
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_client_instance = Mock()
        mock_deepgram_client.return_value = mock_client_instance

        tts_config = {"name": "test-voice", "config": {}}
        result = create_tts_client(
            tts_config=tts_config, language_code="en-IN", gender=Gender.MALE
        )

        assert result == mock_client_instance
        mock_deepgram_client.assert_called_once()

    @pytest.mark.unit
    @patch("app.tts.google.GoogleTTSClient")
    def test_create_tts_client_with_google_config(self, mock_google_client):
        """Test creating Google TTS client from config."""
        mock_client_instance = Mock()
        mock_google_client.from_config.return_value = mock_client_instance

        tts_config = {
            "provider": "google",
            "name": "test-voice",
            "config": {"model": "test-model", "voice_id": "test-voice-id"},
        }
        result = create_tts_client(tts_config=tts_config, language_code="en-IN")

        mock_google_client.from_config.assert_called_once_with(
            config=tts_config["config"], language_code="en-IN"
        )
        assert result == mock_client_instance

    @pytest.mark.unit
    @patch("app.tts.hume.HumeTTSClient")
    def test_create_tts_client_with_hume_config(self, mock_hume_client):
        """Test creating Hume TTS client from config."""
        mock_client_instance = Mock()
        mock_hume_client.from_config.return_value = mock_client_instance

        tts_config = {
            "provider": "hume",
            "name": "test-voice",
            "config": {"model": "test-model", "voice_id": "test-voice-id"},
        }
        result = create_tts_client(tts_config=tts_config, language_code="en-IN")

        mock_hume_client.from_config.assert_called_once_with(
            config=tts_config["config"], language_code="en-IN"
        )
        assert result == mock_client_instance

    @pytest.mark.unit
    @patch("app.tts.factory._get_default_tts_client")
    def test_create_tts_client_unsupported_provider_falls_back(self, mock_get_default):
        """Test that unsupported provider falls back to defaults."""
        mock_client_instance = Mock()
        mock_get_default.return_value = mock_client_instance

        tts_config = {
            "provider": "unsupported",
            "name": "test-voice",
            "config": {},
        }
        result = create_tts_client(
            tts_config=tts_config, language_code="en-IN", gender=Gender.MALE
        )

        mock_get_default.assert_called_once_with(Gender.MALE, "en-IN")
        assert result == mock_client_instance

    @pytest.mark.unit
    def test_create_tts_client_unsupported_provider_no_gender_raises(self):
        """Test that unsupported provider without gender raises ValueError."""
        tts_config = {
            "provider": "unsupported",
            "name": "test-voice",
            "config": {},
        }
        with pytest.raises(
            ValueError, match="Unsupported TTS provider.*gender is required"
        ):
            create_tts_client(tts_config=tts_config, language_code="en-IN")

    @pytest.mark.unit
    @patch("app.tts.factory._get_default_tts_client")
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient")
    def test_create_tts_client_creation_failure_falls_back_with_gender(
        self, mock_elevenlabs_client, mock_get_default
    ):
        """Test that TTS creation failure falls back when gender provided."""
        mock_elevenlabs_client.from_config.side_effect = ValueError("Creation failed")
        mock_fallback_client = Mock()
        mock_get_default.return_value = mock_fallback_client

        tts_config = {
            "provider": "elevenlabs",
            "name": "test-voice",
            "config": {"voice_id": "invalid"},
        }
        result = create_tts_client(
            tts_config=tts_config, language_code="en-IN", gender=Gender.MALE
        )

        mock_get_default.assert_called_once_with(Gender.MALE, "en-IN")
        assert result == mock_fallback_client

    @pytest.mark.unit
    def test_create_tts_client_creation_failure_no_gender_raises(self):
        """Test that TTS creation failure without gender raises ValueError."""
        with patch("app.tts.elevenlabs.ElevenLabsTTSClient") as mock_elevenlabs:
            mock_elevenlabs.from_config.side_effect = ValueError("Creation failed")

            tts_config = {
                "provider": "elevenlabs",
                "name": "test-voice",
                "config": {"voice_id": "invalid"},
            }
            with pytest.raises(
                ValueError, match="Failed to create TTS client and gender is required"
            ):
                create_tts_client(tts_config=tts_config, language_code="en-IN")


class TestGetDefaultTTSConfig:
    """Test cases for get_default_tts_config convenience function."""

    @pytest.mark.unit
    @patch("app.tts.factory.create_tts_client")
    def test_get_default_tts_config_returns_instance(self, mock_create_tts):
        """Test that get_default_tts_config returns TTS instance directly."""
        mock_tts_instance = Mock()
        mock_client = Mock()
        mock_client.tts_instance = mock_tts_instance
        mock_create_tts.return_value = mock_client

        result = get_default_tts_config(Gender.MALE, "en-IN")

        mock_create_tts.assert_called_once_with(
            language_code="en-IN", gender=Gender.MALE
        )
        assert result == mock_tts_instance

    @pytest.mark.unit
    @patch("app.tts.factory.create_tts_client")
    def test_get_default_tts_config_uses_default_language(self, mock_create_tts):
        """Test that get_default_tts_config uses DEFAULT_LANGUAGE_CODE
        when not provided."""
        mock_tts_instance = Mock()
        mock_client = Mock()
        mock_client.tts_instance = mock_tts_instance
        mock_create_tts.return_value = mock_client

        result = get_default_tts_config(Gender.FEMALE)

        mock_create_tts.assert_called_once_with(
            language_code="en-IN", gender=Gender.FEMALE
        )
        assert result == mock_tts_instance


class TestTTSNewStructureIntegration:
    """Integration tests for new TTS structure."""

    @pytest.mark.integration
    @patch("app.tts.deepgram.DeepgramTTSClient")
    @patch("app.tts.factory.settings")
    def test_full_tts_creation_flow(self, mock_settings, mock_deepgram_client):
        """Test complete TTS creation flow with new structure."""
        mock_settings.DEFAULT_MALE_VOICE_MODEL = "nova-2"
        mock_settings.DEEPGRAM_API_KEY = "test-key"
        mock_tts_instance = Mock()
        mock_client_instance = Mock()
        mock_client_instance.tts_instance = mock_tts_instance
        mock_deepgram_client.return_value = mock_client_instance

        tts_client = create_tts_client(language_code="en-IN", gender=Gender.MALE)
        assert tts_client == mock_client_instance
        mock_deepgram_client.assert_called_once()

    @pytest.mark.integration
    @patch("app.tts.sarvam.SarvamTTSClient.validate_voice")
    @patch("livekit.plugins.sarvam.TTS")
    @patch("app.tts.sarvam.settings")
    def test_sarvam_with_language_code_integration(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        """Test Sarvam TTS with language code in integration scenario."""
        mock_settings.SARVAM_API_KEY = "test-key"
        mock_validate.return_value = True
        mock_tts_instance = Mock()
        mock_tts_class.return_value = mock_tts_instance

        client = SarvamTTSClient(
            model="bulbul:v2",
            speaker="anushka",
            language_code="hi-IN",
            api_key="test-key",
        )
        result = client.tts_instance

        mock_tts_class.assert_called_once_with(
            target_language_code="hi-IN",
            model="bulbul:v2",
            speaker="anushka",
            api_key="test-key",
        )
        assert result == mock_tts_instance


class TestGoogleProvider:
    """Google TTS — audio-encoding handling for Chirp 3 HD voices.

    Regression: Chirp 3 HD voices reject the LiveKit plugin's default PCM
    encoding (Google 400 "only supports LINEAR16/MP3/OGG_OPUS/MULAW/ALAW",
    retryable=False), so every synthesis failed and the agent joined but never
    spoke — sessions appeared "stuck" (seen live on mr-IN-Chirp3-HD-Leda). We
    force OGG_OPUS for Chirp voices and leave non-Chirp voices on the default.
    """

    @patch("app.tts.google.GoogleTTSClient.validate_voice")
    @patch("app.tts.google.google.TTS")
    @patch("app.tts.google.settings")
    def test_chirp_voice_forces_ogg_opus(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        from google.cloud import texttospeech

        mock_settings.GOOGLE_TTS_CREDENTIALS_FILE = None
        mock_validate.return_value = True
        mock_tts_class.return_value = Mock()

        client = GoogleTTSClient(
            language_code="mr-IN",
            voice_name="mr-IN-Chirp3-HD-Leda",
            gender="female",
        )
        _ = client.tts_instance

        kwargs = mock_tts_class.call_args.kwargs
        assert kwargs["audio_encoding"] == texttospeech.AudioEncoding.OGG_OPUS
        # Chirp voices resolve to the chirp_3 plugin model.
        assert kwargs["model_name"] == "chirp_3"

    @patch("app.tts.google.GoogleTTSClient.validate_voice")
    @patch("app.tts.google.google.TTS")
    @patch("app.tts.google.settings")
    def test_non_chirp_voice_keeps_default_encoding(
        self, mock_settings, mock_tts_class, mock_validate
    ):
        mock_settings.GOOGLE_TTS_CREDENTIALS_FILE = None
        mock_validate.return_value = True
        mock_tts_class.return_value = Mock()

        client = GoogleTTSClient(
            language_code="en-US",
            voice_name="en-US-Neural2-A",
            gender="female",
        )
        _ = client.tts_instance

        kwargs = mock_tts_class.call_args.kwargs
        # No override → plugin keeps its PCM default for non-Chirp voices.
        assert "audio_encoding" not in kwargs
