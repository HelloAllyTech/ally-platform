"""
Resolve prompt templates from backend metadata or local .txt files.

Logic:
- When backend_prompts (from scenario metadata) has a prompt for the code and
  it's non-empty: use it.
- Otherwise: use local .txt from app/prompts/.
- ally-be only includes prompts with useDashboardOverride=true in metadata,
  so "enabled from Dashboard" prompts override local; others always use local.

Prompt codes use ally_ai_learn_ prefix: ally_ai_learn_subdir_filename
(e.g. ally_ai_learn_system_base_role_instruction).
Local lookup strips the prefix and uses subdir/filename from app/prompts/.
"""

from typing import Any, Optional

from app.core.logger import get_logger
from app.prompts.manager import prompt_manager

logger = get_logger(__name__)

PROMPT_CODE_PREFIX = "ally_ai_learn_"


def _prompt_code_to_path(prompt_code: str) -> tuple[str, str]:
    """
    Parse prompt_code into (file_key, prompt_key) for local lookup.

    Strips ally_ai_learn_ prefix, then converts path-based remainder to
    folder structure.
    E.g. ally_ai_learn_system_base_role_instruction -> (system, base_role_instruction)
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


def _get_backend_prompts(prompt_data: Any) -> Optional[dict]:
    if isinstance(prompt_data, dict):
        return prompt_data

    if hasattr(prompt_data, "prompts"):
        prompts = getattr(prompt_data, "prompts", None)
        if isinstance(prompts, dict):
            return prompts

    return None


def _get_backend_prompt_entry(prompt_data: Any, prompt_code: str) -> Any:
    backend_prompts = _get_backend_prompts(prompt_data)
    if not backend_prompts:
        return None
    return backend_prompts.get(prompt_code)


def _extract_backend_template(entry: Any) -> Optional[str]:
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        prompt = entry.get("prompt")
        if isinstance(prompt, str):
            return prompt
    return None


def _extract_allowed_variables(entry: Any) -> Optional[set[str]]:
    """Extract the set of allowed placeholder names from a backend prompt entry.

    Accepts both the legacy `string[]` schema and the richer
    `{name, label?, required?}[]` schema introduced for studio rendering.
    Returns just the names; metadata like `label` / `required` is consumed
    by the frontend, not by the formatter.
    """
    if not isinstance(entry, dict):
        return None

    raw_variables = entry.get("availableVariables")
    if not isinstance(raw_variables, list):
        return None

    names: set[str] = set()
    for value in raw_variables:
        if isinstance(value, str) and value.strip():
            names.add(value.strip())
        elif isinstance(value, dict):
            name = value.get("name")
            if isinstance(name, str) and name.strip():
                names.add(name.strip())
    return names


def _extract_required_variables(entry: Any) -> set[str]:
    """Names of variables marked `required: true` on a backend prompt entry.

    Used by the runtime to enforce mandatoriness — the corresponding
    kwarg value must be a non-empty string when the prompt is rendered.
    Bare-string entries (legacy schema) are never required since they
    carry no metadata.
    """
    if not isinstance(entry, dict):
        return set()

    raw_variables = entry.get("availableVariables")
    if not isinstance(raw_variables, list):
        return set()

    required: set[str] = set()
    for value in raw_variables:
        if not isinstance(value, dict):
            continue
        if not value.get("required"):
            continue
        name = value.get("name")
        if isinstance(name, str) and name.strip():
            required.add(name.strip())
    return required


def _check_required_variables_present(
    prompt_code: str,
    required: set[str],
    kwargs: dict,
) -> list[str]:
    """Return the names of required variables whose kwarg value is empty.

    A value is "empty" when it's None, an empty string after strip(), or an
    empty list / tuple. Studio surfaces these in the warn-on-save pass; the
    runtime can re-check before formatting to block runs with missing data.
    """
    missing = []
    for name in sorted(required):
        value = kwargs.get(name)
        if value is None:
            missing.append(name)
            continue
        if isinstance(value, str) and not value.strip():
            missing.append(name)
            continue
        if isinstance(value, (list, tuple)) and len(value) == 0:
            missing.append(name)
    if missing:
        logger.warning(
            "[PROMPT_REQUIRED] %s: missing required values for %s",
            prompt_code,
            missing,
        )
    return missing


class SafeFormatter(dict):
    """
    Custom dictionary for str.format_map that records missing keys and
    resolves them to an empty string instead of raising KeyError.

    This lets dashboard-edited prompts omit optional fields or blocks
    without breaking prompt rendering.
    """

    def __init__(
        self,
        *args,
        allowed_variables: Optional[set[str]] = None,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.missing_keys: set[str] = set()
        self.literal_keys: set[str] = set()
        self.allowed_variables = allowed_variables

    def __missing__(self, key):
        if self.allowed_variables is not None and key not in self.allowed_variables:
            self.literal_keys.add(key)
            return "{" + key + "}"
        self.missing_keys.add(key)
        return ""


def resolve_template(
    prompt_code: str,
    prompt_data: Any = None,
) -> str:
    """
    Resolve a prompt template.

    Use metadata prompt when present and non-empty
    (ally-be only sends prompts with useDashboardOverride=true).
    Otherwise use local .txt.

    Args:
        prompt_code: Prefixed code (e.g. ally_ai_learn_system_base_role_instruction)
        prompt_data: A PromptData object (has .prompts), or a raw backend_prompts
            dict, or None

    Returns:
        The resolved template string
    """
    backend_entry = _get_backend_prompt_entry(prompt_data, prompt_code)
    backend_template = _extract_backend_template(backend_entry)
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
    internal_path: str,
    prompt_data: Any = None,
) -> str:
    """
    Resolve template with fallback to local. Use when caller will format manually.

    Resolves via resolve_template() (metadata when present, else local).
    Use load_and_format() when you have format kwargs ready.

    Args:
        internal_path: Local path (e.g. 'system/base_role_instruction')
        prompt_data: A PromptData object (has .prompts), or a raw backend_prompts
            dict, or None

    Returns:
        Template string, or "" if not found
    """
    prompt_code = f"ally_ai_learn_{internal_path.replace('/', '_')}"
    return resolve_template(prompt_code, prompt_data)


def load_and_format(
    internal_path: str,
    prompt_data: Any = None,
    **kwargs,
) -> str:
    """
    Load template and format with SafeFormatter to prevent KeyErrors.

    Single entry point for resolve + fallback + safe format.

    Args:
        internal_path: Local path (e.g. 'system/full_prompt')
        prompt_data: A PromptData object (has .prompts), or a raw backend_prompts
            dict, or None
        **kwargs: Passed to template.format_map(SafeFormatter(**kwargs)).
            Unspecified template variables will resolve to "" and be logged.

    Returns:
        Formatted string, or "" if not found.
    """
    template = load_template(internal_path, prompt_data)
    if not template:
        return ""

    # Always use SafeFormatter to ensure the application never crashes
    # due to a template mismatch (e.g. if a variable is added to a local
    # file but the code hasn't been updated to provide it yet).
    prompt_code = f"ally_ai_learn_{internal_path.replace('/', '_')}"
    backend_entry = _get_backend_prompt_entry(prompt_data, prompt_code)
    formatter = SafeFormatter(
        **kwargs,
        allowed_variables=_extract_allowed_variables(backend_entry),
    )
    formatted = template.format_map(formatter)

    if formatter.missing_keys:
        logger.warning(
            "[PROMPT_FORMAT] %s: missing placeholders resolved to empty string: %s. "
            "Provided kwargs: %s",
            internal_path,
            sorted(formatter.missing_keys),
            sorted(kwargs.keys()),
        )

    if formatter.literal_keys:
        logger.info(
            "[PROMPT_FORMAT] %s: unknown placeholders left as literal text: %s",
            internal_path,
            sorted(formatter.literal_keys),
        )

    return formatted


def load_and_format_by_code(
    prompt_code: str,
    prompt_data: Any = None,
    fallback_internal_path: Optional[str] = None,
    **kwargs,
) -> str:
    """
    Like load_and_format(), but resolves by a fully-qualified prompt_code
    instead of deriving the code from an internal path. Use this when the
    caller already knows which prompt row to load (e.g. a main-agent
    variant selected per-simulation via Scenarios.metadata.selectedMainPromptCode).

    Resolution order:
      1. Backend metadata prompt for `prompt_code` (when present and non-empty).
      2. Local .txt file matching `prompt_code` (best-effort; only works if
         the code follows the ally_ai_learn_<path>_<stem> convention with no
         underscores inside path segments — typically NOT the case for variants).
      3. If both miss and `fallback_internal_path` is provided, resolve that
         path via the normal load_template() pipeline.

    Variants almost always live in backend metadata (useDashboardOverride=true)
    and not as local files, so step 1 covers the common case; step 3 is the
    safety net when a stale selectedMainPromptCode points at a deleted/missing
    variant.

    Args:
        prompt_code: Fully-qualified code, e.g.
            'ally_ai_learn_system_main_agent_prompt_variant_xyz'.
        prompt_data: PromptData (carries .prompts) or raw backend_prompts dict.
        fallback_internal_path: Optional fallback path resolved via load_template
            if the code can't be found.
        **kwargs: Format kwargs.

    Returns:
        Formatted string, or "" if no template can be resolved.
    """
    template = resolve_template(prompt_code, prompt_data)
    used_path_for_logging = prompt_code
    # Track which code's backend_entry the SafeFormatter should consult so
    # `allowed_variables` matches the template actually being rendered. When
    # we fall back to `fallback_internal_path`, the variant's backend entry
    # is missing (that's WHY we fell back) — using it would yield None and
    # bypass the literal-{key} escape for unknown placeholders, masking
    # author errors. Pull the entry for the fallback's prompt_code instead.
    effective_prompt_code = prompt_code

    if not template and fallback_internal_path:
        template = load_template(fallback_internal_path, prompt_data)
        used_path_for_logging = f"{prompt_code} (fell back to {fallback_internal_path})"
        if template:
            logger.warning(
                "[PROMPT_SOURCE] %s: variant code did not resolve; falling back "
                "to %s",
                prompt_code,
                fallback_internal_path,
            )
            effective_prompt_code = (
                f"ally_ai_learn_{fallback_internal_path.replace('/', '_')}"
            )

    if not template:
        return ""

    backend_entry = _get_backend_prompt_entry(prompt_data, effective_prompt_code)
    formatter = SafeFormatter(
        **kwargs,
        allowed_variables=_extract_allowed_variables(backend_entry),
    )
    formatted = template.format_map(formatter)

    if formatter.missing_keys:
        logger.warning(
            "[PROMPT_FORMAT] %s: missing placeholders resolved to empty string: %s. "
            "Provided kwargs: %s",
            used_path_for_logging,
            sorted(formatter.missing_keys),
            sorted(kwargs.keys()),
        )

    if formatter.literal_keys:
        logger.info(
            "[PROMPT_FORMAT] %s: unknown placeholders left as literal text: %s",
            used_path_for_logging,
            sorted(formatter.literal_keys),
        )

    return formatted
