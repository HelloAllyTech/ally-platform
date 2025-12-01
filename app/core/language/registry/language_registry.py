"""Unified language registry for all capabilities."""
from typing import Dict, Any

# Default language code when not specified
DEFAULT_LANGUAGE_CODE = "en-IN"

# Unified language defaults - all capabilities in one place
# Structure: LANGUAGE_DEFAULTS[language_code][capability] = config
LANGUAGE_DEFAULTS: Dict[str, Dict[str, Dict[str, Any]]] = {
    "en-IN": {
        "stt": {"provider": "deepgram", "model": "nova-3"},
        "llm": {"provider": "openai", "model": "gpt-4o-mini"},
        # Future capabilities can be added here:
        # "tts": {"provider": "elevenlabs", "model": "..."},
        # "translation": {"provider": "google", "model": "nmt"},
    },
    "hi-IN": {
        "stt": {"provider": "deepgram", "model": "nova-3"},
        "llm": {"provider": "openai", "model": "gpt-4o-mini"},
        # Add more languages as needed
    },
    # Add more languages as needed
    # "es-ES": {
    #     "stt": {"provider": "deepgram", "model": "nova-2"},
    #     "llm": {"provider": "openai", "model": "gpt-4o-mini"},
    # },
}


def get_capability_defaults(
    capability: str,
    language_code: str,
) -> Dict[str, Any]:
    """
    Get defaults for a capability from unified registry.
    
    Args:
        capability: Capability name (e.g., "stt", "llm", "tts")
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
    
    Returns:
        Dictionary with capability default configuration (provider, model, etc.).
        Falls back to DEFAULT_LANGUAGE_CODE if language not found.
        Returns empty dict if capability not found for language.
    """
    lang_config = LANGUAGE_DEFAULTS.get(
        language_code,
        LANGUAGE_DEFAULTS[DEFAULT_LANGUAGE_CODE]
    )
    return lang_config.get(capability, {})


def get_language_defaults(language_code: str) -> Dict[str, Dict[str, Any]]:
    """
    Get all defaults for a language code (all capabilities).
    
    Backward compatibility function for LLM module until it's refactored.
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
    
    Returns:
        Dictionary with all capability configurations for the language.
        Falls back to DEFAULT_LANGUAGE_CODE if language not found.
    """
    return LANGUAGE_DEFAULTS.get(
        language_code,
        LANGUAGE_DEFAULTS[DEFAULT_LANGUAGE_CODE]
    )

