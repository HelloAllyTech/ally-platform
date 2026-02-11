"""Deepgram TTS provider implementation."""

from typing import Any, Dict, Optional

from deepgram import DeepgramClient
from deepgram.core import ApiError as DeepgramApiError
from livekit.plugins import deepgram

from app.core.config import settings
from app.tts.base import BaseTTSClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class DeepgramTTSClient(BaseTTSClient):
    """
    Deepgram TTS client implementation.

    Args:
        model: Deepgram model name (e.g., "nova-2")
        language_code: BCP 47 language code (not used by Deepgram, but
            kept for consistency)
        api_key: Optional API key (defaults to settings.DEEPGRAM_API_KEY)
    """

    def __init__(
        self,
        model: str,
        language_code: str,
        api_key: Optional[str] = None,
    ):
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
                logger.info(
                    f"Deepgram voice validation succeeded. Generated "
                    f"{len(audio_bytes)} bytes."
                )
                return True

            logger.warning("Deepgram voice validation failed: No audio data generated.")
            return False

        except DeepgramApiError as api_err:
            logger.warning(f"Deepgram validation failed | API error: {api_err}")
            return False
        except Exception as e:
            logger.exception(f"Deepgram validation error: {e}")
            return False

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "DeepgramTTSClient":
        """
        Create Deepgram TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "nova-2"}
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            DeepgramTTSClient instance
        """
        model = config.get("model")
        if not model:
            raise ValueError("Deepgram TTS requires 'model' in config")

        return cls(
            model=model,
            language_code=language_code,
            api_key=settings.DEEPGRAM_API_KEY,
        )

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


    async def generate_preview(
        self,
        text: str = "Hello, this is a preview of how I sound.",
    ) -> bytes:
        """
        Generate a preview audio for the given text using native Deepgram SDK.

        Uses the same model configuration that will be used for LiveKit streaming,
        ensuring the preview sounds identical to production.

        Args:
            text: The text to generate a preview for

        Returns:
            Preview audio as MP3 bytes (for browser compatibility)
        """
        import io
        from pydub import AudioSegment

        logger.info(f"Generating Deepgram preview with model='{self._model}'")

        try:
            # Use native Deepgram SDK (same as validate_voice)
            client = DeepgramClient(api_key=self._api_key)

            # Generate audio - returns linear16 PCM
            audio_stream = client.speak.v1.audio.generate(
                text=text,
                model=self._model,
                encoding="linear16",
                sample_rate=24000,  # Match tts_instance sample_rate
            )

            # Collect PCM bytes from generator
            pcm_bytes = b"".join(chunk for chunk in audio_stream)

            if not pcm_bytes:
                raise ValueError("Deepgram returned empty audio")

            logger.debug(f"Generated {len(pcm_bytes)} bytes of PCM audio")

            # Convert PCM (linear16) to MP3 for browser compatibility
            audio = AudioSegment.from_raw(
                io.BytesIO(pcm_bytes),
                sample_width=2,      # 16-bit = 2 bytes
                frame_rate=24000,
                channels=1,          # mono
            )

            mp3_buffer = io.BytesIO()
            audio.export(mp3_buffer, format="mp3", bitrate="128k")
            mp3_bytes = mp3_buffer.getvalue()

            logger.info(
                f"Deepgram preview generated: {len(pcm_bytes)} PCM bytes -> "
                f"{len(mp3_bytes)} MP3 bytes"
            )

            return mp3_bytes

        except DeepgramApiError as api_err:
            logger.error(f"Deepgram preview failed | API error: {api_err}")
            raise
        except Exception as e:
            logger.exception(f"Deepgram preview generation error: {e}")
            raise