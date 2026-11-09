"""Risk rules (spec §9): risk paths, the crisis/safety keyword check on changed code,
and the risk level shown to the approver. Pure functions; no model."""

from __future__ import annotations

import re
from typing import Iterable, Literal

from bug_hunter.safety.paths import PathPolicy

RiskLevel = Literal["low", "medium", "high", "human_only"]

# Human-only regardless of path on a mental-health platform (spec §9).
SAFETY_KEYWORDS = (
    "crisis",
    "self_harm",
    "self-harm",
    "selfharm",
    "suicid",
    "guardrail",
    "emergency",
)
_KEYWORD_RE = re.compile("|".join(re.escape(k) for k in SAFETY_KEYWORDS), re.IGNORECASE)


def keyword_hits(changed_lines: Iterable[str]) -> list[str]:
    """Added or removed diff lines that mention a safety keyword."""
    hits = []
    for line in changed_lines:
        if (
            line[:1] in "+-"
            and not line.startswith(("+++", "---"))
            and _KEYWORD_RE.search(line)
        ):
            hits.append(line.strip()[:120])
    return hits


def risk_hits(
    policy: PathPolicy, app: str, files: Iterable[str], diff: str
) -> list[str]:
    """Why a change is human-only: risk-path files and safety keywords in the diff."""
    reasons = list(policy.touches_risk(list(files), app))
    reasons += [f"safety keyword: {h}" for h in keyword_hits(diff.splitlines())]
    return reasons


def risk_level(
    *,
    human_only_reasons: list[str],
    lines_changed: int,
    files_changed: int,
    severity: str,
    review_verdict: str | None,
) -> RiskLevel:
    if human_only_reasons:
        return "human_only"
    score = 0
    if lines_changed > 40 or files_changed > 3:
        score += 1
    if severity in ("critical", "high"):
        score += 1
    if review_verdict != "approve":
        score += 1
    return ("low", "medium", "high")[min(score, 2)]
