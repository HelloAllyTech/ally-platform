"""TTS provider factory for creating TTS clients based on configuration."""

from enum import Enum
from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, TTSProvider
from app.tts.base import BaseTTSClient
from app.tts.deepgram import DeepgramTTSClient
from app.tts.elevenlabs import ElevenLabsTTSClient
from app.tts.google import GoogleTTSClient
from app.tts.hume import HumeTTSClient
from app.tts.sarvam import SarvamTTSClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class Gender(str, Enum):
    """Enumeration for gender types."""

    MALE = "male"
    FEMALE = "female"
    NON_BINARY = "non-binary"


def _get_default_tts_client(
    gender: Gender, language_code: str = DEFAULT_LANGUAGE_CODE
) -> BaseTTSClient:
    """
    Get default Deepgram TTS client based on gender.

    Internal helper function used by create_tts_client for fallback defaults.

    Args:
        gender: Gender type for voice selection
        language_code: BCP 47 language code (defaults to DEFAULT_LANGUAGE_CODE)

    Returns:
        Default Deepgram TTS client instance
    """
    try:
        if gender == Gender.MALE:
            model = settings.DEFAULT_MALE_VOICE_MODEL
        elif gender == Gender.FEMALE:
            model = settings.DEFAULT_FEMALE_VOICE_MODEL
        else:
            model = settings.DEFAULT_NON_BINARY_VOICE_MODEL

        return DeepgramTTSClient(
            model=model,
            language_code=language_code,
            api_key=settings.DEEPGRAM_API_KEY,
        )
    except AttributeError as e:
        logger.error(f"Missing gender-specific default Deepgram setting: {e}")
        raise ValueError(
            f"Missing default Deepgram TTS settings for gender "
            f"'{gender.value}'. Check your config for "
            f"DEFAULT_MALE_VOICE_MODEL, DEFAULT_FEMALE_VOICE_MODEL, and "
            f"DEFAULT_NON_BINARY_VOICE_MODEL."
        )
    except Exception as e:
        logger.error(f"Failed to create default Deepgram TTS: {e}")
        raise


def get_default_tts_config(gender: Gender, language_code: Optional[str] = None):
    """
    Get default TTS instance based on gender.

    Convenience function that returns the TTS instance directly
    (for backward compatibility).
    This is a wrapper around create_tts_client that returns the underlying TTS instance.

    Args:
        gender: Gender type for voice selection
        language_code: Optional BCP 47 language code (defaults to DEFAULT_LANGUAGE_CODE)

    Returns:
        Default TTS instance (e.g., deepgram.TTS)

    Note:
        For new code, prefer using create_tts_client() which returns
        BaseTTSClient wrapper.
        This function is maintained for backward compatibility.
    """
    lang_code = language_code or DEFAULT_LANGUAGE_CODE
    tts_client = create_tts_client(language_code=lang_code, gender=gender)
    return tts_client.tts_instance


def create_tts_client(
    tts_config: Optional[Dict[str, Any]] = None,
    language_code: str = DEFAULT_LANGUAGE_CODE,
    gender: Optional[Gender] = None,
) -> BaseTTSClient:
    """
    Create TTS client instance from configuration.

    Args:
        tts_config: Optional TTS config from metadata. If None, uses defaults.
            Expected structure: {"provider": "sarvam", "name": "...", "config": {...}}
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        gender: Optional gender for fallback defaults (required if tts_config is None)

    Returns:
        TTS client instance

        Raises:
        ValueError: If provider is unsupported, required parameters are
        missing, or gender is missing when using defaults
    """
    # Use provided config or fallback to defaults
    if tts_config is None:
        if gender is None:
            raise ValueError("gender is required when tts_config is not provided")
        logger.debug("No TTS config provided, using defaults")
        return _get_default_tts_client(gender, language_code)

    provider = tts_config.get("provider", "").lower()
    if not provider:
        if gender is None:
            raise ValueError("gender is required when tts_config.provider is missing")
        logger.warning("Missing provider in TTS config, using defaults")
        return _get_default_tts_client(gender, language_code)

    config_dict = tts_config.get("config", {}) or {}
    logger.debug(
        f"[TTS Factory] Creating TTS client: provider={provider}, "
        f"language_code={language_code}"
    )
    logger.debug(f"[TTS Factory] Config dict: {config_dict}")

    try:
        # Instantiate TTS client based on provider using from_config
        if provider == TTSProvider.DEEPGRAM:
            logger.debug("[TTS Factory] Creating Deepgram TTS client")
            return DeepgramTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.ELEVENLABS:
            logger.debug(
                f"[TTS Factory] Creating ElevenLabs TTS client with config: "
                f"{config_dict}"
            )
            return ElevenLabsTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.SARVAM:
            return SarvamTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.GOOGLE:
            return GoogleTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.HUME:
            return HumeTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        else:
            logger.warning(f"Unsupported provider: {provider}, using default")
            if gender is None:
                raise ValueError(
                    f"Unsupported TTS provider: {provider} and gender is "
                    f"required for fallback"
                )
            return _get_default_tts_client(gender, language_code)

    except Exception as e:
        logger.warning(f"Failed to create {provider} TTS: {e}")
        if gender is None:
            raise ValueError(
                f"Failed to create TTS client and gender is required for fallback: {e}"
            )
        return _get_default_tts_client(gender, language_code)
