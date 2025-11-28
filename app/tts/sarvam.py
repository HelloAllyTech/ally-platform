"""Sarvam TTS provider implementation."""
from typing import Optional
from livekit.plugins import sarvam
from app.core.config import settings
from app.core.scenario.base import VoiceConfig
from app.core.language_config import DEFAULT_LANGUAGE_CODE
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


def create_sarvam_tts(
    config: VoiceConfig,
    language_code: Optional[str] = None,
) -> sarvam.TTS:
    """
    Create Sarvam TTS instance.
    
    Args:
        config: Voice configuration containing speaker and model
        language_code: Optional BCP 47 language code (defaults to "en-IN")
    
    Returns:
        Sarvam TTS instance
    """
    if not config.speaker:
        raise ValueError("Sarvam TTS requires 'speaker' in config")
    if not config.model:
        raise ValueError("Sarvam TTS requires 'model' in config")
    
    # Convert language code to Sarvam format
    target_language = _convert_language_code(language_code)
    
    # Validate configuration
    if not validate_sarvam_voice(model=config.model, speaker=config.speaker):
        raise ValueError(f"Invalid Sarvam configuration: model={config.model}, speaker={config.speaker}")
    
    return sarvam.TTS(
        target_language_code=target_language,
        speaker=config.speaker,
        api_key=settings.SARVAM_API_KEY,
    )

