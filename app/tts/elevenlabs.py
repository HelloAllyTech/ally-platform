"""ElevenLabs TTS provider implementation."""

from typing import Any, Dict, Optional

from elevenlabs import ElevenLabs
from elevenlabs.core import ApiError as ElevenLabsApiError
from livekit.plugins import elevenlabs
from livekit.plugins.elevenlabs import VoiceSettings

from app.core.config import settings
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

logger = get_logger(__name__)


class ElevenLabsTTSClient(BaseTTSClient):
    """
    ElevenLabs TTS client implementation.

    Args:
        model: ElevenLabs model name
        voice_id: ElevenLabs voice ID
        language_code: BCP 47 language code (not used by ElevenLabs,
            but kept for consistency)
        api_key: Optional API key (defaults to settings.ELEVEN_API_KEY)
    """

    # Define parameter metadata as class constant
    # Parameter names must match ElevenLabs TTS API option names
    PARAMETER_METADATA = {
        "speed": {
            "type": "float",
            "range": [0.85, 1.15],
            "default": 1.0,
            "description": (
                "Speech speed multiplier. 1.0 is normal speed, >1.0 is faster, "
                "<1.0 is slower. Range: 0.85 to 1.15."
            ),
        },
        "stability": {
            "type": "float",
            "range": [0.5, 1.0],
            "default": 0.71,
            "description": (
                "Voice stability/consistency. Lower values (0.0-0.5) = more "
                "expressive/emotional variation. Higher values (0.7-1.0) = more "
                "stable/controlled voice. Range: 0.5 to 1.0."
            ),
        },
        "similarity_boost": {
            "type": "float",
            "range": [0.0, 1.0],
            "default": 0.5,
            "description": (
                "Similarity to original voice. Higher values (0.7-1.0) = closer "
                "match to original voice character. Lower values (0.0-0.5) = more "
                "deviation in style/timbre. Range: 0.0 to 1.0."
            ),
        },
    }

    # Define text enhancement metadata for audio tags (v3 models only)
    # Audio tags are supported in Eleven v3 (Alpha) model, not in v2 models
    TEXT_ENHANCEMENT_METADATA = {
        "instructions": """
ElevenLabs v3 (Alpha) supports audio tags for expressive speech control.
These tags are placed inline in square brackets.

Supported audio tag categories:
- Emotions: [curious], [crying], [mischievously], [excited], [sad], [happy],
  [angry], [surprised], [calm], [empathetic]
- Delivery/pace: [whispers], [shouts], [rushed], [slow], [normal]
- Human reactions: [laughs], [sighs], [clears throat], [gasps]
- Pauses: [pause], [short pause], [long pause]

IMPORTANT NOTES:
- Audio tags are ONLY supported in v3 models
  (e.g., "eleven_v3", "eleven_multilingual_v3")
- v2 models (e.g., "eleven_turbo_v2_5", "eleven_multilingual_v2")
  do NOT support audio tags
- Tags should be placed at the beginning of sentences/phrases for best effect
- Some tags may be spoken aloud instead of interpreted
  (v3 is in alpha/research preview)
- Pause durations are approximate and may vary

THERAPY SESSION SPECIFIC RULES:
1. "Vulnerable Pause": Add [long pause] or [pause] before/after vulnerable
   admissions or difficult revelations. Example: "[long pause] I've never told
   anyone this before [pause] but..."
2. "Anxious Rush": Use [rushed] at the start of sentences when character is
   anxious or overwhelmed. Example: "[rushed] I just can't seem to catch my
   breath [pause] everything feels so overwhelming."
3. "Heavy Sigh": Add [sighs] or [clears throat] before heavy emotional moments
   or when processing difficult information. Example: "[sighs] I've been
   carrying this for so long [pause] I don't even know where to start."
4. "Processing Break": Add [pause] or [long pause] when character is
   processing difficult emotions or trauma. Example: "That memory [pause] it's
   still so vivid [long pause] I can feel it in my body."

GENERAL USAGE:
1. Place emotion/delivery tags at the start of sentences or phrases
2. Use pause tags between phrases for natural rhythm
3. Combine tags naturally: "[surprised] Really? [pause] I didn't expect that."
4. Avoid overusing tags - use them for emphasis and natural expression
5. For therapy sessions, prioritize vulnerable pauses and processing breaks
   to create space for emotional processing

Examples:
- "[empathetic] I understand how you're feeling. [pause] That must be really difficult."
- "[sighs] I've been thinking about this a lot [long pause] and I realize..."
- "[rushed] I just can't stop worrying [pause] it's like my mind won't shut off."
- "[calm] Let's take a deep breath. [short pause] Everything will be okay."
        """,
    }

    def __init__(
        self,
        model: str,
        voice_id: str,
        language_code: str,
        api_key: Optional[str] = None,
    ):
        logger.debug(
            f"[ElevenLabs] __init__ called with model={model}, "
            f"voice_id={voice_id}, language_code={language_code}"
        )

        if not voice_id:
            logger.error("[ElevenLabs] __init__: voice_id is required")
            raise ValueError("ElevenLabs TTS requires 'voice_id'")
        if not model:
            logger.error("[ElevenLabs] __init__: model is required")
            raise ValueError("ElevenLabs TTS requires 'model'")

        # Validate configuration
        logger.debug(f"[ElevenLabs] Validating voice_id: {voice_id}")
        if not self.validate_voice(voice_id=voice_id, api_key=api_key):
            logger.error(
                f"[ElevenLabs] Voice validation failed for voice_id: {voice_id}"
            )
            raise ValueError(f"Invalid ElevenLabs voice_id: {voice_id}")

        logger.debug("[ElevenLabs] Voice validation successful, initializing client")

        self._model = model
        self._voice_id = voice_id
        self._language_code = language_code
        self._api_key = api_key or settings.ELEVEN_API_KEY
        self._tts_instance = None

        # Check if model supports audio tags (v3 models only)
        self._supports_audio_tags = (
            "v3" in model.lower() or "eleven_v3" in model.lower()
        )

    @staticmethod
    def validate_voice(voice_id: str, api_key: Optional[str] = None) -> bool:
        """
        Validate an ElevenLabs voice by fetching metadata using the SDK.

        Args:
            voice_id: ElevenLabs voice ID
            api_key: Optional API key (defaults to settings.ELEVEN_API_KEY)

        Returns:
            True if validation succeeds, False otherwise
        """
        logger.debug(f"[ElevenLabs] validate_voice called with voice_id: {voice_id}")

        if not voice_id:
            logger.error("[ElevenLabs] Validation requires 'voice_id' parameter")
            return False

        try:
            key = api_key or settings.ELEVEN_API_KEY
            logger.debug(
                f"[ElevenLabs] Creating ElevenLabs client with API key "
                f"(present: {bool(key)})"
            )
            client = ElevenLabs(api_key=key)
            logger.debug(
                f"[ElevenLabs] Fetching voice metadata for voice_id: {voice_id}"
            )
            voice = client.voices.get(voice_id=voice_id)
            logger.debug(f"[ElevenLabs] Voice API response: {voice}")

            if voice and getattr(voice, "voice_id", None) == voice_id:
                logger.info(
                    f"[ElevenLabs] Voice validation successful for voice_id: {voice_id}"
                )
                return True

            logger.warning(
                f"[ElevenLabs] Validation failed | Unexpected response: {voice!r}"
            )
            return False

        except ElevenLabsApiError as api_err:
            logger.warning(f"[ElevenLabs] Validation failed | API error: {api_err}")
            return False
        except Exception as e:
            logger.exception(f"[ElevenLabs] Validation error: {e}")
            return False

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "ElevenLabsTTSClient":
        """
        Create ElevenLabs TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "eleven_turbo_v2_5", "voice_id": "..."}
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            ElevenLabsTTSClient instance
        """
        logger.debug(
            f"[ElevenLabs] from_config called with config: {config}, "
            f"language_code: {language_code}"
        )
        model = config.get("model")
        voice_id = config.get("voice_id") or config.get("voiceId")

        logger.debug(f"[ElevenLabs] Extracted model: {model}, voice_id: {voice_id}")

        if not model:
            logger.error("[ElevenLabs] Missing 'model' in config")
            raise ValueError("ElevenLabs TTS requires 'model' in config")
        if not voice_id:
            logger.error("[ElevenLabs] Missing 'voice_id' or 'voiceId' in config")
            raise ValueError(
                "ElevenLabs TTS requires 'voice_id' or 'voiceId' in config"
            )

        logger.debug(
            f"[ElevenLabs] Creating ElevenLabsTTSClient with model={model}, "
            f"voice_id={voice_id}, language_code={language_code}"
        )
        return cls(
            model=model,
            voice_id=voice_id,
            language_code=language_code,
            api_key=settings.ELEVEN_API_KEY,
        )

    @property
    def tts_instance(self) -> elevenlabs.TTS:
        """Get the underlying ElevenLabs TTS instance."""
        if self._tts_instance is None:
            self._tts_instance = elevenlabs.TTS(
                voice_id=self._voice_id,
                model=self._model,
                api_key=self._api_key,
            )
        return self._tts_instance

    def get_text_enhancement_instructions(self) -> Optional[str]:
        """
        Get text enhancement instructions for audio tags.

        Audio tags are only supported in v3 models. Returns None for v2 models.

        Returns:
            Instructions string if v3 model, None otherwise
        """
        if self._supports_audio_tags:
            metadata = getattr(self.__class__, "TEXT_ENHANCEMENT_METADATA", None)
            if isinstance(metadata, dict):
                return metadata.get("instructions")
        return None

    def _apply_parameters_dict(self, params_dict: Dict[str, Any]) -> None:
        """
        Apply validated parameters dict to ElevenLabs TTS instance.

        ElevenLabs TTS requires parameters to be wrapped in VoiceSettings object.

        Args:
            params_dict: Validated dict with parameter names as keys
        """
        try:
            if self.tts_instance is None:
                logger.warning(
                    "[ElevenLabs] Cannot apply parameters: TTS instance is None"
                )
                return

            if not params_dict:
                logger.debug("[ElevenLabs] No parameters to apply (empty dict)")
                return

            # ElevenLabs requires speed to be in VoiceSettings object
            # VoiceSettings requires stability and similarity_boost as
            # required arguments
            # Use values from params_dict if available, otherwise use
            # LiveKit defaults
            speed_value = params_dict.get("speed")
            if speed_value is None:
                speed_value = 1.0

            stability_value = params_dict.get("stability")
            if stability_value is None:
                stability_value = 0.71  # LiveKit default

            similarity_boost_value = params_dict.get("similarity_boost")
            if similarity_boost_value is None:
                similarity_boost_value = 0.5  # LiveKit default

            voice_settings = VoiceSettings(
                stability=stability_value,
                similarity_boost=similarity_boost_value,
                speed=speed_value,
            )

            logger.debug(
                f"[ElevenLabs] Applying VoiceSettings: speed={speed_value}, "
                f"stability={stability_value}, "
                f"similarity_boost={similarity_boost_value}"
            )

            # Update TTS options with VoiceSettings
            if hasattr(self.tts_instance, "update_options"):
                self.tts_instance.update_options(voice_settings=voice_settings)
                logger.debug(
                    "[ElevenLabs] Successfully updated TTS options with VoiceSettings"
                )
            else:
                logger.warning(
                    "[ElevenLabs] TTS instance does not have update_options() method"
                )

        except Exception as e:
            logger.error(
                f"[ElevenLabs] Failed to update TTS options: {e}", exc_info=True
            )
