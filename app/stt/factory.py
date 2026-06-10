"""STT provider factory for creating STT clients based on configuration."""

from typing import Any, Dict, Optional

from app.core.constants import DEFAULT_LANGUAGE_CODE, DEFAULT_STT_CONFIG, STTProvider
from app.core.logger import get_logger
from app.stt.base import BaseSTTClient
from app.stt.deepgram import DeepgramSTTClient
from app.stt.elevenlabs import ElevenLabsSTTClient
from app.stt.google import GoogleSTTClient
from app.stt.sarvam import SarvamSTTClient

logger = get_logger(__name__)


def create_stt_client(
    stt_config: Optional[Dict[str, Any]] = None,
    language_code: str = DEFAULT_LANGUAGE_CODE,
) -> BaseSTTClient:
    """
    Create STT client instance from configuration.

    Args:
        stt_config: Optional STT config from metadata. If None, uses defaults.
            Expected structure: {"provider": "deepgram", "config":
            {"model": "nova-3"}}
            Also supports backward compatibility with flat structure:
            {"provider": "deepgram", "model": "nova-3"}
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
        # Create default config dict for provider to parse
        config_dict = {"model": DEFAULT_STT_CONFIG["model"]}
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

    # Map provider to class and instantiate using from_config
    provider = provider.lower()

    if provider == STTProvider.DEEPGRAM:
        return DeepgramSTTClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == STTProvider.GOOGLE:
        return GoogleSTTClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == STTProvider.SARVAM:
        return SarvamSTTClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == STTProvider.ELEVENLABS:
        return ElevenLabsSTTClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    else:
        raise ValueError(f"Unsupported STT provider: {provider}")
