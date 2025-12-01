"""STT provider factory for creating STT clients based on configuration."""
from app.core.constants import STTProvider
from app.core.language.factory import resolve_config
from app.stt.base import BaseSTTClient
from app.stt.deepgram import DeepgramSTTClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


def create_stt_client(
    language_code: str,
) -> BaseSTTClient:
    """
    Create STT client instance from configuration.
    
    This function uses resolve_config to resolve configuration from language registry
    and then instantiates the appropriate provider class. Providers handle their own
    language code format conversion.
    
    Future: Can be extended with additional capabilities:
    - emotional_understanding: bool
    - code_switching: bool
    - etc.
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
    
    Returns:
        STT client instance
    
    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Resolve configuration from language registry
    config = resolve_config("stt", language_code)
    
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

