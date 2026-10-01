"""Hume.ai TTS provider implementation."""

from typing import Any, Dict, List, Optional

from langchain_core.tools import BaseTool
from livekit.plugins.hume import TTS, VoiceByName, VoiceProvider

from app.core.config import settings
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

logger = get_logger(__name__)


class HumeTTSClient(BaseTTSClient):
    """
    Hume.ai TTS client implementation.

    Based on LiveKit Hume TTS plugin:
    https://docs.livekit.io/agents/integrations/tts/hume/

    Supports multiple languages including English and Hindi via Octave 2 model.
    Uses VoiceByName to select voices by name.

    Args:
        voice_name: Hume voice name (e.g., "Ava Song", "Male English Actor")
            This should match one of Hume's available voice names from
            the Voice Library or a custom voice you've created.
            See: https://dev.hume.ai/docs/text-to-speech-tts/voices
        instant_mode: Optional boolean for instant mode (defaults to False)
        language_code: Optional BCP 47 language code (e.g., "en-IN", "hi-IN")
            Note: Language is typically determined by the voice name
            itself
        voice_provider: Optional voice provider type - "HUME_AI" for
            pre-existing voices from Voice Library, or "CUSTOM_VOICE" for
            custom voices (defaults to "HUME_AI")
        api_key: Optional API key (defaults to settings.HUME_API_KEY)
    """

    # Define parameter metadata as class constant
    # Parameter names must match Hume TTS API option names
    PARAMETER_METADATA = {
        "speed": {
            "type": "float",
            "range": [0.5, 2.0],
            "default": 1.0,
            "description": (
                "Speech speed multiplier. 1.0 is normal speed, "
                ">1.0 is faster, <1.0 is slower."
            ),
        },
        "description": {
            "type": "str",
            "description": "Text instruction describing desired voice tone/emotion.",
            "examples": [
                "speak with excitement",
                "sound empathetic and understanding",
                "speak calmly and professionally",
            ],
        },
    }

    # Hume does not support inline text enhancement (audio tags / SSML), so it
    # inherits supports_text_enhancement() -> False from BaseTTSClient. To enable
    # it later: override supports_text_enhancement() to return True and add the
    # tag guidance to prompt management as `ally_ai_learn_system_audio_tag_guidance`
    # (or a Hume-specific prompt code), the same way ElevenLabs v3 does.

    def __init__(
        self,
        voice_name: str,
        instant_mode: Optional[bool] = None,
        language_code: Optional[str] = None,
        voice_provider: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        super().__init__()  # Initialize base class parameter storage
        if not voice_name:
            raise ValueError("Hume TTS requires 'voice_name'")

        # Validate configuration
        if not self.validate_voice(voice_name=voice_name):
            raise ValueError(f"Invalid Hume TTS configuration: voice_name={voice_name}")

        self._voice_name = voice_name
        self._instant_mode = instant_mode if instant_mode is not None else False
        self._language_code = language_code
        # Default to HUME_AI if not specified (pre-existing voices from Voice Library)
        self._voice_provider = voice_provider or "HUME_AI"
        self._api_key = api_key or settings.HUME_API_KEY
        self._tts_instance = None

    @staticmethod
    def validate_voice(voice_name: str) -> bool:
        """
        Validate Hume.ai TTS configuration.

        Validates that voice_name is provided.
        See: https://docs.livekit.io/agents/integrations/tts/hume/

        Args:
            voice_name: Hume voice name

        Returns:
            True if validation succeeds, False otherwise
        """
        if not voice_name:
            logger.error("Hume validation requires 'voice_name' parameter")
            return False

        logger.info(f"Validating Hume TTS voice_name='{voice_name}'")

        try:
            # Basic validation - check that required parameters are present
            # Note: Full validation would require calling Hume API to verify
            # voice name exists
            # For now, we do basic parameter validation
            if not isinstance(voice_name, str) or not voice_name.strip():
                logger.error(
                    f"Invalid voice_name '{voice_name}'. Must be a non-empty string"
                )
                return False

            logger.info("Hume TTS validation passed (basic parameter check)")
            return True

        except Exception as e:
            logger.error(f"Hume TTS validation failed: {e}")
            return False

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "HumeTTSClient":
        """
        Create Hume TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"voice_name": "Priya", "instant_mode": False,
                 "voice_provider": "HUME_AI"}
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            HumeTTSClient instance
        """
        voice_name = config.get("voice_name")
        if not voice_name:
            raise ValueError("Hume TTS requires 'voice_name' in config")

        return cls(
            voice_name=voice_name,
            instant_mode=config.get("instant_mode"),
            language_code=language_code,
            voice_provider=config.get("voice_provider"),
            api_key=settings.HUME_API_KEY,
        )

    def allows_clip_synthesis(self) -> bool:
        """Hume Octave is generative — each request re-performs the voice — so
        a clip would be heard as a second take of the character right before
        the reply. Stated explicitly, though the base default says the same."""
        return False

    @property
    def tts_instance(self) -> TTS:
        """Get the underlying Hume.ai TTS instance."""
        if self._tts_instance is None:
            try:
                # Map voice_provider string to VoiceProvider enum
                # Try different enum value formats based on common patterns
                provider_enum = None
                provider_str = self._voice_provider.upper()

                if provider_str == "HUME_AI":
                    # Try different enum naming conventions
                    for attr_name in ["hume_ai", "HUME_AI", "hume", "HumeAI"]:
                        if hasattr(VoiceProvider, attr_name):
                            provider_enum = getattr(VoiceProvider, attr_name)
                            logger.debug(f"Using VoiceProvider.{attr_name}")
                            break
                elif provider_str == "CUSTOM_VOICE":
                    for attr_name in [
                        "custom_voice",
                        "CUSTOM_VOICE",
                        "CustomVoice",
                        "custom",
                    ]:
                        if hasattr(VoiceProvider, attr_name):
                            provider_enum = getattr(VoiceProvider, attr_name)
                            logger.debug(f"Using VoiceProvider.{attr_name}")
                            break

                # Fallback to hume if not found
                if provider_enum is None:
                    logger.warning(
                        f"Could not find VoiceProvider enum for "
                        f"'{self._voice_provider}', trying VoiceProvider.hume "
                        f"as fallback. Available attributes: "
                        f"{dir(VoiceProvider)}"
                    )
                    provider_enum = VoiceProvider.hume

                logger.info(
                    f"Creating Hume TTS with voice_name='{self._voice_name}', "
                    f"provider={self._voice_provider} (enum={provider_enum}), "
                    f"instant_mode={self._instant_mode}"
                )

                self._tts_instance = TTS(
                    voice=VoiceByName(
                        name=self._voice_name,
                        provider=provider_enum,
                    ),
                    instant_mode=self._instant_mode,
                    api_key=self._api_key,
                )
                self._wrap_stream_with_timeout(self._tts_instance)
                logger.info("Successfully created Hume TTS instance")
            except AttributeError as e:
                logger.error(
                    f"VoiceProvider enum error: {e}. Available attributes: "
                    f"{dir(VoiceProvider)}"
                )
                attrs = [
                    attr for attr in dir(VoiceProvider) if not attr.startswith("_")
                ]
                raise ValueError(
                    f"Invalid VoiceProvider enum value "
                    f"'{self._voice_provider}'. "
                    f"Available VoiceProvider attributes: {attrs}. "
                    f"Original error: {e}"
                ) from e
            except Exception as e:
                logger.error(f"Failed to create Hume TTS instance: {e}")
                logger.exception("Full error details:")
                raise ValueError(
                    f"Failed to initialize Hume TTS with voice_name="
                    f"'{self._voice_name}', provider='{self._voice_provider}'. "
                    f"Error: {e}. Ensure: "
                    f"1. The voice name '{self._voice_name}' exists in "
                    f"Hume's Voice Library "
                    f"(see https://dev.hume.ai/docs/text-to-speech-tts/voices) "
                    f"OR has been created as a custom voice. "
                    f"2. The voice_provider is set correctly ('HUME_AI' for "
                    f"pre-existing voices, 'CUSTOM_VOICE' for custom voices)."
                ) from e
        return self._tts_instance

    def get_tools(self) -> List[BaseTool]:
        """Get single tool for setting voice parameters."""
        return [self._create_set_voice_parameters_tool()]
