"""Deepgram STT provider implementation."""
from typing import Optional
from livekit.plugins import deepgram
from app.core.config import settings
from app.stt.base import BaseSTTClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class DeepgramSTTClient(BaseSTTClient):
    """
    Deepgram STT client implementation.
    
    Uses Deepgram's speech-to-text service via LiveKit plugins.
    Deepgram requires ISO 639-1 format (e.g., "en", "hi").
    Language conversion is handled automatically via convert_language_code().
    """
    
    # Declare language format requirement
    LANGUAGE_FORMAT = "iso6391"
    
    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format, will be converted
        api_key: Optional[str] = None,
    ) -> None:
        """
        Initialize Deepgram STT client.
        
        Args:
            model: Deepgram model name (e.g., "nova-3", "nova-2")
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
                Will be converted to ISO 639-1 format automatically
            api_key: Optional Deepgram API key. If not provided, uses settings.DEEPGRAM_API_KEY
        """
        if not model:
            raise ValueError("Deepgram STT requires 'model' parameter")
        
        if not language_code:
            raise ValueError("Deepgram STT requires 'language_code' parameter")
        
        self._model = model
        
        # Convert language code to Deepgram's required format
        self._language_code = self.convert_language_code(language_code)
        
        # Use provided API key or fall back to settings
        self._api_key = api_key or settings.DEEPGRAM_API_KEY
        
        if not self._api_key:
            raise ValueError("Deepgram STT requires 'api_key' parameter or DEEPGRAM_API_KEY in settings")
        
        logger.debug(f"Creating Deepgram STT with model: {model}, language: {self._language_code} (from {language_code})")
        
        # Create the underlying STT instance
        self._stt_instance = deepgram.STT(
            model=self._model,
            language=self._language_code,
            api_key=self._api_key,
        )
    
    @property
    def stt_instance(self) -> deepgram.STT:
        """
        Get the underlying Deepgram STT instance.
        
        Returns:
            Deepgram STT instance
        """
        return self._stt_instance

