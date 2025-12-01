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
from app.tts.google import GoogleTTSClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class Gender(str, Enum):
    """Enumeration for gender types."""
    MALE = "male"
    FEMALE = "female"
    NON_BINARY = "non-binary"


def get_default_tts_config(gender: Gender, language_code: Optional[str] = None) -> deepgram.TTS:
    """
    Get default Deepgram TTS provider based on gender.
    
    Directly instantiates DeepgramTTSClient with gender-specific model.
    
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

        # Direct instantiation
        tts_client = DeepgramTTSClient(
            model=model,
            language_code=lang_code,
            api_key=settings.DEEPGRAM_API_KEY,
        )
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
    
    Directly instantiates TTS clients from voice.config (metadata).
    
    Args:
        voice: Optional scenario voice configuration from metadata
        gender: Gender type for fallback default voice
        language_code: Optional BCP 47 language code (e.g., "en-IN", "hi-IN")
            Used by providers that require language parameter (e.g., Sarvam, Google)
    
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
    elif provider == TTSProvider.GOOGLE:
        # Google requires language_code (which we have), but voice_name and gender are optional
        # Google doesn't use "model" field - it uses voice_name instead
        # No strict validation needed, will try to create and fall back on error
        pass

    try:
        # Direct instantiation from voice.config
        if provider == TTSProvider.DEEPGRAM:
            tts_client = DeepgramTTSClient(
                model=voice.config.model,
                language_code=lang_code,
                api_key=settings.DEEPGRAM_API_KEY,
            )
            return tts_client.tts_instance
        
        elif provider == TTSProvider.ELEVENLABS:
            tts_client = ElevenLabsTTSClient(
                model=voice.config.model,
                voice_id=voice.config.voice_id,
                language_code=lang_code,
                api_key=settings.ELEVEN_API_KEY,
            )
            return tts_client.tts_instance
        
        elif provider == TTSProvider.SARVAM:
            tts_client = SarvamTTSClient(
                model=voice.config.model,
                speaker=voice.config.speaker,
                language_code=lang_code,
                api_key=settings.SARVAM_API_KEY,
            )
            return tts_client.tts_instance
        
        elif provider == TTSProvider.GOOGLE:
            tts_client = GoogleTTSClient(
                language_code=lang_code,
                gender=voice.config.gender,  # Optional
                voice_name=voice.config.voice_name,  # Optional
                voice_cloning_key=voice.config.voice_cloning_key,  # Optional
                credentials_file=getattr(settings, 'GOOGLE_APPLICATION_CREDENTIALS', None),  # Optional
            )
            return tts_client.tts_instance
        
        else:
            logger.warning(f"Unsupported provider: {provider}, using default")
            return get_default_tts_config(gender, language_code)
            
    except Exception as e:
        logger.warning(f"Failed to create {provider} TTS: {e}")
        return get_default_tts_config(gender, language_code)

