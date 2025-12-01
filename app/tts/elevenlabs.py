"""ElevenLabs TTS provider implementation."""
from typing import Optional
from livekit.plugins import elevenlabs
from app.core.config import settings
from app.core.scenario.base import VoiceConfig
from app.tts.base import BaseTTSClient
from app.utils.logger import get_logger
from app.utils.tts_validator import validate_elevenlabs_voice

logger = get_logger(__name__)


class ElevenLabsTTSClient(BaseTTSClient):
    """
    ElevenLabs TTS client implementation.
    """
    
    def __init__(
        self,
        model: str,
        voice_id: str,
        language_code: str,
        api_key: Optional[str] = None,
    ):
        """
        Initialize ElevenLabs TTS client.
        
        Args:
            model: ElevenLabs model name
            voice_id: ElevenLabs voice ID
            language_code: BCP 47 language code (not used by ElevenLabs, but kept for consistency)
            api_key: Optional API key (defaults to settings.ELEVEN_API_KEY)
        """
        if not voice_id:
            raise ValueError("ElevenLabs TTS requires 'voice_id'")
        if not model:
            raise ValueError("ElevenLabs TTS requires 'model'")
        
        # Validate configuration
        if not validate_elevenlabs_voice(voice_id=voice_id):
            raise ValueError(f"Invalid ElevenLabs voice_id: {voice_id}")
        
        self._model = model
        self._voice_id = voice_id
        self._language_code = language_code
        self._api_key = api_key or settings.ELEVEN_API_KEY
        self._tts_instance = None
    
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

