"""STT provider factory for creating STT clients based on configuration."""

from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, DEFAULT_STT_CONFIG, STTProvider
from app.core.logger import get_logger
from app.stt.base import BaseSTTClient

logger = get_logger(__name__)

# Each job process only ever needs ONE STT provider per session, so the concrete
# provider classes are imported lazily inside create_stt_client() below (see
# settings.LAZY_PROVIDER_IMPORTS_ENABLED) instead of here at module load — that
# keeps the other providers' SDKs out of every worker's baseline memory. When
# the flag is disabled, import all of them eagerly here to restore the old
# behavior exactly.
if not settings.LAZY_PROVIDER_IMPORTS_ENABLED:
    from app.stt.deepgram import DeepgramSTTClient  # noqa: F401
    from app.stt.elevenlabs import ElevenLabsSTTClient  # noqa: F401
    from app.stt.google import GoogleSTTClient  # noqa: F401
    from app.stt.sarvam import SarvamSTTClient  # noqa: F401


def _default_config_dict() -> Dict[str, Any]:
    """The platform default STT config minus its provider key."""
    return {k: v for k, v in DEFAULT_STT_CONFIG.items() if k != "provider"}


def create_stt_client(
    stt_config: Optional[Dict[str, Any]] = None,
    language_code: str = DEFAULT_LANGUAGE_CODE,
) -> BaseSTTClient:
    """
    Create STT client instance from configuration.

    Args:
        stt_config: Optional STT config from metadata. If None, uses defaults.
            Expected structure: {"provider": "google", "config":
            {"model": "chirp_2", "location": "asia-southeast1"}}
            Also supports backward compatibility with flat structure:
            {"provider": "google", "model": "chirp_2"}
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

    Returns:
        STT client instance

    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Use provided config or fallback to defaults
    if stt_config is None:
        logger.debug("No STT config provided, using defaults")
        provider = DEFAULT_STT_CONFIG["provider"]
        # Everything but the provider key is the provider's own config
        # (model, and for Google the region the model is served from).
        config_dict = _default_config_dict()
    else:
        provider = stt_config.get("provider", DEFAULT_STT_CONFIG["provider"])
        # Support both nested config structure and backward-compatible flat structure
        config_dict = stt_config.get("config", {})
        if not config_dict:
            # Backward compatibility: flat structure (model at top level)
            # Convert to nested structure for provider
            config_dict = {
                "model": stt_config.get("model", DEFAULT_STT_CONFIG["model"]),
            }
        else:
            # Ensure model has a default if missing
            if "model" not in config_dict:
                config_dict["model"] = DEFAULT_STT_CONFIG["model"]
    # A missing model falls back to the platform default's model, which only
    # makes sense on the platform default's provider: Google must also get the
    # region that model is served from, or chirp_2 is requested from "global"
    # and the session starts transcribing nothing.
    if (
        provider.lower() == DEFAULT_STT_CONFIG["provider"]
        and config_dict.get("model") == DEFAULT_STT_CONFIG["model"]
        and "location" not in config_dict
        and "location" in DEFAULT_STT_CONFIG
    ):
        config_dict["location"] = DEFAULT_STT_CONFIG["location"]

    # Map provider to class and instantiate using from_config
    provider = provider.lower()

    # Import only the requested provider. When LAZY_PROVIDER_IMPORTS_ENABLED is
    # False, its module was already eagerly imported above, so this just fetches
    # the cached module from sys.modules instead of actually loading anything.
    if provider == STTProvider.DEEPGRAM:
        from app.stt.deepgram import DeepgramSTTClient  # noqa: F811

        return DeepgramSTTClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == STTProvider.GOOGLE:
        from app.stt.google import GoogleSTTClient  # noqa: F811

        return GoogleSTTClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == STTProvider.SARVAM:
        from app.stt.sarvam import SarvamSTTClient  # noqa: F811

        return SarvamSTTClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == STTProvider.ELEVENLABS:
        from app.stt.elevenlabs import ElevenLabsSTTClient  # noqa: F811

        return ElevenLabsSTTClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    else:
        raise ValueError(f"Unsupported STT provider: {provider}")
