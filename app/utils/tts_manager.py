"""TTS provider management and configuration."""
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

TTS_FACTORY: Dict[str, Callable] = {
    TTSProvider.ELEVENLABS: lambda: elevenlabs.TTS(
        voice_id=settings.VOICE_ID,
        model="eleven_multilingual_v2",
        api_key=settings.ELEVEN_API_KEY,
    ),
    TTSProvider.DEEPGRAM: lambda: deepgram.TTS(
        model=settings.MODEL,
        encoding="linear16",
        sample_rate=24000,
        api_key=settings.DEEPGRAM_API_KEY,
    ),
    TTSProvider.SARVAM: lambda: sarvam.TTS(
        target_language_code="en-IN",
        speaker=settings.SPEAKER,
        api_key=settings.SARVAM_API_KEY,
    ),
}

TTS_VALIDATORS = {
    TTSProvider.ELEVENLABS: validate_elevenlabs_voice,
    TTSProvider.DEEPGRAM: validate_deepgram_voice,
    TTSProvider.SARVAM: validate_sarvam_voice,
}


def get_default_tts_config() -> object:
    """Get default TTS provider from environment settings."""
    factory = TTS_FACTORY.get(settings.TTS_PROVIDER)
    if not factory:
        raise ValueError(f"Unsupported TTS provider: {settings.TTS_PROVIDER}")
    return factory()


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
        voice_param = getattr(config, 'voice_id', None) or getattr(config, 'model', None) or getattr(config, 'speaker',
                                                                                                     None)
        if not validator(voice_param):
            raise ValueError(f"Invalid {provider} voice configuration")

    return tts


def get_tts_for_scenario(voice: Optional[ScenarioVoice]):
    """
    Get TTS instance for scenario voice.
    Falls back to default on error or invalid config.
    """
    if not voice:
        return get_default_tts_config()

    provider = voice.provider.lower()

    if not validate_tts_config(provider, voice.config):
        logger.warning(f"Invalid {provider} config, using default")
        return get_default_tts_config()

    try:
        return create_provider_tts(provider, voice.config)
    except Exception as e:
        logger.warning(f"Failed to create {provider} TTS: {e}")
        return get_default_tts_config()