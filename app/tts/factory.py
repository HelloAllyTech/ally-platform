"""TTS provider factory for creating TTS clients based on configuration."""

import re
from enum import Enum
from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, TTSProvider
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

logger = get_logger(__name__)

# Each job process only ever needs ONE TTS provider per session, so the concrete
# provider classes are imported lazily inside create_tts_client()/
# _get_default_tts_client() below (see settings.LAZY_PROVIDER_IMPORTS_ENABLED)
# instead of here at module load — that keeps the other providers' SDKs out of
# every worker's baseline memory. When the flag is disabled, import all of them
# eagerly here to restore the old behavior exactly.
if not settings.LAZY_PROVIDER_IMPORTS_ENABLED:
    from app.tts.cartesia import CartesiaTTSClient  # noqa: F401
    from app.tts.deepgram import DeepgramTTSClient  # noqa: F401
    from app.tts.elevenlabs import ElevenLabsTTSClient  # noqa: F401
    from app.tts.google import GoogleTTSClient  # noqa: F401
    from app.tts.hume import HumeTTSClient  # noqa: F401
    from app.tts.sarvam import SarvamTTSClient  # noqa: F401
    from app.tts.smallestai import SmallestAITTSClient  # noqa: F401


class Gender(str, Enum):
    """Enumeration for gender types."""

    MALE = "male"
    FEMALE = "female"
    NON_BINARY = "non-binary"


# A Google voice id looks like ``en-IN-Chirp3-HD-Kore``: language tag first.
# Anything else in DEFAULT_*_VOICE_MODEL (a leftover Deepgram ``aura-…`` id) is
# ignored rather than sent to Google, which would reject it.
_GOOGLE_VOICE_NAME_RE = re.compile(r"^[a-z]{2,3}-[A-Z]{2}-")

# Google only knows male / female / neutral; a non-binary persona gets neutral.
_GOOGLE_GENDER = {
    Gender.MALE: "male",
    Gender.FEMALE: "female",
    Gender.NON_BINARY: "neutral",
}


def _default_google_voice_name(gender: Gender) -> Optional[str]:
    if gender == Gender.MALE:
        configured = getattr(settings, "DEFAULT_MALE_VOICE_MODEL", None)
    elif gender == Gender.FEMALE:
        configured = getattr(settings, "DEFAULT_FEMALE_VOICE_MODEL", None)
    else:
        configured = getattr(settings, "DEFAULT_NON_BINARY_VOICE_MODEL", None)
    if isinstance(configured, str) and _GOOGLE_VOICE_NAME_RE.match(configured.strip()):
        return configured.strip()
    if configured:
        logger.warning(
            f"DEFAULT_*_VOICE_MODEL '{configured}' is not a Google voice id; "
            "letting Google pick a voice for the session language instead"
        )
    return None


def _get_default_tts_client(
    gender: Gender, language_code: str = DEFAULT_LANGUAGE_CODE
) -> BaseTTSClient:
    """
    Get the default Google TTS client based on gender.

    Internal helper function used by create_tts_client for fallback defaults.
    This is the voice a session gets when its configured voice cannot be
    built, so it must never depend on a vendor that can be unfunded: Deepgram
    Aura was the default until 2026-10-19, when its credits ran out.

    With no voice name Google picks a voice for ``language_code`` and
    ``gender`` (the LiveKit plugin defaults to Gemini-TTS); an explicit Google
    voice id in DEFAULT_*_VOICE_MODEL is honoured when present.

    Args:
        gender: Gender type for voice selection
        language_code: BCP 47 language code (defaults to DEFAULT_LANGUAGE_CODE)

    Returns:
        Default Google TTS client instance
    """
    try:
        from app.tts.google import GoogleTTSClient  # noqa: F811

        return GoogleTTSClient(
            language_code=language_code,
            gender=_GOOGLE_GENDER.get(gender, "neutral"),
            voice_name=_default_google_voice_name(gender),
        )
    except Exception as e:
        logger.error(f"Failed to create default Google TTS: {e}")
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
        Default TTS instance (google.TTS)

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
        # Instantiate TTS client based on provider using from_config. Import
        # only the requested provider — when LAZY_PROVIDER_IMPORTS_ENABLED is
        # False its module was already eagerly imported above, so this just
        # fetches the cached module from sys.modules instead of loading it.
        if provider == TTSProvider.DEEPGRAM:
            logger.debug("[TTS Factory] Creating Deepgram TTS client")
            from app.tts.deepgram import DeepgramTTSClient  # noqa: F811

            return DeepgramTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.ELEVENLABS:
            logger.debug(
                f"[TTS Factory] Creating ElevenLabs TTS client with config: "
                f"{config_dict}"
            )
            from app.tts.elevenlabs import ElevenLabsTTSClient  # noqa: F811

            return ElevenLabsTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.SARVAM:
            from app.tts.sarvam import SarvamTTSClient  # noqa: F811

            return SarvamTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.GOOGLE:
            from app.tts.google import GoogleTTSClient  # noqa: F811

            return GoogleTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.HUME:
            from app.tts.hume import HumeTTSClient  # noqa: F811

            return HumeTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.CARTESIA:
            from app.tts.cartesia import CartesiaTTSClient  # noqa: F811

            return CartesiaTTSClient.from_config(
                config=config_dict,
                language_code=language_code,
            )

        elif provider == TTSProvider.SMALLESTAI:
            from app.tts.smallestai import SmallestAITTSClient  # noqa: F811

            return SmallestAITTSClient.from_config(
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
