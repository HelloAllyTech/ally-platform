"""Language configuration defaults for STT and LLM providers."""
from typing import Dict, Any

# Language-to-provider defaults mapping
# Maps BCP 47 language codes to default STT and LLM provider configurations
LANGUAGE_DEFAULTS: Dict[str, Dict[str, Dict[str, Any]]] = {
    "en-IN": {
        "stt": {"provider": "deepgram", "model": "nova-3"},
        "llm": {"provider": "openai", "model": "gpt-4o-mini"}
    },
    "hi-IN": {
        "stt": {"provider": "deepgram", "model": "nova-3"},
        "llm": {"provider": "openai", "model": "gpt-4o-mini"}
    },
    # Add more languages as needed
    # "es-ES": {
    #     "stt": {"provider": "deepgram", "model": "nova-2"},
    #     "llm": {"provider": "openai", "model": "gpt-4o-mini"}
    # },
}

# Default language code when not specified
DEFAULT_LANGUAGE_CODE = "en-IN"

def get_language_defaults(language_code: str) -> Dict[str, Dict[str, Any]]:
    """
    Get default STT and LLM configurations for a language code.
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
    
    Returns:
        Dictionary with "stt" and "llm" default configurations.
        Falls back to DEFAULT_LANGUAGE_CODE if language not found.
    """
    return LANGUAGE_DEFAULTS.get(language_code, LANGUAGE_DEFAULTS[DEFAULT_LANGUAGE_CODE])

