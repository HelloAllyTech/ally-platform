"""LLM provider management and configuration."""
from typing import Optional, Dict, Any
from app.core.constants import LLMProvider
from app.core.language_config import get_language_defaults, DEFAULT_LANGUAGE_CODE
from app.utils.logger import get_logger
from app.llms.openai import create_openai_llm

logger = get_logger(__name__)


def get_llm_for_language(
    language_code: str,
    override_config: Optional[Dict[str, Any]] = None,
) -> Any:
    """
    Get LLM instance for a language code.
    
    Uses LANGUAGE_DEFAULTS to select provider and model based on language.
    Falls back to DEFAULT_LANGUAGE_CODE if language not found.
    Can be overridden with override_config.
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        override_config: Optional override configuration dict with:
            - provider: LLM provider name (e.g., "openai")
            - model: Model name (e.g., "gpt-4o-mini")
            - temperature: Optional temperature setting
            - config: Additional provider-specific config dict
    
    Returns:
        LLM instance for the specified language
    
    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Use override config if provided, otherwise get from language defaults
    if override_config:
        provider = override_config.get("provider")
        model = override_config.get("model")
        temperature = override_config.get("temperature")
        config = override_config.get("config", {})
    else:
        # Get defaults for language
        defaults = get_language_defaults(language_code)
        llm_defaults = defaults.get("llm", {})
        provider = llm_defaults.get("provider")
        model = llm_defaults.get("model")
        temperature = None
        config = {}
    
    # Fallback to DEFAULT_LANGUAGE_CODE if provider or model still missing
    if not provider or not model:
        logger.warning(f"No LLM provider/model found for language {language_code}, using {DEFAULT_LANGUAGE_CODE} defaults")
        defaults = get_language_defaults(DEFAULT_LANGUAGE_CODE)
        llm_defaults = defaults.get("llm", {})
        if not provider:
            provider = llm_defaults.get("provider", "openai")
        if not model:
            model = llm_defaults.get("model", "gpt-4o-mini")
    
    if not model:
        raise ValueError(f"LLM model not specified for provider {provider}")
    
    # Create provider-specific LLM instance
    provider_lower = provider.lower()
    
    if provider_lower == LLMProvider.OPENAI:
        # Extract api_key and temperature from config if provided
        api_key = config.get("api_key")
        temp = temperature if temperature is not None else config.get("temperature")
        return create_openai_llm(
            model=model,
            language_code=language_code,
            temperature=temp,
            api_key=api_key,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")

