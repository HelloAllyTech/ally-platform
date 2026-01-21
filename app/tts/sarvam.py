"""Sarvam TTS provider implementation."""

import base64
from typing import Any, Dict, Optional

from livekit.plugins import sarvam
from sarvamai import SarvamAI
from sarvamai.core import ApiError as SarvamaiApiError

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.tts.base import BaseTTSClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _convert_language_code(language_code: Optional[str]) -> str:
    """
    Convert BCP 47 language code to Sarvam's required format.

    Sarvam accepts BCP 47 format directly, but we ensure it's valid.
    Falls back to DEFAULT_LANGUAGE_CODE if not provided.

    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

    Returns:
        Language code in format acceptable by Sarvam API
    """
    if not language_code:
        return DEFAULT_LANGUAGE_CODE

    # Sarvam accepts BCP 47 format directly
    # Return as-is, but could add conversion logic here if needed
    return language_code


class SarvamTTSClient(BaseTTSClient):
    """
    Sarvam TTS client implementation.

    Args:
        model: Sarvam model name (e.g., "multilingual-meera")
        speaker: Sarvam speaker name (e.g., "meera", "arjun")
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        api_key: Optional API key (defaults to settings.SARVAM_API_KEY)
    """

    # Define parameter metadata as class constant
    # Parameter names must match Sarvam TTS API option names
    PARAMETER_METADATA = {
        "pace": {
            "type": "float",
            "range": [0.3, 3.0],
            "default": 1.0,
            "description": (
                "Speech pace (speed) multiplier. 1.0 is normal speed, >1.0 is "
                "faster, <1.0 is slower. Range: 0.3 (slowest) to 3.0 (fastest)."
            ),
        },
        "pitch": {
            "type": "float",
            "range": [-0.75, 0.75],
            "default": 0.0,
            "description": (
                "Pitch shift in semitones. Positive values = higher pitch "
                "(stress/anxiety). Negative values = lower pitch (sadness/relaxation). "
                "0.0 = no change. Range: -0.75 to +0.75."
            ),
        },
        "loudness": {
            "type": "float",
            "range": [0.5, 2.0],
            "default": 1.0,
            "description": (
                "Volume/loudness multiplier. 1.0 = normal volume. Higher values "
                "(1.5-2.0) = louder (excitement). Lower values (0.5-0.7) = quieter "
                "(shame/withdrawal). Range: 0.5 to 2.0."
            ),
        },
    }

    def __init__(
        self,
        model: str,
        speaker: str,
        language_code: str,
        api_key: Optional[str] = None,
    ):
        if not speaker:
            raise ValueError("Sarvam TTS requires 'speaker'")
        if not model:
            raise ValueError("Sarvam TTS requires 'model'")

        # Convert language code to Sarvam format
        target_language = _convert_language_code(language_code)

        # Validate configuration
        if not self.validate_voice(model=model, speaker=speaker, api_key=api_key):
            raise ValueError(
                f"Invalid Sarvam configuration: model={model}, speaker={speaker}"
            )

        self._model = model
        self._speaker = speaker
        self._language_code = language_code
        self._target_language = target_language
        self._api_key = api_key or settings.SARVAM_API_KEY
        self._tts_instance = None

    @staticmethod
    def validate_voice(model: str, speaker: str, api_key: Optional[str] = None) -> bool:
        """
        Validate Sarvam TTS speaker by generating a short audio sample.

        Args:
            model: Sarvam model name
            speaker: Sarvam speaker name
            api_key: Optional API key (defaults to settings.SARVAM_API_KEY)

        Returns:
            True if validation succeeds, False otherwise
        """
        if not model or not speaker:
            logger.error(
                f"Sarvam validation requires both 'model' and 'speaker' "
                f"parameters. Got model='{model}', speaker='{speaker}'"
            )
            return False

        logger.info(f"Validating Sarvam voice model='{model}', speaker='{speaker}'")

        try:
            key = api_key or settings.SARVAM_API_KEY
            client = SarvamAI(api_subscription_key=key)
            response = client.text_to_speech.convert(
                target_language_code="en-IN",
                text="Hello from Sarvam AI!",
                model=model,
                speaker=speaker,
            )

            if not getattr(response, "audios", None):
                logger.warning("Sarvam validation failed | No audio found in response")
                return False

            try:
                base64.b64decode(response.audios[0])
                logger.info("Sarvam TTS validation passed")
                return True
            except Exception:
                logger.warning("Sarvam validation failed | Invalid audio data")
                return False

        except SarvamaiApiError as api_err:
            logger.warning(f"Sarvam validation failed | API error: {api_err}")
            return False
        except Exception as e:
            logger.exception(f"Sarvam TTS validation error: {e}")
            return False

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "SarvamTTSClient":
        """
        Create Sarvam TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "bulbul:v2", "speaker": "anushka"}
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            SarvamTTSClient instance
        """
        model = config.get("model")
        speaker = config.get("speaker")

        if not model:
            raise ValueError("Sarvam TTS requires 'model' in config")
        if not speaker:
            raise ValueError("Sarvam TTS requires 'speaker' in config")

        return cls(
            model=model,
            speaker=speaker,
            language_code=language_code,
            api_key=settings.SARVAM_API_KEY,
        )

    @property
    def tts_instance(self) -> sarvam.TTS:
        """Get the underlying Sarvam TTS instance."""
        if self._tts_instance is None:
            self._tts_instance = sarvam.TTS(
                target_language_code=self._target_language,
                speaker=self._speaker,
                api_key=self._api_key,
            )
        return self._tts_instance
