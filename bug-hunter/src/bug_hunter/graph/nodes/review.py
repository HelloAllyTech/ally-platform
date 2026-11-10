"""Independent critic on a different model family. Sees only finding, repro, patch
(diff) and verification; the budget builder never gives it the scratchpad."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.llm import call_structured
from bug_hunter.graph.nodes.common import charge_all, node_context, over_budget
from bug_hunter.graph.prompts import load_prompt
from bug_hunter.graph.state import BugState, Review

DIFF_MAX_CHARS = 30_000


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
        system = prompt.render(context=ctx.render(), app=deps.app, diff=diff)
        try:
            verdict, raws, secs = call_structured(
                deps.model("review"),
                Review,
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
        deps.scratchpad.append_note(
            f"review: {verdict.verdict}; issues: {'; '.join(verdict.issues)[:200]}"
        )
        update: dict[str, Any] = {"review": verdict, "budget_used": budget}
        if verdict.verdict == "approve":
            update["status"] = "reviewed"
        elif verdict.verdict == "request_changes":
            update["status"] = "fixing"
        else:
            update.update(
                status="escalated",
                stop_reason=("review rejected: " + "; ".join(verdict.issues))[:400],
            )
        return update

    return review
