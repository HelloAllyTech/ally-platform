"""Deepgram TTS provider implementation."""

import asyncio
from typing import Any, AsyncIterator, Dict, Optional

from deepgram import DeepgramClient
from deepgram.core import ApiError as DeepgramApiError
from livekit.plugins import deepgram

from app.core.config import settings
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

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
        super().__init__()
        if not model:
            raise ValueError("Deepgram TTS requires 'model'")

        self._model = model
        self._language_code = language_code
        self._api_key = api_key or settings.DEEPGRAM_API_KEY
        self._tts_instance = None

    def allows_clip_synthesis(self) -> bool:
        """Aura voices are fixed speakers: a clip is the same voice."""
        return True

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
            self._wrap_stream_with_timeout(self._tts_instance)
        return self._tts_instance

    async def synthesize(self, text: str) -> AsyncIterator[bytes]:
        """
        Synthesize text using Deepgram TTS with a timeout.

        Args:
            text: Text to synthesize

        Yields:
            Audio chunks as bytes
        """
        agen = self.tts_instance.synthesize(text)
        try:
            while True:
                yield await asyncio.wait_for(agen.__anext__(), timeout=30.0)
        except StopAsyncIteration:
            pass
        except asyncio.TimeoutError:
            logger.warning("Deepgram TTS synthesis timed out")
            raise
