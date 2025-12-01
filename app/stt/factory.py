"""STT provider factory for creating STT clients based on configuration."""
from typing import Optional, Dict, Any
from app.core.constants import STTProvider
from app.core.language.factory import resolve_config
from app.stt.base import BaseSTTClient
from app.stt.deepgram import DeepgramSTTClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


def create_stt_client(
    language_code: str,
    override_config: Optional[Dict[str, Any]] = None,
) -> BaseSTTClient:
    """
    Create STT client instance from configuration.
    
    This function uses resolve_config to resolve configuration and then
    instantiates the appropriate provider class. Providers handle their own
    language code format conversion.
    
    Configuration includes:
    - language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
    - override_config: Optional provider/model/config overrides
    
    Future: Can be extended with additional capabilities:
    - emotional_understanding: bool
    - code_switching: bool
    - etc.
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        override_config: Optional override configuration dict with:
            - provider: STT provider name (e.g., "deepgram")
            - model: Model name (e.g., "nova-3")
            - config: Additional provider-specific config dict
    
    Returns:
        STT client instance
    
    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Resolve configuration from registry
    config = resolve_config("stt", language_code, override_config)
    
    # Map provider to class and instantiate
    # Providers will handle language code conversion themselves
    provider = config["provider"].lower()
    
    if provider == STTProvider.DEEPGRAM:
        return DeepgramSTTClient(
            model=config["model"],
            language_code=config["language_code"],  # BCP 47 - provider converts it
            api_key=config["api_key"],
        )
    else:
        raise ValueError(f"Unsupported STT provider: {provider}")

