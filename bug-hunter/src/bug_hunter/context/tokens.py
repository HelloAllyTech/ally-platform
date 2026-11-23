"""Token counting with a safety margin.

``tiktoken`` needs one network fetch for its encoding file, cached under
``runs/cache/tiktoken``. When the encoding is not available (offline, first run)
the estimate is ``ceil(chars / chars_per_token_offline)`` with 3 chars per token by
default, which overestimates English and code so a budget is never exceeded.
Budgets are enforced at ``(1 - token_safety_margin)`` because Gemini counts
differently from tiktoken.
"""

from __future__ import annotations

import math
import os
from functools import lru_cache
from typing import Callable, Protocol

from bug_hunter.config import CACHE_DIR

ENCODING = "o200k_base"


class TokenCounter(Protocol):
    def __call__(self, text: str) -> int: ...


def offline_counter(chars_per_token: int = 3) -> TokenCounter:
    def count(text: str) -> int:
        return math.ceil(len(text) / chars_per_token) if text else 0

    return count


@lru_cache(maxsize=1)
def _tiktoken_encoding():
    """The tiktoken encoding if it can be loaded without a download, else None."""
    os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(CACHE_DIR / "tiktoken"))
    try:
        import tiktoken

        cache_dir = os.environ["TIKTOKEN_CACHE_DIR"]
        if not os.path.isdir(cache_dir) or not os.listdir(cache_dir):
            if os.environ.get("BUGHUNTER_TIKTOKEN_DOWNLOAD") != "1":
                return None  # never download implicitly; tests stay offline
        return tiktoken.get_encoding(ENCODING)
    except Exception:  # noqa: BLE001 - any failure means "estimate"
        return None


def make_counter(chars_per_token: int = 3) -> tuple[TokenCounter, str]:
    """``(counter, source)`` where source is ``"tiktoken"`` or ``"estimate"``."""
    encoding = _tiktoken_encoding()
    if encoding is None:
        return offline_counter(chars_per_token), "estimate"

    def count(text: str) -> int:
        return len(encoding.encode(text, disallowed_special=())) if text else 0

    return count, "tiktoken"


def effective_budget(budget: int, safety_margin: float) -> int:
    """The budget actually enforced: ``budget * (1 - margin)``, floored."""
    return max(1, math.floor(budget * (1 - safety_margin)))


def truncate_to_tokens(
    text: str, max_tokens: int, counter: Callable[[str], int]
) -> str:
    """Whole-line truncation from the end, never mid-line; adds a marker."""
    if counter(text) <= max_tokens:
        return text
    lines = text.splitlines()
    kept: list[str] = []
    marker = "… (truncated to fit budget)"
    budget = max_tokens - counter(marker)
    used = 0
    for line in lines:
        cost = counter(line + "\n")
        if used + cost > budget:
            break
        kept.append(line)
        used += cost
    return "\n".join(kept + [marker])
