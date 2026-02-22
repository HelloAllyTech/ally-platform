"""
Resolve prompt templates from backend metadata or local .txt files.

Logic:
- By default (SYNC_PROMPTS_TO_LOCAL=False): always use local prompts folder.
- When SYNC_PROMPTS_TO_LOCAL=True: use metadata prompts when available, else local.
- No automatic writing to ally-ai-learn; devs copy-paste finalized prompts and push.
"""

from typing import Dict, Optional

from app.core.config import settings
from app.core.logger import get_logger
from app.prompts.manager import prompt_manager

logger = get_logger(__name__)

# Mapping: backend key -> (file_key, prompt_key) for local fallback
BACKEND_TO_LOCAL = {
    "ally_ai_learn_default": ("system", "default_system_prompt"),
    "ally_ai_learn_context_generation": ("system", "context_generation_prompt"),
    "context_generation_system_prompt": ("system", "context_generation_prompt"),
    "language_instruction_non_english": ("system", "language_instruction_non_english"),
    "ally_ai_learn_prosody_generation": ("prosody", "default_generation_prompt"),
    "ally_ai_learn_prosody_unified": ("prosody", "unified_prompt_with_enhancement"),
    "ally_ai_learn_prosody_parameters_only": ("prosody", "parameters_only_prompt"),
}


def _get_local_template(backend_key: str) -> str:
    """Get template from local prompts folder."""
    mapping = BACKEND_TO_LOCAL.get(backend_key)
    if not mapping:
        logger.warning(f"No local mapping for backend key: {backend_key}")
        return ""
    file_key, prompt_key = mapping
    return prompt_manager.get_template(file_key, prompt_key) or ""


def _normalize_for_compare(text: str) -> str:
    """Normalize whitespace for comparison (strip, collapse newlines)."""
    if not text:
        return ""
    return " ".join(text.split())


def resolve_template(
    backend_key: str,
    backend_prompts: Optional[Dict[str, str]] = None,
) -> str:
    """
    Resolve a prompt template.

    When SYNC_PROMPTS_TO_LOCAL is False: always use local .txt prompts, ignore metadata.
    When True: use metadata prompts when available, else local. No writing to disk.

    Args:
        backend_key: Key in promptData.prompts (e.g. ally_ai_learn_default)
        backend_prompts: promptData.prompts from metadata, or None

    Returns:
        The resolved template string
    """
    local_template = _get_local_template(backend_key)
    if not local_template:
        logger.error(f"Local template empty for {backend_key}, cannot resolve")
        return ""

    # When False: use local .txt prompts only, ignore metadata
    if not settings.SYNC_PROMPTS_TO_LOCAL:
        return local_template

    # Fallback: no backend prompts or key missing
    if not backend_prompts or backend_key not in backend_prompts:
        return local_template

    backend_template = backend_prompts.get(backend_key)
    if not backend_template or not backend_template.strip():
        return local_template

    # Use backend when it differs from local (experiment in metadata)
    local_norm = _normalize_for_compare(local_template)
    backend_norm = _normalize_for_compare(backend_template)
    if local_norm != backend_norm:
        logger.debug(f"Using metadata prompt for {backend_key} (differs from local)")
        return backend_template.strip()

    return local_template
