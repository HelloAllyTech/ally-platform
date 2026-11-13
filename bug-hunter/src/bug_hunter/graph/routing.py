"""Conditional edges: pure functions of the state, no clock, no model (spec §2)."""

from __future__ import annotations

from bug_hunter.graph.state import BugState

CLOSED = ("closed_not_bug", "closed_duplicate", "failed")


def after_triage(state: BugState) -> str:
    if state.stop_reason and state.status == "escalated":
        return "escalate"
    if state.status in CLOSED:
        return "report"
    return "investigate"


def after_investigate(state: BugState) -> str:
    if state.status == "escalated":
        return "escalate"
    if state.status in CLOSED:
        return "report"
    if state.finding is None:
        return "report"
    return "reproduce"


def after_reproduce(state: BugState) -> str:
    if state.status == "reproduced" and state.repro is not None:
        return "risk_precheck"
    return "escalate"


def after_risk_precheck(state: BugState) -> str:
    return "escalate" if state.status == "escalated" else "fix"


def after_fix(state: BugState) -> str:
    if state.status == "escalated":
        return "escalate"
    if state.status == "reviewed":  # every failing counterexample disputed, no change
        return "risk_gate"
    return "verify" if state.patch is not None else "escalate"


def after_verify(state: BugState, max_attempts: int = 3) -> str:
    if state.status == "escalated":
        return "escalate"
    if state.verification is not None and state.verification.passed:
        return "review"
    return "fix" if state.attempts < max_attempts else "escalate"


def after_review(state: BugState, max_attempts: int = 3) -> str:
    if state.status == "escalated" or state.review is None:
        return "escalate"
    if state.review.verdict == "counterexamples":
        return "challenge"
    if state.review.verdict == "approve":
        # counterexamples kept on an earlier attempt run again on every new fix
        if any(
            ce.status in ("kept", "passed", "failed") for ce in state.counterexamples
        ):
            return "challenge"
        return "risk_gate"
    if state.review.verdict == "request_changes" and state.attempts < max_attempts:
        return "fix"
    return "escalate"


def after_challenge(state: BugState) -> str:
    if state.status == "escalated":
        return "escalate"
    return "fix" if state.status == "fixing" else "risk_gate"


def after_risk_gate(state: BugState, output_mode: str = "suggested_fix") -> str:
    if state.status == "escalated":
        return "escalate"
    if state.disputed:  # a disputed counterexample never becomes a PR
        return "suggest_fix"
    return "open_pr" if output_mode == "pr" else "suggest_fix"


def after_open_pr(state: BugState) -> str:
    return "escalate" if state.status == "escalated" else "human_approval"
