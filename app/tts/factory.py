"""TTS provider factory for creating TTS clients based on configuration."""
from enum import Enum
from typing import Optional, Dict, Any
from livekit.plugins import deepgram
from app.core.constants import TTSProvider
from app.core.config import settings
from app.core.language.factory import resolve_config
from app.core.language import DEFAULT_LANGUAGE_CODE
from app.core.scenario.base import ScenarioVoice
from app.tts.base import BaseTTSClient
from app.tts.deepgram import DeepgramTTSClient
from app.tts.elevenlabs import ElevenLabsTTSClient
from app.tts.sarvam import SarvamTTSClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class Gender(str, Enum):
    """Enumeration for gender types."""
    MALE = "male"
    FEMALE = "female"
    NON_BINARY = "non-binary"


def create_tts_client(
    language_code: str,
    override_config: Optional[Dict[str, Any]] = None,
) -> BaseTTSClient:
    """
    Create TTS client instance from configuration.
    
    This function uses resolve_config to resolve configuration and then
    instantiates the appropriate provider class.
    
    Configuration includes:
    - language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
    - override_config: Optional provider/model/config overrides
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        override_config: Optional override configuration dict with:
            - provider: TTS provider name (e.g., "deepgram", "elevenlabs", "sarvam")
            - model: Model name (e.g., "nova-2", "multilingual-meera")
            - voice_id: Voice ID for ElevenLabs (optional)
            - speaker: Speaker for Sarvam (optional)
            - config: Additional provider-specific config dict (e.g., {"api_key": "..."})
    
    Returns:
        TTS client instance
    
    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Resolve configuration from registry
    config = resolve_config("tts", language_code, override_config)
    
    # Map provider to class and instantiate
    provider = config["provider"].lower()
    
    # Extract provider-specific parameters from override_config
    voice_id = None
    speaker = None
    if override_config:
        voice_id = override_config.get("voice_id")
        speaker = override_config.get("speaker")
        # Also check in nested config
        nested_config = override_config.get("config", {})
        if not voice_id:
            voice_id = nested_config.get("voice_id")
        if not speaker:
            speaker = nested_config.get("speaker")
    
    api_key = config.get("api_key")
    
    if provider == TTSProvider.DEEPGRAM:
        return DeepgramTTSClient(
            model=config["model"],
            language_code=config["language_code"],  # BCP 47
            api_key=api_key,
        )
    elif provider == TTSProvider.ELEVENLABS:
        if not voice_id:
            raise ValueError("ElevenLabs TTS requires 'voice_id' in override_config")
        return ElevenLabsTTSClient(
            model=config["model"],
            voice_id=voice_id,
            language_code=config["language_code"],  # BCP 47
            api_key=api_key,
        )
    elif provider == TTSProvider.SARVAM:
        if not speaker:
            raise ValueError("Sarvam TTS requires 'speaker' in override_config")
        return SarvamTTSClient(
            model=config["model"],
            speaker=speaker,
            language_code=config["language_code"],  # BCP 47
            api_key=api_key,
        )
    else:
        raise ValueError(f"Unsupported TTS provider: {provider}")


def get_default_tts_config(gender: Gender, language_code: Optional[str] = None) -> deepgram.TTS:
    """
    Get default Deepgram TTS provider based on gender.
    
    Uses the factory pattern with gender-specific model override.
    
    Args:
        gender: Gender type for voice selection
        language_code: Optional BCP 47 language code (defaults to DEFAULT_LANGUAGE_CODE)
    
    Returns:
        Default Deepgram TTS instance
    """
    lang_code = language_code or DEFAULT_LANGUAGE_CODE
    
    try:
        if gender == Gender.MALE:
            model = settings.DEFAULT_MALE_VOICE_MODEL
        elif gender == Gender.FEMALE:
            model = settings.DEFAULT_FEMALE_VOICE_MODEL
        else:
            model = settings.DEFAULT_NON_BINARY_VOICE_MODEL

        # Use factory with gender-specific model override
        override_config = {
            "provider": TTSProvider.DEEPGRAM,
            "model": model,
        }
        
        tts_client = create_tts_client(lang_code, override_config)
        return tts_client.tts_instance
    except AttributeError as e:
        logger.error(f"Missing gender-specific default Deepgram setting: {e}")
        raise ValueError(
            f"Missing default Deepgram TTS settings for gender '{gender.value}'. "
            f"Check your config for DEFAULT_MALE_VOICE_MODEL, DEFAULT_FEMALE_VOICE_MODEL, and DEFAULT_NON_BINARY_VOICE_MODEL."
        )
    except Exception as e:
        logger.error(f"Failed to create default Deepgram TTS: {e}")
        raise


def get_tts_for_scenario(
    voice: Optional[ScenarioVoice],
    gender: Gender,
    language_code: Optional[str] = None,
):
    """
    Get TTS instance for scenario voice.
    Falls back to default on error or invalid config.
    
    Uses the factory pattern to create TTS clients based on language configuration.
    
    Args:
        voice: Optional scenario voice configuration
        gender: Gender type for fallback default voice
        language_code: Optional BCP 47 language code (e.g., "en-IN", "hi-IN")
            Used by providers that require language parameter (e.g., Sarvam)
    
    Returns:
        TTS instance for the scenario
    """
    if not voice:
        return get_default_tts_config(gender, language_code)

    provider = voice.provider.lower()
    lang_code = language_code or DEFAULT_LANGUAGE_CODE

    # Validate required fields
    if not voice.config:
        logger.warning(f"Missing voice config, using default")
        return get_default_tts_config(gender, language_code)
    
    if provider == TTSProvider.ELEVENLABS and not (voice.config.voice_id and voice.config.model):
        logger.warning(f"Invalid {provider} config (missing voice_id or model), using default")
        return get_default_tts_config(gender, language_code)
    elif provider == TTSProvider.DEEPGRAM and not voice.config.model:
        logger.warning(f"Invalid {provider} config (missing model), using default")
        return get_default_tts_config(gender, language_code)
    elif provider == TTSProvider.SARVAM and not (voice.config.speaker and voice.config.model):
        logger.warning(f"Invalid {provider} config (missing speaker or model), using default")
        return get_default_tts_config(gender, language_code)

    try:
        # Build override config for factory
        override_config = {
            "provider": provider,
            "model": voice.config.model,
        }
        
        # Add provider-specific fields
        if voice.config.voice_id:
            override_config["voice_id"] = voice.config.voice_id
        if voice.config.speaker:
            override_config["speaker"] = voice.config.speaker
        
        tts_client = create_tts_client(lang_code, override_config)
        return tts_client.tts_instance
    except Exception as e:
        logger.warning(f"Failed to create {provider} TTS: {e}")
        return get_default_tts_config(gender, language_code)

