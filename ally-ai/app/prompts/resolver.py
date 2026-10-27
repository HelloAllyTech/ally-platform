"""
Resolve prompt templates from backend metadata or local .txt files.

ally-be sends every prompt's live Skills Store version (keyed by its full
``ally_ai_<path>`` code); the local .txt is the default, used only when a prompt
isn't in the payload. Each render is checked against the prompt's typed
contract (app/prompts/contracts.py).
"""

import os
from typing import Any, Dict, Optional

from app.prompts.contracts import missing_required
from app.prompts.manager import prompt_manager
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _get_local_template(internal_path: str) -> str:
    """Read the local default .txt for a prompt by its path (<category>/<name>)."""
    if "/" not in internal_path:
        logger.warning(f"Invalid prompt path (no category): {internal_path}")
        return ""
    file_key, prompt_key = internal_path.split("/", 1)
    return prompt_manager.get_template(file_key, prompt_key.replace("/", os.sep)) or ""


def _get_backend_prompt_entry(
    backend_prompts: Optional[Dict[str, Any]], prompt_code: str
) -> Any:
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


def _clamp_temperature(value: Any) -> Optional[float]:
    """Coerce a prompt-level temperature to a float in [0, 2]; None if invalid."""
    if value is None or value == "":
        return None
    try:
        temp = float(value)
    except (TypeError, ValueError):
        logger.warning("Ignoring invalid prompt-level temperature=%r", value)
        return None
    return min(2.0, max(0.0, temp))


def _extract_provider_model_temperature(
    entry: Any,
) -> tuple[Optional[str], Optional[str], Optional[float]]:
    """Pull (provider, model, temperature) overrides from a backend prompt entry."""
    if not isinstance(entry, dict):
        return (None, None, None)
    provider = entry.get("provider") or None
    model = entry.get("model") or None
    return (provider, model, _clamp_temperature(entry.get("temperature")))


def get_backend_llm_overrides(
    internal_path: str,
    prompts: Optional[Dict[str, Any]] = None,
) -> tuple[Optional[str], Optional[str], Optional[float]]:
    """Return (provider, model, temperature) for a prompt, resolved by the SAME
    backend key as its text (see resolve_template), so the override aligns
    exactly with whichever entry supplied the prompt. (None, None, None) when
    unset/local. `provider` is explicit when ally-be sets it (no inference)."""
    prompt_code = f"ally_ai_{internal_path.replace('/', '_')}"
    entry = _get_backend_prompt_entry(prompts, prompt_code)
    return _extract_provider_model_temperature(entry)


def _extract_allowed_variables(entry: Any) -> Optional[set[str]]:
    if not isinstance(entry, dict):
        return None

    raw_variables = entry.get("availableVariables")
    if not isinstance(raw_variables, list):
        return None

    # Entries are bare names (legacy) or `{name, label?, required?}` objects,
    # which is what ally-be sends today. Reading only strings left the allowed
    # set empty, so every unknown placeholder rendered as literal text.
    names: set[str] = set()
    for value in raw_variables:
        if isinstance(value, str) and value.strip():
            names.add(value.strip())
        elif isinstance(value, dict):
            name = value.get("name")
            if isinstance(name, str) and name.strip():
                names.add(name.strip())
    return names


class SafeFormatter(dict):
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
    backend_prompts: Optional[Dict[str, Any]] = None,
    *,
    internal_path: str,
) -> str:
    """
    Resolve a prompt template.
    Use metadata prompt when present and non-empty.
    Otherwise use local .txt.
    """
    backend_entry = _get_backend_prompt_entry(backend_prompts, prompt_code)
    backend_template = _extract_backend_template(backend_entry)
    if backend_template and backend_template.strip():
        logger.info(
            "[PROMPT_SOURCE] %s: using store v%s, len=%d",
            prompt_code,
            (backend_entry.get("version") if isinstance(backend_entry, dict) else None),
            len(backend_template.strip()),
        )
        return backend_template.strip()

    # The local file is a minimal default, so running it is worth seeing in the
    # logs: the request didn't carry this prompt's live text.
    local_template = _get_local_template(internal_path)
    logger.warning(
        "[PROMPT_SOURCE] %s: using fallback (local default; not in the request's "
        "store prompts), len=%d",
        prompt_code,
        len(local_template),
    )
    return local_template


def load_template(
    internal_path: str,
    prompts: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Resolve template with fallback to local.
    """
    prompt_code = f"ally_ai_{internal_path.replace('/', '_')}"
    return resolve_template(prompt_code, prompts, internal_path=internal_path) or ""


def load_and_format(
    internal_path: str,
    prompts: Optional[Dict[str, Any]] = None,
    **kwargs,
) -> str:
    """
    Load template and format with allowlist-aware safe substitution.
    """
    template = load_template(internal_path, prompts=prompts)
    if not template:
        return ""

    prompt_code = f"ally_ai_{internal_path.replace('/', '_')}"
    backend_entry = _get_backend_prompt_entry(prompts, prompt_code)
    not_supplied = missing_required(prompt_code, kwargs)
    if not_supplied:
        # The code and the prompt's contract have drifted apart. Loud, but the
        # prompt still renders.
        logger.error(
            "[PROMPT_CONTRACT] %s: required variables not supplied by the code: %s",
            prompt_code,
            not_supplied,
        )
    formatter = SafeFormatter(
        **kwargs,
        allowed_variables=_extract_allowed_variables(backend_entry),
    )
    try:
        formatted = template.format_map(formatter)
    except (ValueError, IndexError) as e:
        logger.error(
            f"Error formatting prompt {internal_path}: {type(e).__name__}: {e}"
        )
        return template

    if formatter.missing_keys:
        logger.warning(
            "Prompt %s: missing placeholders resolved to empty string: %s. Provided "
            "kwargs: %s",
            internal_path,
            sorted(formatter.missing_keys),
            sorted(kwargs.keys()),
        )

    if formatter.literal_keys:
        logger.info(
            "Prompt %s: unknown placeholders left as literal text: %s",
            internal_path,
            sorted(formatter.literal_keys),
        )

    return formatted
