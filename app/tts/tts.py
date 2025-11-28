"""TTS provider management and configuration."""
from enum import Enum
from typing import Optional
from livekit.plugins import deepgram
from app.core.constants import TTSProvider
from app.core.config import settings
from app.core.scenario.base import ScenarioVoice
from app.utils.logger import get_logger
from app.tts.deepgram import create_deepgram_tts
from app.tts.elevenlabs import create_elevenlabs_tts
from app.tts.sarvam import create_sarvam_tts

logger = get_logger(__name__)


class Gender(str, Enum):
    """Enumeration for gender types."""
    MALE = "male"
    FEMALE = "female"
    NON_BINARY = "non-binary"


def get_default_tts_config(gender: Gender) -> deepgram.TTS:
    """
    Get default Deepgram TTS provider based on gender.
    
    Args:
        gender: Gender type for voice selection
    
    Returns:
        Default Deepgram TTS instance
    """
    try:
        if gender == Gender.MALE:
            model = settings.DEFAULT_MALE_VOICE_MODEL
        elif gender == Gender.FEMALE:
            model = settings.DEFAULT_FEMALE_VOICE_MODEL
        else:
            model = settings.DEFAULT_NON_BINARY_VOICE_MODEL

        return deepgram.TTS(
            model=model,
            encoding="linear16",
            sample_rate=24000,
            api_key=settings.DEEPGRAM_API_KEY,
        )
    except AttributeError as e:
        logger.error(f"Missing gender-specific default Deepgram setting: {e}")
        raise ValueError(
            f"Missing default Deepgram TTS settings for gender '{gender.value}'. "
            f"Check your config for DEFAULT_MALE_MODEL, DEFAULT_FEMALE_MODEL, and DEFAULT_NONBINARY_MODEL."
        )
    except Exception as e:
        logger.error(f"Failed to create default Deepgram TTS: {e}")
        raise


def _validate_tts_config(provider: str, config) -> bool:
    """
    Validate TTS configuration for provider.
    
    Args:
        provider: TTS provider name
        config: Voice configuration object
    
    Returns:
        True if configuration is valid, False otherwise
    """
    try:
        if provider == TTSProvider.ELEVENLABS:
            return bool(config and config.voice_id and config.model)
        elif provider == TTSProvider.DEEPGRAM:
            return bool(config and config.model)
        elif provider == TTSProvider.SARVAM:
            return bool(config and config.speaker and config.model)
        return False
    except Exception as e:
        logger.warning(f"TTS validation failed for {provider}: {e}")
        return False


def _create_provider_tts(
    provider: str,
    config,
    language_code: Optional[str] = None,
):
    """
    Create TTS instance for specified provider.
    
    Args:
        provider: TTS provider name
        config: Voice configuration object
        language_code: Optional BCP 47 language code for providers that need it
    
    Returns:
        TTS instance for the specified provider
    
    Raises:
        ValueError: If provider is unsupported or configuration is invalid
    """
    provider_lower = provider.lower()
    
    if provider_lower == TTSProvider.ELEVENLABS:
        return create_elevenlabs_tts(config, language_code)
    elif provider_lower == TTSProvider.DEEPGRAM:
        return create_deepgram_tts(config, language_code)
    elif provider_lower == TTSProvider.SARVAM:
        return create_sarvam_tts(config, language_code)
    else:
        raise ValueError(f"Unsupported TTS provider: {provider}")


def get_tts_for_scenario(
    voice: Optional[ScenarioVoice],
    gender: Gender,
    language_code: Optional[str] = None,
):
    """
    Get TTS instance for scenario voice.
    Falls back to default on error or invalid config.
    
    Args:
        voice: Optional scenario voice configuration
        gender: Gender type for fallback default voice
        language_code: Optional BCP 47 language code (e.g., "en-IN", "hi-IN")
            Used by providers that require language parameter (e.g., Sarvam)
    
    Returns:
        TTS instance for the scenario
    """
    if not voice:
        return get_default_tts_config(gender)

    provider = voice.provider.lower()

    if not _validate_tts_config(provider, voice.config):
        logger.warning(f"Invalid {provider} config, using default")
        return get_default_tts_config(gender)

    try:
        return _create_provider_tts(provider, voice.config, language_code)
    except Exception as e:
        logger.warning(f"Failed to create {provider} TTS: {e}")
        return get_default_tts_config(gender)

