"""TTS provider management and configuration."""
from enum import Enum
from typing import Optional, Callable, Dict
from livekit.plugins import deepgram, elevenlabs, sarvam
from app.core.constants import TTSProvider
from app.core.config import settings
from app.core.scenario.base import ScenarioVoice
from app.utils.logger import get_logger
from app.utils.tts_validator import (
    validate_sarvam_voice,
    validate_deepgram_voice,
    validate_elevenlabs_voice
)

logger = get_logger(__name__)

class Gender(str, Enum):
    """Enumeration for gender types."""
    MALE = "male"
    FEMALE = "female"
    NON_BINARY = "non-binary"

TTS_VALIDATORS = {
    TTSProvider.ELEVENLABS: validate_elevenlabs_voice,
    TTSProvider.DEEPGRAM: validate_deepgram_voice,
    TTSProvider.SARVAM: validate_sarvam_voice,
}


def get_default_tts_config(gender: Gender) -> object:
    """Get default Deepgram TTS provider based on gender."""
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
        raise ValueError(f"Missing default Deepgram TTS settings for gender '{gender.value}'. "
                         f"Check your config for DEFAULT_MALE_MODEL, DEFAULT_FEMALE_MODEL, and DEFAULT_NONBINARY_MODEL.")
    except Exception as e:
        logger.error(f"Failed to create default Deepgram TTS: {e}")
        raise


def validate_tts_config(provider: str, config) -> bool:
    """Validate TTS configuration for provider."""
    try:
        if provider == TTSProvider.ELEVENLABS:
            return bool(config and config.voice_id and config.model)
        elif provider == TTSProvider.DEEPGRAM:
            return bool(config and config.model)
        elif provider == TTSProvider.SARVAM:
            return bool(config and config.speaker)
        return False
    except Exception as e:
        logger.warning(f"TTS validation failed for {provider}: {e}")
        return False


def create_provider_tts(provider: str, config):
    """Create TTS instance for specified provider with validation."""
    provider_lower = provider.lower()

    tts_configs = {
        TTSProvider.ELEVENLABS: lambda: elevenlabs.TTS(
            voice_id=config.voice_id,
            model=config.model,
            api_key=settings.ELEVEN_API_KEY,
        ),
        TTSProvider.DEEPGRAM: lambda: deepgram.TTS(
            model=config.model,
            encoding="linear16",
            sample_rate=24000,
            api_key=settings.DEEPGRAM_API_KEY,
        ),
        TTSProvider.SARVAM: lambda: sarvam.TTS(
            target_language_code="en-IN",
            speaker=config.speaker,
            api_key=settings.SARVAM_API_KEY,
        ),
    }

    factory = tts_configs.get(provider_lower)
    if not factory:
        raise ValueError(f"Unsupported TTS provider: {provider}")

    tts = factory()

    # Validate voice configuration
    validator = TTS_VALIDATORS.get(provider_lower)
    if validator:
        # Prepare validation parameters from config
        validation_params = {}
        
        # Extract all available parameters from config
        if hasattr(config, 'model') and config.model:
            validation_params['model'] = config.model
        if hasattr(config, 'voice_id') and config.voice_id:
            validation_params['voice_id'] = config.voice_id
        if hasattr(config, 'speaker') and config.speaker:
            validation_params['speaker'] = config.speaker
            
        # Validate using kwargs - the validator will check for required parameters
        if not validator(**validation_params):
            raise ValueError(f"Invalid {provider} voice configuration: {validation_params}")

    return tts


def get_tts_for_scenario(voice: Optional[ScenarioVoice], gender: Gender):
    """
    Get TTS instance for scenario voice.
    Falls back to default on error or invalid config.
    """
    if not voice:
        return get_default_tts_config(gender)

    provider = voice.provider.lower()

    if not validate_tts_config(provider, voice.config):
        logger.warning(f"Invalid {provider} config, using default")
        return get_default_tts_config(gender)

    try:
        return create_provider_tts(provider, voice.config)
    except Exception as e:
        logger.warning(f"Failed to create {provider} TTS: {e}")
        return get_default_tts_config(gender)