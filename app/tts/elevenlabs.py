"""ElevenLabs TTS provider implementation."""
from typing import Optional
from livekit.plugins import elevenlabs
from app.core.config import settings
from app.core.scenario.base import VoiceConfig
from app.utils.logger import get_logger
from app.utils.tts_validator import validate_elevenlabs_voice

logger = get_logger(__name__)


def create_elevenlabs_tts(
    config: VoiceConfig,
    language_code: Optional[str] = None,
) -> elevenlabs.TTS:
    """
    Create ElevenLabs TTS instance.
    
    Args:
        config: Voice configuration containing voice_id and model
        language_code: Optional BCP 47 language code (not used by ElevenLabs TTS)
    
    Returns:
        ElevenLabs TTS instance
    """
    if not config.voice_id:
        raise ValueError("ElevenLabs TTS requires 'voice_id' in config")
    if not config.model:
        raise ValueError("ElevenLabs TTS requires 'model' in config")
    
    # Validate configuration
    if not validate_elevenlabs_voice(voice_id=config.voice_id):
        raise ValueError(f"Invalid ElevenLabs voice_id: {config.voice_id}")
    
    return elevenlabs.TTS(
        voice_id=config.voice_id,
        model=config.model,
        api_key=settings.ELEVEN_API_KEY,
    )

