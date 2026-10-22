"""Comprehensive tests for STT abstraction."""

from unittest.mock import Mock, patch

import pytest

from app.stt.base import BaseSTTClient
from app.stt.deepgram import DeepgramSTTClient
from app.stt.elevenlabs import DEFAULT_ELEVENLABS_STT_MODEL, ElevenLabsSTTClient
from app.stt.factory import create_stt_client


class TestDeepgramSTTClient:
    """Test cases for Deepgram STT client."""

    @pytest.mark.unit
    @patch("livekit.plugins.deepgram.STT")
    @patch("app.stt.deepgram.settings")
    def test_deepgram_stt_client_init_success(self, mock_settings, mock_stt_class):
        """Test successful Deepgram STT client initialization with BCP 47 code."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        # Pass BCP 47 format - provider converts it internally
        client = DeepgramSTTClient(model="nova-3", language_code="en-IN")

        # Should convert "en-IN" to "en" (ISO 639-1)
        mock_stt_class.assert_called_once_with(
            model="nova-3", language="en", api_key="test-api-key"
        )
        assert client.stt_instance == mock_stt_instance
        assert isinstance(client, BaseSTTClient)

    @pytest.mark.unit
    @patch("livekit.plugins.deepgram.STT")
    @patch("app.stt.deepgram.settings")
    def test_deepgram_stt_client_with_hi(self, mock_settings, mock_stt_class):
        """Test Deepgram STT client with Hindi BCP 47 code."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        # Pass BCP 47 format - provider converts to "hi"
        client = DeepgramSTTClient(model="nova-3", language_code="hi-IN")

        mock_stt_class.assert_called_once_with(
            model="nova-3", language="hi", api_key="test-api-key"
        )
        assert client.stt_instance == mock_stt_instance

    @pytest.mark.unit
    @patch("livekit.plugins.deepgram.STT")
    def test_deepgram_stt_client_custom_api_key(self, mock_stt_class):
        """Test Deepgram STT client with custom API key."""
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        client = DeepgramSTTClient(
            model="nova-3", language_code="en-IN", api_key="custom-api-key"
        )

        mock_stt_class.assert_called_once_with(
            model="nova-3",
            language="en",  # Converted from "en-IN"
            api_key="custom-api-key",
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
        with pytest.raises(
            ValueError, match="Deepgram STT requires 'language_code' parameter"
        ):
            DeepgramSTTClient(model="nova-3", language_code="")

    @pytest.mark.unit
    @patch("app.stt.deepgram.settings")
    def test_deepgram_stt_client_missing_api_key(self, mock_settings):
        """Test Deepgram STT client with missing API key."""
        mock_settings.DEEPGRAM_API_KEY = None

        with pytest.raises(
            ValueError, match="Deepgram STT requires 'api_key' parameter"
        ):
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

    @pytest.mark.unit
    @patch("livekit.plugins.deepgram.STT")
    @patch("app.stt.deepgram.settings")
    def test_deepgram_stt_client_from_config(self, mock_settings, mock_stt_class):
        """Test DeepgramSTTClient.from_config method."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        config = {"model": "nova-2"}
        client = DeepgramSTTClient.from_config(config=config, language_code="en-IN")

        assert isinstance(client, DeepgramSTTClient)
        mock_stt_class.assert_called_once_with(
            model="nova-2",
            language="en",  # Converted from "en-IN"
            api_key="test-api-key",
        )
        assert client.stt_instance == mock_stt_instance

    @pytest.mark.unit
    @patch("livekit.plugins.deepgram.STT")
    @patch("app.stt.deepgram.settings")
    def test_deepgram_stt_client_from_config_nested(
        self, mock_settings, mock_stt_class
    ):
        """Test DeepgramSTTClient.from_config with nested config structure."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        # Simulate nested config structure (from factory)
        config = {"config": {"model": "nova-2"}}
        client = DeepgramSTTClient.from_config(config=config, language_code="hi-IN")

        assert isinstance(client, DeepgramSTTClient)
        mock_stt_class.assert_called_once_with(
            model="nova-2",
            language="hi",  # Converted from "hi-IN"
            api_key="test-api-key",
        )


_FAST_COMMIT = {"vad_silence_threshold_secs": 0.5, "min_silence_duration_ms": 500}


class TestElevenLabsSTTClient:
    """Test cases for ElevenLabs (Scribe) STT client."""

    @pytest.mark.unit
    @patch("livekit.plugins.elevenlabs.STT")
    @patch("app.stt.elevenlabs.settings")
    def test_elevenlabs_stt_client_init_success(self, mock_settings, mock_stt_class):
        """Test successful ElevenLabs STT client initialization with BCP 47 code."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        # Pass BCP 47 format - provider converts it to ISO 639-1 internally
        client = ElevenLabsSTTClient(model="scribe_v2_realtime", language_code="en-IN")

        # Plugin uses model_id/language_code; "en-IN" -> "en"
        mock_stt_class.assert_called_once_with(
            model_id="scribe_v2_realtime",
            language_code="en",
            api_key="test-api-key",
            server_vad=_FAST_COMMIT,
        )
        assert client.stt_instance == mock_stt_instance
        assert isinstance(client, BaseSTTClient)

    @pytest.mark.unit
    @patch("livekit.plugins.elevenlabs.STT")
    @patch("app.stt.elevenlabs.settings")
    def test_elevenlabs_stt_client_with_hi(self, mock_settings, mock_stt_class):
        """Test ElevenLabs STT client with Hindi BCP 47 code."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        client = ElevenLabsSTTClient(model="scribe_v2_realtime", language_code="hi-IN")

        mock_stt_class.assert_called_once_with(
            model_id="scribe_v2_realtime",
            language_code="hi",
            api_key="test-api-key",
            server_vad=_FAST_COMMIT,
        )
        assert client.stt_instance == mock_stt_instance

    @pytest.mark.unit
    @patch("livekit.plugins.elevenlabs.STT")
    def test_elevenlabs_stt_client_custom_api_key(self, mock_stt_class):
        """Test ElevenLabs STT client with custom API key."""
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        client = ElevenLabsSTTClient(
            model="scribe_v2_realtime",
            language_code="ml-IN",
            api_key="custom-api-key",
        )

        mock_stt_class.assert_called_once_with(
            model_id="scribe_v2_realtime",
            language_code="ml",  # Converted from "ml-IN"
            api_key="custom-api-key",
            server_vad=_FAST_COMMIT,
        )
        assert client.stt_instance == mock_stt_instance

    @pytest.mark.unit
    def test_elevenlabs_stt_client_missing_model(self):
        """Test ElevenLabs STT client with missing model."""
        with pytest.raises(
            ValueError, match="ElevenLabs STT requires 'model' parameter"
        ):
            ElevenLabsSTTClient(model="", language_code="en-IN")

    @pytest.mark.unit
    def test_elevenlabs_stt_client_missing_language_code(self):
        """Test ElevenLabs STT client with missing language code."""
        with pytest.raises(
            ValueError, match="ElevenLabs STT requires 'language_code' parameter"
        ):
            ElevenLabsSTTClient(model="scribe_v2_realtime", language_code="")

    @pytest.mark.unit
    @patch("app.stt.elevenlabs.settings")
    def test_elevenlabs_stt_client_missing_api_key(self, mock_settings):
        """Test ElevenLabs STT client with missing API key."""
        mock_settings.ELEVEN_API_KEY = None

        with pytest.raises(
            ValueError, match="ElevenLabs STT requires 'api_key' parameter"
        ):
            ElevenLabsSTTClient(model="scribe_v2_realtime", language_code="en-IN")

    @pytest.mark.unit
    def test_elevenlabs_language_format(self):
        """Test that ElevenLabs declares ISO 639-1 format requirement."""
        assert ElevenLabsSTTClient.LANGUAGE_FORMAT == "iso6391"

    @pytest.mark.unit
    def test_elevenlabs_convert_language_code(self):
        """Test language code conversion in ElevenLabs client."""
        assert ElevenLabsSTTClient.convert_language_code("en-IN") == "en"
        assert ElevenLabsSTTClient.convert_language_code("hi-IN") == "hi"
        assert ElevenLabsSTTClient.convert_language_code("kn-IN") == "kn"
        assert ElevenLabsSTTClient.convert_language_code("ml") == "ml"

    @pytest.mark.unit
    @patch("livekit.plugins.elevenlabs.STT")
    @patch("app.stt.elevenlabs.settings")
    def test_elevenlabs_stt_client_from_config_defaults_model(
        self, mock_settings, mock_stt_class
    ):
        """from_config defaults to the streaming realtime model when omitted."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        client = ElevenLabsSTTClient.from_config(config={}, language_code="en-IN")

        assert isinstance(client, ElevenLabsSTTClient)
        mock_stt_class.assert_called_once_with(
            model_id=DEFAULT_ELEVENLABS_STT_MODEL,
            language_code="en",
            api_key="test-api-key",
            server_vad=_FAST_COMMIT,
        )

    @pytest.mark.unit
    @patch("livekit.plugins.elevenlabs.STT")
    @patch("app.stt.elevenlabs.settings")
    def test_elevenlabs_stt_client_from_config_nested(
        self, mock_settings, mock_stt_class
    ):
        """from_config supports nested config structure from the factory."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        config = {"config": {"model": "scribe_v2_realtime"}}
        client = ElevenLabsSTTClient.from_config(config=config, language_code="hi-IN")

        assert isinstance(client, ElevenLabsSTTClient)
        mock_stt_class.assert_called_once_with(
            model_id="scribe_v2_realtime",
            language_code="hi",
            api_key="test-api-key",
            server_vad=_FAST_COMMIT,
        )


class TestSTTFactory:
    """Test cases for create_stt_client factory function."""

    @pytest.mark.unit
    @patch("app.stt.google.GoogleSTTClient")
    def test_create_stt_client_with_defaults(self, mock_stt_client_class):
        """Test factory function uses defaults when no config provided.

        The default is Google chirp_2 — and it must carry the region, since
        chirp_2 is not served from "global"."""
        mock_stt_instance = Mock()
        mock_client = Mock()
        mock_client.stt_instance = mock_stt_instance
        mock_stt_client_class.from_config.return_value = mock_client

        client = create_stt_client(language_code="en-IN")

        mock_stt_client_class.from_config.assert_called_once_with(
            config={"model": "chirp_2", "location": "asia-southeast1"},
            language_code="en-IN",
        )
        assert client == mock_client

    @pytest.mark.unit
    @patch("app.stt.google.GoogleSTTClient")
    def test_google_without_model_gets_default_region_too(self, mock_stt_client_class):
        """A Google row with no model inherits the default model AND its region."""
        mock_stt_client_class.from_config.return_value = Mock()

        create_stt_client(
            stt_config={"provider": "google", "config": {}}, language_code="en-IN"
        )

        mock_stt_client_class.from_config.assert_called_once_with(
            config={"model": "chirp_2", "location": "asia-southeast1"},
            language_code="en-IN",
        )

    @pytest.mark.unit
    @patch("app.stt.google.GoogleSTTClient")
    def test_explicit_google_config_is_passed_through(self, mock_stt_client_class):
        """An explicit model keeps whatever location the row chose (or none)."""
        mock_stt_client_class.from_config.return_value = Mock()

        create_stt_client(
            stt_config={"provider": "google", "config": {"model": "chirp_3"}},
            language_code="en-IN",
        )

        mock_stt_client_class.from_config.assert_called_once_with(
            config={"model": "chirp_3"},
            language_code="en-IN",
        )

    @pytest.mark.unit
    @patch("app.stt.deepgram.DeepgramSTTClient")
    def test_create_stt_client_with_metadata_config(self, mock_stt_client_class):
        """Test factory function uses config from metadata."""
        mock_stt_instance = Mock()
        mock_client = Mock()
        mock_client.stt_instance = mock_stt_instance
        mock_stt_client_class.from_config.return_value = mock_client

        stt_config = {"provider": "deepgram", "config": {"model": "nova-2"}}
        client = create_stt_client(stt_config=stt_config, language_code="en-IN")

        # Verify DeepgramSTTClient was created with metadata config using from_config
        mock_stt_client_class.from_config.assert_called_once_with(
            config={"model": "nova-2"},
            language_code="en-IN",
        )
        assert client == mock_client

    @pytest.mark.unit
    @patch("app.stt.elevenlabs.ElevenLabsSTTClient")
    def test_create_stt_client_routes_to_elevenlabs(self, mock_stt_client_class):
        """Test factory routes elevenlabs provider to ElevenLabsSTTClient."""
        mock_client = Mock()
        mock_stt_client_class.from_config.return_value = mock_client

        stt_config = {
            "provider": "elevenlabs",
            "config": {"model": "scribe_v2_realtime"},
        }
        client = create_stt_client(stt_config=stt_config, language_code="hi-IN")

        mock_stt_client_class.from_config.assert_called_once_with(
            config={"model": "scribe_v2_realtime"},
            language_code="hi-IN",
        )
        assert client == mock_client

    @pytest.mark.unit
    @patch("app.stt.deepgram.DeepgramSTTClient")
    def test_create_stt_client_unsupported_provider(self, mock_stt_client_class):
        """Test error handling for unsupported provider."""
        stt_config = {"provider": "unsupported", "config": {"model": "test-model"}}

        with pytest.raises(ValueError, match="Unsupported STT provider"):
            create_stt_client(stt_config=stt_config, language_code="en-IN")


class TestSTTAbstractionIntegration:
    """Integration tests for STT abstraction."""

    @pytest.mark.integration
    @patch("livekit.plugins.google.STT")
    def test_full_stt_creation_flow(self, mock_stt_class):
        """Test complete STT creation flow using factory (Google default)."""
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        stt_client = create_stt_client(language_code="en-IN")

        assert stt_client.stt_instance == mock_stt_instance
        mock_stt_class.assert_called_once_with(
            languages="en-IN",
            spoken_punctuation=False,
            model="chirp_2",
            location="asia-southeast1",
        )

    @pytest.mark.integration
    @patch("livekit.plugins.google.STT")
    def test_stt_with_different_languages(self, mock_stt_class):
        """Test STT creation with different language codes."""
        mock_stt_instance = Mock()
        mock_stt_class.return_value = mock_stt_instance

        # Test en-IN
        create_stt_client(language_code="en-IN")
        assert mock_stt_class.call_args[1]["model"] == "chirp_2"
        assert mock_stt_class.call_args[1]["languages"] == "en-IN"

        # Reset mock
        mock_stt_class.reset_mock()
        mock_stt_class.return_value = mock_stt_instance

        # Test hi-IN
        create_stt_client(language_code="hi-IN")
        assert mock_stt_class.call_args[1]["model"] == "chirp_2"
        assert mock_stt_class.call_args[1]["languages"] == "hi-IN"
