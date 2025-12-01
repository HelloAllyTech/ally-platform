"""Deepgram TTS provider implementation."""
from typing import Optional
from livekit.plugins import deepgram
from deepgram import DeepgramClient
from deepgram.core import ApiError as DeepgramApiError
from app.core.config import settings
from app.core.scenario.base import VoiceConfig
from app.tts.base import BaseTTSClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class DeepgramTTSClient(BaseTTSClient):
    """
    Deepgram TTS client implementation.
    """
    
    def __init__(
        self,
        model: str,
        language_code: str,
        api_key: Optional[str] = None,
    ):
        """
        Initialize Deepgram TTS client.
        
        Args:
            model: Deepgram model name (e.g., "nova-2")
            language_code: BCP 47 language code (not used by Deepgram, but kept for consistency)
            api_key: Optional API key (defaults to settings.DEEPGRAM_API_KEY)
        """
        if not model:
            raise ValueError("Deepgram TTS requires 'model'")
        
        # Validate configuration
        if not self.validate_voice(model=model, api_key=api_key):
            raise ValueError(f"Invalid Deepgram model: {model}")
        
        self._model = model
        self._language_code = language_code
        self._api_key = api_key or settings.DEEPGRAM_API_KEY
        self._tts_instance = None
    
    @staticmethod
    def validate_voice(model: str, api_key: Optional[str] = None) -> bool:
        """
        Validate Deepgram TTS model using SDK by generating a short audio sample.
        
        Args:
            model: Deepgram model name
            api_key: Optional API key (defaults to settings.DEEPGRAM_API_KEY)
        
        Returns:
            True if validation succeeds, False otherwise
        """
        if not model:
            logger.error("Deepgram validation requires 'model' parameter")
            return False
        
        logger.info(f"Validating Deepgram voice model='{model}'")

        try:
            key = api_key or settings.DEEPGRAM_API_KEY
            client = DeepgramClient(api_key=key)
            test_text = "Test"

            # Deepgram returns a generator yielding audio chunks
            audio_stream = client.speak.v1.audio.generate(
                text=test_text,
                model=model,
                encoding="linear16",
                sample_rate=16000,
            )

            audio_bytes = b"".join(chunk for chunk in audio_stream)

            if audio_bytes:
                logger.info(f"Deepgram voice validation succeeded. Generated {len(audio_bytes)} bytes.")
                return True

            logger.warning("Deepgram voice validation failed: No audio data generated.")
            return False

        except DeepgramApiError as api_err:
            logger.warning(f"Deepgram validation failed | API error: {api_err}")
            return False
        except Exception as e:
            logger.exception(f"Deepgram validation error: {e}")
            return False
    
    @property
    def tts_instance(self) -> deepgram.TTS:
        """Get the underlying Deepgram TTS instance."""
        if self._tts_instance is None:
            self._tts_instance = deepgram.TTS(
                model=self._model,
                encoding="linear16",
                sample_rate=24000,
                api_key=self._api_key,
            )
        return self._tts_instance

