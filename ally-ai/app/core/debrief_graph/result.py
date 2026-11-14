"""The run's answer to ally-be (CONTRACT.md §1 response), from the graph state.

Used by the `finish` node for a run that reached a decision, and by the runner
for one an unexpected error stopped (status `failed`).
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.core.debrief_graph.agent_logs import numbered
from app.core.debrief_graph.constants import END_WHY, FAILED_WHY, FallbackRung, Status
from app.core.debrief_graph.context import DebriefRunContext
from app.core.debrief_graph.progress import profile_of, progress_card
from app.core.debrief_graph.state import DebriefState


def build_result(
    state: DebriefState,
    ctx: DebriefRunContext,
    error: Optional[str] = None,
) -> Dict[str, Any]:
    outcome = state.get("outcome") or {}
    status = Status.FAILED if error is not None else outcome.get("status")
    skip_reason = None if error is not None else outcome.get("skip_reason")
    rung = int(state.get("rung") or 0)
    workspace = dict(state.get("workspace") or {})
    if error is not None:
        rung = int(FallbackRung.PERSON_FINISHES)
    # A run that ended early still says why, in the same place as one that
    # reached a decision about a draft.
    ended = skip_reason or ("failed" if status == Status.FAILED else None)
    if ended and not workspace.get("decision"):
        workspace["decision"] = {
            "status": status,
            "round": None,
            "why": END_WHY.get(ended)
            or (FAILED_WHY if status == Status.FAILED else ended),
        }
    if ctx.resumed:
        workspace["resumes"] = workspace.get("resumes") or 1
    patch = state.get("patch") or {}
    progress_result = state.get("progress_result")
    cards = patch.get("cards")
    if cards is not None and progress_result:
        # Attached in code after the Writer/Reviser loop and finalise_cards:
        # no model writes it, and no card check ever sees it.
        card = progress_card(progress_result["report"], profile_of(ctx.inputs) or {})
        if card:
            cards = {**cards, "progress_card": card}
    out = {
        "status": status,
        "skip_reason": skip_reason,
        "recipe_key": state.get("recipe_key"),
        "cards": cards,
        "steps": list(state.get("steps") or []),
        "logs": numbered(state.get("logs") or []),
        "workspace": workspace,
        "estimated_cost_usd": round(float(state.get("estimated") or 0.0), 4),
        "fallback_rung": rung,
        "has_risk_cue": bool(state.get("has_risk_cue")),
        "learner_distress": bool(state.get("learner_distress")),
        "revision_rounds": int(patch.get("revision_rounds") or 0),
        "evaluator_overall": patch.get("evaluator_overall"),
        "evaluator_hard_fails": patch.get("evaluator_hard_fails") or [],
        "check_failures": patch.get("check_failures") or [],
        "resumed": ctx.resumed,
        # The debrief's language: the recorded one, or the one read from the
        # learner's turns (`workspace.languageSource` says which).
        "language": ctx.language,
        "error": error[:1000] if error is not None else None,
    }
    if progress_result:
        # PROGRESS_CONTRACT §2: absent when the progress agent did not run.
        out["progress"] = progress_result
    return out
