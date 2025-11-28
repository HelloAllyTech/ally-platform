"""Deepgram TTS provider implementation."""
from typing import Optional
from livekit.plugins import deepgram
from app.core.config import settings
from app.core.scenario.base import VoiceConfig
from app.utils.logger import get_logger
from app.utils.tts_validator import validate_deepgram_voice

logger = get_logger(__name__)


def create_deepgram_tts(
    config: VoiceConfig,
    language_code: Optional[str] = None,
) -> deepgram.TTS:
    """
    Create Deepgram TTS instance.
    
    Args:
        config: Voice configuration containing model
        language_code: Optional BCP 47 language code (not used by Deepgram TTS)
    
    Returns:
        Deepgram TTS instance
    """
    if not config.model:
        raise ValueError("Deepgram TTS requires 'model' in config")
    
    # Validate configuration
    if not validate_deepgram_voice(model=config.model):
        raise ValueError(f"Invalid Deepgram model: {config.model}")
    
    return deepgram.TTS(
        model=config.model,
        encoding="linear16",
        sample_rate=24000,
        api_key=settings.DEEPGRAM_API_KEY,
    )

