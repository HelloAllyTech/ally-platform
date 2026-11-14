"""Independent critic on a different model family. Sees only finding, repro, patch
(diff) and verification; the budget builder never gives it the scratchpad."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field

from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.llm import call_structured
from bug_hunter.graph.nodes.common import charge_all, node_context, over_budget
from bug_hunter.graph.prompts import load_prompt
from bug_hunter.graph.state import BugState, ProposedCounterexample, Review
from bug_hunter.safety.phi import scrub_code

DIFF_MAX_CHARS = 30_000
REPRO_MAX_CHARS = 12_000
MAX_COUNTEREXAMPLES = 3


class ReviewV4(BaseModel):
    """review.v4: evidence only. No request_changes: an objection is a test or a
    note."""

    model_config = ConfigDict(extra="forbid")

    verdict: Literal["approve", "reject_drift", "counterexamples"]
    issues: list[str] = Field(
        default_factory=list, description="reject_drift only: the drift reason"
    )
    counterexamples: list[ProposedCounterexample] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


def _repro_source(deps: GraphDeps, state: BugState) -> str:
    if state.repro is None:
        return "(no reproduction test)"
    path = Path(deps.app_root) / state.repro.test_path
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return f"(unreadable: {state.repro.test_path})"
    text = scrub_code(text)
    if len(text) > REPRO_MAX_CHARS:
        text = text[:REPRO_MAX_CHARS] + "\n… (truncated)"
    return f"// {state.repro.test_path}\n{text}"


def make_review_node(deps: GraphDeps):
    prompt = load_prompt(deps.config, "review")

    def review(state: BugState) -> dict[str, Any]:
        stop = over_budget(deps, state)
        if stop:
            return stop
        assert state.patch is not None
        try:
            diff = open(state.patch.diff_path, encoding="utf-8").read()
        except OSError:
            diff = "(diff unavailable)"
        if len(diff) > DIFF_MAX_CHARS:
            diff = diff[:DIFF_MAX_CHARS] + "\n… (diff truncated)"
        ctx = node_context(deps, "review", state)  # finding, repro, patch, verification
        values = dict(context=ctx.render(), app=deps.app, diff=diff)
        evidence_only = "repro_source" in prompt.inputs  # review.v4+
        if evidence_only:
            values["repro_source"] = _repro_source(deps, state)
            values["max_counterexamples"] = str(MAX_COUNTEREXAMPLES)
        system = prompt.render(**values)
        try:
            answer, raws, secs = call_structured(
                deps.model("review"),
                ReviewV4 if evidence_only else Review,
                [
                    SystemMessage(content=system),
                    HumanMessage(
                        content=(
                            "Review the change above. Answer with the structured "
                            "review only."
                        )
                    ),
                ],
            )
        except Exception as exc:  # noqa: BLE001 - provider errors must not kill the run
            deps.scratchpad.append_note(f"review failed: {type(exc).__name__}: {exc}")
            return {
                "status": "escalated",
                "stop_reason": f"review failed ({type(exc).__name__}): {exc}"[:400],
            }
        budget = charge_all(deps, state.budget_used, "review", "review", raws, secs)
        if evidence_only:
            proposed = list(answer.counterexamples)[:MAX_COUNTEREXAMPLES]
            verdict = Review(
                verdict=(
                    answer.verdict
                    if answer.verdict != "counterexamples" or proposed
                    else "approve"  # "counterexamples" with none is an approval
                ),
                issues=list(answer.issues),
                counterexamples=proposed,
                notes=list(answer.notes),
            )
        else:
            verdict = answer
        deps.scratchpad.append_note(
            f"review: {verdict.verdict}; issues: {'; '.join(verdict.issues)[:200]}"
            + (
                f"; counterexamples: {len(verdict.counterexamples)}"
                if verdict.counterexamples
                else ""
            )
        )
        update: dict[str, Any] = {
            "review": verdict,
            "review_verdicts": [*state.review_verdicts, verdict.verdict],
            "budget_used": budget,
        }
        if verdict.verdict == "approve":
            update["status"] = "reviewed"
        elif verdict.verdict == "counterexamples":
            update["status"] = "challenging"
        elif verdict.verdict == "request_changes":
            update["status"] = "fixing"
        else:
            update.update(
                status="escalated",
                stop_reason=(
                    (
                        "review rejected (drift): "
                        if evidence_only
                        else "review rejected: "
                    )
                    + "; ".join(verdict.issues)
                )[:400],
            )
        return update

    return review
