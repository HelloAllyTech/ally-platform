"""Language configuration factory - maps capability to registry."""
from typing import Optional, Dict, Any, Literal
from app.core.language.registry.language_registry import (
    DEFAULT_LANGUAGE_CODE,
    get_capability_defaults,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)

# Fallback defaults when registry doesn't have provider/model
CAPABILITY_DEFAULTS: Dict[str, Dict[str, str]] = {
    "stt": {"provider": "deepgram", "model": "nova-3"},
    "llm": {"provider": "openai", "model": "gpt-4o-mini"},
    "tts": {"provider": "deepgram", "model": "nova-2"},
}


def resolve_config(
    capability: Literal["stt", "llm", "tts"],
    language_code: str,
    override_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Resolve configuration for any capability type.
    
    Maps capability → registry → resolved config.
    Similar to how events factory maps DetectionType → Event class.
    
    Args:
        capability: Capability type ("stt", "llm", "tts")
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        override_config: Optional override configuration dict with:
            - provider: Provider name (e.g., "deepgram")
            - model: Model name (e.g., "nova-3")
            - config: Additional provider-specific config dict
    
    Returns:
        Dictionary with resolved configuration:
        {
            "provider": str,
            "model": str,
            "language_code": str,  # BCP 47 code (providers will convert)
            "api_key": Optional[str],
            # ... capability-specific fields
        }
    
    Raises:
        ValueError: If capability is unsupported
    """
    # Get capability defaults from unified registry
    defaults = get_capability_defaults(capability, language_code)
    
    # Determine provider from override_config or language defaults
    if override_config:
        provider = override_config.get("provider")
        model = override_config.get("model")
        config = override_config.get("config", {})
        
        # If override doesn't have model/provider, fallback to language defaults
        if not model:
            model = defaults.get("model")
        if not provider:
            provider = defaults.get("provider")
    else:
        # Use defaults from unified registry
        provider = defaults.get("provider")
        model = defaults.get("model")
        config = {}
    
    # Fallback to DEFAULT_LANGUAGE_CODE if provider or model still missing
    if not provider or not model:
        logger.warning(
            f"No {capability} provider/model found for language {language_code}, "
            f"using {DEFAULT_LANGUAGE_CODE} defaults"
        )
        # Get defaults from default language
        defaults = get_capability_defaults(capability, DEFAULT_LANGUAGE_CODE)
        capability_defaults = CAPABILITY_DEFAULTS.get(capability, {})
        
        if not provider:
            provider = defaults.get("provider") or capability_defaults.get("provider")
        if not model:
            model = defaults.get("model") or capability_defaults.get("model")
    
    if not model:
        raise ValueError(f"{capability.upper()} model not specified for provider {provider}")
    
    # Extract api_key from config if provided
    api_key = config.get("api_key")
    
    # Build result dict
    result = {
        "provider": provider,
        "model": model,
        "language_code": language_code,  # BCP 47 - providers convert it
        "api_key": api_key,
    }
    
    # Add capability-specific fields
    if capability == "llm" and override_config:
        result["temperature"] = override_config.get("temperature")
    
    return result

