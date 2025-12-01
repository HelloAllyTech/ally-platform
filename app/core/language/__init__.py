"""Language management for providers."""
from app.core.language.factory import resolve_config
from app.core.language.registry.language_registry import (
    DEFAULT_LANGUAGE_CODE,
    LANGUAGE_DEFAULTS,
    get_language_defaults,
)

__all__ = [
    "resolve_config",
    "DEFAULT_LANGUAGE_CODE",
    "LANGUAGE_DEFAULTS",
    "get_language_defaults",  # Backward compatibility for LLM
]

