"""The strict gate (chunk 11, CONTEXT.md rule 8): when a run may open a draft PR on
its own in ``pr.output_mode: auto``. Every condition must hold; otherwise the run ends
as a suggested fix and an admin may press Open PR.

Returns the conditions that failed, in plain words, so the report says why a fix
asked instead of opening a PR. An empty list means the gate is open.
"""

from __future__ import annotations

from bug_hunter.graph.state import BugState

# Counterexamples the fix has not answered: kept by the reviewer, or still failing.
_OPEN_COUNTEREXAMPLE = ("kept", "failed")
# Findings that never become a public PR, from either path (CONTEXT.md rule 8).
_NEVER_PUBLIC = ("security",)
_RANK = {"low": 0, "medium": 1, "high": 2}


def strict_gate_blockers(
    state: BugState,
    *,
    max_lines: int,
    max_prs_per_day: int,
    prs_today: int,
    min_confidence: str = "high",
) -> list[str]:
    blockers: list[str] = []
    v = state.verification
    if v is None or not v.repro_passes:
        blockers.append("the failing test does not pass with the fix")
    elif not (v.app_tests_pass and v.lint_pass and v.typecheck_pass):
        blockers.append("verify is not green (tests, lint or typecheck)")
    if state.review is None or state.review.verdict != "approve":
        blockers.append("the review did not approve")
    if state.disputed or any(
        c.status in _OPEN_COUNTEREXAMPLE for c in state.counterexamples
    ):
        blockers.append("a reviewer counterexample is still open")
    if _RANK.get(state.confidence or "", -1) < _RANK[min_confidence]:
        want = "high" if min_confidence == "high" else f"{min_confidence} or higher"
        blockers.append(f"confidence is {state.confidence or 'unknown'}, not {want}")
    if state.risk_level != "low":
        blockers.append(f"risk is {state.risk_level or 'unknown'}, not low")
    if state.patch is None or state.patch.lines_changed > max_lines:
        lines = state.patch.lines_changed if state.patch else "?"
        blockers.append(f"the diff is {lines} lines (over {max_lines})")
    if state.finding is not None and state.finding.category in _NEVER_PUBLIC:
        blockers.append("security findings never become public PRs")
    if prs_today >= max_prs_per_day:
        blockers.append(f"{prs_today} PRs already opened today (cap {max_prs_per_day})")
    return blockers
