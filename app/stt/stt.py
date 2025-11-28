"""STT provider management and configuration."""
from typing import Optional, Dict, Any
from app.core.constants import STTProvider
from app.core.language_config import get_language_defaults, DEFAULT_LANGUAGE_CODE
from app.utils.logger import get_logger
from app.stt.deepgram import create_deepgram_stt

logger = get_logger(__name__)


def get_stt_for_language(
    language_code: str,
    override_config: Optional[Dict[str, Any]] = None,
) -> Any:
    """
    Get STT instance for a language code.
    
    Uses LANGUAGE_DEFAULTS to select provider and model based on language.
    Falls back to DEFAULT_LANGUAGE_CODE if language not found.
    Can be overridden with override_config.
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        override_config: Optional override configuration dict with:
            - provider: STT provider name (e.g., "deepgram")
            - model: Model name (e.g., "nova-3")
            - config: Additional provider-specific config dict
    
    Returns:
        STT instance for the specified language
    
    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Use override config if provided, otherwise get from language defaults
    if override_config:
        provider = override_config.get("provider")
        model = override_config.get("model")
        config = override_config.get("config", {})
        
        # If override doesn't have model, fallback to language defaults
        if not model:
            defaults = get_language_defaults(language_code)
            stt_defaults = defaults.get("stt", {})
            if not model:
                model = stt_defaults.get("model")
            if not provider:
                provider = stt_defaults.get("provider")
    else:
        # Get defaults for language
        defaults = get_language_defaults(language_code)
        stt_defaults = defaults.get("stt", {})
        provider = stt_defaults.get("provider")
        model = stt_defaults.get("model")
        config = {}
    
    # Fallback to DEFAULT_LANGUAGE_CODE if provider or model still missing
    if not provider or not model:
        logger.warning(f"No STT provider/model found for language {language_code}, using {DEFAULT_LANGUAGE_CODE} defaults")
        defaults = get_language_defaults(DEFAULT_LANGUAGE_CODE)
        stt_defaults = defaults.get("stt", {})
        if not provider:
            provider = stt_defaults.get("provider", "deepgram")
        if not model:
            model = stt_defaults.get("model", "nova-3")
    
    if not model:
        raise ValueError(f"STT model not specified for provider {provider}")
    
    # Create provider-specific STT instance
    provider_lower = provider.lower()
    
    if provider_lower == STTProvider.DEEPGRAM:
        # Extract api_key from config if provided, otherwise use settings
        api_key = config.get("api_key")
        return create_deepgram_stt(
            model=model,
            language_code=language_code,
            api_key=api_key,
        )
    else:
        raise ValueError(f"Unsupported STT provider: {provider}")

