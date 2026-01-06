"""ElevenLabs TTS provider implementation."""

from typing import Any, Dict, Optional

from elevenlabs import ElevenLabs
from elevenlabs.core import ApiError as ElevenLabsApiError
from livekit.plugins import elevenlabs

from app.core.config import settings
from app.tts.base import BaseTTSClient
from app.utils.logger import get_logger

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

    def __init__(
        self,
        model: str,
        voice_id: str,
        language_code: str,
        api_key: Optional[str] = None,
    ):
        if not voice_id:
            raise ValueError("ElevenLabs TTS requires 'voice_id'")
        if not model:
            raise ValueError("ElevenLabs TTS requires 'model'")

        # Validate configuration
        if not self.validate_voice(voice_id=voice_id, api_key=api_key):
            raise ValueError(f"Invalid ElevenLabs voice_id: {voice_id}")

        self._model = model
        self._voice_id = voice_id
        self._language_code = language_code
        self._api_key = api_key or settings.ELEVEN_API_KEY
        self._tts_instance = None

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
        if not voice_id:
            logger.error("ElevenLabs validation requires 'voice_id' parameter")
            return False

        logger.info(f"Validating ElevenLabs voice voice_id='{voice_id}'")

        try:
            key = api_key or settings.ELEVEN_API_KEY
            client = ElevenLabs(api_key=key)
            voice = client.voices.get(voice_id=voice_id)

            if voice and getattr(voice, "voice_id", None) == voice_id:
                logger.info("ElevenLabs voice validation successful")
                return True

            logger.warning(
                f"ElevenLabs validation failed | Unexpected response: {voice!r}"
            )
            return False

        except ElevenLabsApiError as api_err:
            logger.warning(f"ElevenLabs validation failed | API error: {api_err}")
            return False
        except Exception as e:
            logger.exception(f"ElevenLabs validation error: {e}")
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
        model = config.get("model")
        voice_id = config.get("voice_id") or config.get("voiceId")

        if not model:
            raise ValueError("ElevenLabs TTS requires 'model' in config")
        if not voice_id:
            raise ValueError(
                "ElevenLabs TTS requires 'voice_id' or 'voiceId' in config"
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
