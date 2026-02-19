"""
Resolve prompt templates from backend metadata or local YAML.

Logic:
- If promptData.prompts is not in metadata → use local prompts (fallback)
- If a specific key is missing from promptData.prompts → use local for that key
- If backend prompt exists AND differs from local → use backend, sync to local file
- If backend prompt exists AND equals local → use local (no need to override)
"""

from pathlib import Path
from typing import Dict, Optional

import yaml

from app.core.config import settings
from app.core.logger import get_logger
from app.prompts.manager import prompt_manager

logger = get_logger(__name__)

TEMPLATES_DIR = Path(__file__).parent / "templates"


def _yaml_str_representer(dumper, data):
    """Use | block style for multiline strings."""
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


yaml.add_representer(str, _yaml_str_representer)

# Mapping: backend key -> (file_key, prompt_key) for local fallback
BACKEND_TO_LOCAL = {
    "ally_ai_learn_default": ("system", "default_system_prompt"),
    "ally_ai_learn_context_generation": ("system", "context_generation_system_prompt"),
    "context_generation_system_prompt": ("system", "context_generation_system_prompt"),
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
    Resolve a prompt template: use backend if present and different from local,
    otherwise use local.

    When SYNC_PROMPTS_TO_LOCAL is False: always use local YAML, ignore metadata.
    When True: use metadata when available, sync differing prompts to local.

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

    # When False: use local YAML only, ignore metadata prompts
    if not settings.SYNC_PROMPTS_TO_LOCAL:
        return local_template

    # Fallback: no backend prompts or key missing
    if not backend_prompts or backend_key not in backend_prompts:
        return local_template

    backend_template = backend_prompts.get(backend_key)
    if not backend_template or not backend_template.strip():
        return local_template

    # Only use backend when it differs from local (user made changes)
    local_norm = _normalize_for_compare(local_template)
    backend_norm = _normalize_for_compare(backend_template)
    if local_norm != backend_norm:
        logger.debug(f"Using backend prompt for {backend_key} (differs from local)")
        if settings.SYNC_PROMPTS_TO_LOCAL:
            sync_backend_prompt_to_local(backend_key, backend_template.strip())
        return backend_template.strip()

    return local_template


def sync_backend_prompts_to_local(backend_prompts: Dict[str, str]) -> None:
    """
    Write backend prompts that differ from local into app/prompts/templates/.
    Updates system.yaml and prosody.yaml with changed prompts.
    Only runs when settings.SYNC_PROMPTS_TO_LOCAL is True.
    """
    if not settings.SYNC_PROMPTS_TO_LOCAL or not backend_prompts:
        return
    for backend_key, backend_content in backend_prompts.items():
        if not backend_content or not backend_content.strip():
            continue
        mapping = BACKEND_TO_LOCAL.get(backend_key)
        if not mapping:
            continue
        local_template = _get_local_template(backend_key)
        if not local_template:
            continue
        if _normalize_for_compare(local_template) != _normalize_for_compare(
            backend_content
        ):
            sync_backend_prompt_to_local(backend_key, backend_content.strip())


def sync_backend_prompt_to_local(backend_key: str, backend_content: str) -> None:
    """Update a single prompt in the local YAML file."""
    mapping = BACKEND_TO_LOCAL.get(backend_key)
    if not mapping:
        return
    file_key, prompt_key = mapping
    yaml_path = TEMPLATES_DIR / f"{file_key}.yaml"
    if not yaml_path.exists():
        logger.warning(f"Template file not found: {yaml_path}")
        return
    try:
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict):
            logger.warning(f"Invalid YAML structure in {yaml_path}")
            return
        data[prompt_key] = backend_content
        with open(yaml_path, "w", encoding="utf-8") as f:
            yaml.dump(
                data,
                f,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
                width=float("inf"),
            )
        prompt_manager.reload()
        logger.info(f"Synced backend prompt {backend_key} to {yaml_path.name}")
    except Exception as e:
        logger.error(f"Failed to sync {backend_key} to {yaml_path}: {e}")
