"""Sarvam TTS provider implementation."""
from typing import Optional
from livekit.plugins import sarvam
from app.core.config import settings
from app.core.scenario.base import VoiceConfig
from app.core.language import DEFAULT_LANGUAGE_CODE
from app.tts.base import BaseTTSClient
from app.utils.logger import get_logger
from app.utils.tts_validator import validate_sarvam_voice

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
    """
    
    def __init__(
        self,
        model: str,
        speaker: str,
        language_code: str,
        api_key: Optional[str] = None,
    ):
        """
        Initialize Sarvam TTS client.
        
        Args:
            model: Sarvam model name (e.g., "multilingual-meera")
            speaker: Sarvam speaker name (e.g., "meera", "arjun")
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
            api_key: Optional API key (defaults to settings.SARVAM_API_KEY)
        """
        if not speaker:
            raise ValueError("Sarvam TTS requires 'speaker'")
        if not model:
            raise ValueError("Sarvam TTS requires 'model'")
        
        # Convert language code to Sarvam format
        target_language = _convert_language_code(language_code)
        
        # Validate configuration
        if not validate_sarvam_voice(model=model, speaker=speaker):
            raise ValueError(f"Invalid Sarvam configuration: model={model}, speaker={speaker}")
        
        self._model = model
        self._speaker = speaker
        self._language_code = language_code
        self._target_language = target_language
        self._api_key = api_key or settings.SARVAM_API_KEY
        self._tts_instance = None
    
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

