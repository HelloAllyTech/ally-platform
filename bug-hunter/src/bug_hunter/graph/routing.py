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
        return "report"  # fix → verify → review arrive in chunk 06
    return "escalate"
