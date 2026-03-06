"""
Resolve prompt templates from backend metadata or local .txt files.

Logic:
- When backend_prompts (from scenario metadata) has a prompt for the code and
  it's non-empty: use it.
- Otherwise: use local .txt from app/prompts/.
- ally-be only includes prompts with useDashboardOverride=true in metadata,
  so "enabled from Dashboard" prompts override local; others always use local.

Prompt codes use ally_ai_learn_ prefix: ally_ai_learn_subdir_filename
(e.g. ally_ai_learn_system_default_system_prompt).
Local lookup strips the prefix and uses subdir/filename from app/prompts/.
"""

from typing import Dict, Optional

from app.core.logger import get_logger
from app.prompts.manager import prompt_manager

logger = get_logger(__name__)

PROMPT_CODE_PREFIX = "ally_ai_learn_"


def _prompt_code_to_path(prompt_code: str) -> tuple[str, str]:
    """
    Parse prompt_code into (file_key, prompt_key) for local lookup.

    Strips ally_ai_learn_ prefix, then converts path-based remainder to
    folder structure.
    E.g. ally_ai_learn_system_default_system_prompt -> (system, default_system_prompt)
    """
    code = prompt_code
    if code.startswith(PROMPT_CODE_PREFIX):
        code = code[len(PROMPT_CODE_PREFIX) :]
    if "_" not in code:
        logger.warning(f"Invalid prompt code (no subdir): {prompt_code}")
        return ("", "")
    file_key, prompt_key = code.split("_", 1)
    return (file_key, prompt_key)


def _get_local_template(prompt_code: str) -> str:
    """Get template from local prompts folder using path-based prompt_code."""
    file_key, prompt_key = _prompt_code_to_path(prompt_code)
    if not file_key or not prompt_key:
        return ""
    return prompt_manager.get_template(file_key, prompt_key) or ""


def resolve_template(
    prompt_code: str,
    backend_prompts: Optional[Dict[str, str]] = None,
) -> str:
    """
    Resolve a prompt template.

    Use metadata prompt when present and non-empty
    (ally-be only sends prompts with useDashboardOverride=true).
    Otherwise use local .txt.

    Args:
        prompt_code: Prefixed code (e.g. ally_ai_learn_system_default_system_prompt)
        backend_prompts: promptData.prompts from metadata, or None

    Returns:
        The resolved template string
    """
    backend_template = backend_prompts.get(prompt_code) if backend_prompts else None
    if backend_template and backend_template.strip():
        logger.info(
            "[PROMPT_SOURCE] %s: using METADATA (ally-be, dashboard enabled), "
            "len=%d, preview=%s",
            prompt_code,
            len(backend_template),
            (
                (backend_template[:120] + "...")
                if len(backend_template) > 120
                else backend_template
            ),
        )
        return backend_template.strip()

    local_template = _get_local_template(prompt_code)
    if not local_template:
        logger.error(f"Local template empty for {prompt_code}, cannot resolve")
        return ""
    logger.info(
        "[PROMPT_SOURCE] %s: using LOCAL (no metadata override), len=%d, preview=%s",
        prompt_code,
        len(local_template),
        (local_template[:120] + "...") if len(local_template) > 120 else local_template,
    )
    return local_template


def load_template(
    prompt_code: str,
    backend_prompts: Optional[Dict[str, str]] = None,
) -> str:
    """
    Resolve template with fallback to local. Use when caller will format manually.

    Resolves via resolve_template() (metadata when present, else local).
    Use load_and_format() when you have format kwargs ready.

    Args:
        prompt_code: Prefixed code (e.g. ally_ai_learn_system_default_system_prompt)
        backend_prompts: promptData.prompts from metadata, or None

    Returns:
        Template string, or "" if not found
    """
    return resolve_template(prompt_code, backend_prompts) or ""


def load_and_format(
    prompt_code: str,
    backend_prompts: Optional[Dict[str, str]] = None,
    **kwargs,
) -> str:
    """
    Load template and optionally format with Python str.format().

    Single entry point for resolve + fallback + format. Use when you have
    all format kwargs (e.g. language_code, custom_prompt).

    Args:
        prompt_code: Prefixed code
            (e.g. ally_ai_learn_counselor_report_generation_prompt)
        backend_prompts: promptData.prompts from metadata, or None
        **kwargs: Passed to template.format(**kwargs). Omit for raw template.

    Returns:
        Formatted string if kwargs provided, else raw template. "" if not found.
    """
    template = load_template(prompt_code, backend_prompts)
    if not template:
        return ""
    if kwargs:
        return template.format(**kwargs)
    return template
