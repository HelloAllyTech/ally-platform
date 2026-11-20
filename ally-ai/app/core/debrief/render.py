"""Fill a Debrief prompt's `{{name}}` placeholders (step 5, 2026-11-16).

The Debrief prompts are ally-be Skills Store codes, so they use ally-be's
placeholder form, `{{name}}` (ally-be `renderPrompt`, and the store's contract
check reads the same names). ally-ai's own `load_and_format` cannot render it:
it is built on `str.format`, which reads `{{` as an escaped brace and would
fail on any literal brace an editor writes. This is the same one-pass
substitution as ally-be's `renderTemplate`: values are never re-scanned, a
literal single brace needs no escaping, and an unknown placeholder renders
empty, as an open contract says.

A required variable the live text does not contain fails the step loudly,
naming the prompt code and the variable: the run's retry and its fallback to
today's debrief handle it. There is no fallback that appends the data.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional

PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")

#: What an absent value renders as; every prompt says how to read it.
NONE = "none"


class PromptVariableMissing(ValueError):
    """The live prompt text lacks a variable the code requires."""

    def __init__(self, code: str, names: List[str]):
        self.code = code
        self.names = names
        super().__init__(
            f"prompt {code} is missing required variable(s) "
            + ", ".join("{{" + n + "}}" for n in names)
        )


def placeholders(template: str) -> List[str]:
    return sorted({m.group(1) for m in PLACEHOLDER.finditer(template or "")})


def render(
    code: str,
    template: str,
    values: Dict[str, Any],
    required: Iterable[str] = (),
) -> str:
    """The template with every `{{name}}` filled; raises when a required one
    is absent from the template."""
    used = set(placeholders(template))
    missing = [n for n in required if n not in used]
    if missing:
        raise PromptVariableMissing(code, missing)

    def fill(m: "re.Match[str]") -> str:
        v = values.get(m.group(1))
        return "" if v is None else str(v)

    return PLACEHOLDER.sub(fill, template)


def block(tag: str, value: Any) -> str:
    """A JSON data block, as the steps sent it before (`<tag>…</tag>`)."""
    return "\n".join(
        [f"<{tag}>", json.dumps(value, ensure_ascii=False, indent=1), f"</{tag}>"]
    )


def or_none(value: Optional[str]) -> str:
    return value if value not in (None, "") else NONE
