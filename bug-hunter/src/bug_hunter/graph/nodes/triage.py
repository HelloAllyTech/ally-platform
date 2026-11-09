"""Is this a real bug candidate? Cheap model, structured answer, duplicates and known
false alarms come from memory in chunk 07 (the slot is already in the prompt)."""

from __future__ import annotations

from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field

from bug_hunter.config import AppName
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.llm import StructuredOutputError, call_structured
from bug_hunter.graph.nodes.common import charge_all, node_context, over_budget
from bug_hunter.graph.prompts import load_prompt
from bug_hunter.graph.state import BugState, Confidence, Severity


class TriageDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_bug_candidate: bool = Field(
        description="True only if the signal describes behaviour that is plausibly "
        "wrong and specific enough to investigate"
    )
    app: AppName
    severity: Severity
    confidence: Confidence
    reason: str = Field(description="One or two sentences; symptom-based")
    duplicate_of: str | None = Field(
        default=None, description="Run id or PR of a known duplicate, if any"
    )
    kind: Literal["bug", "not_a_bug", "question", "feature_request", "duplicate"]


def make_triage_node(deps: GraphDeps):
    prompt = load_prompt(deps.config, "triage")

    def triage(state: BugState) -> dict[str, Any]:
        stop = over_budget(deps, state)
        if stop:
            return stop
        ctx = node_context(deps, "triage", state)
        system = prompt.render(
            context=ctx.render(),
            app=state.app or deps.app or "unknown (pick one)",
            mode=state.mode,
        )
        user = (
            "Triage this signal. Answer with the structured decision only."
            if state.mode == "issue"
            else "Triage this commit diff. Answer with the structured decision only."
        )
        try:
            decision, raws, secs = call_structured(
                deps.model("triage"),
                TriageDecision,
                [SystemMessage(content=system), HumanMessage(content=user)],
            )
        except StructuredOutputError as exc:
            deps.scratchpad.append_note(f"triage failed: {exc}")
            return {"status": "failed", "stop_reason": f"triage: {exc}"[:300]}
        budget = charge_all(deps, state.budget_used, "triage", "triage", raws, secs)
        deps.scratchpad.append_note(
            f"triage: candidate={decision.is_bug_candidate} kind={decision.kind} "
            f"severity={decision.severity} confidence={decision.confidence}: "
            f"{decision.reason}"
        )
        update: dict[str, Any] = {
            "budget_used": budget,
            "confidence": decision.confidence,
            "app": state.app or decision.app,
        }
        if decision.kind == "duplicate" and decision.duplicate_of:
            update.update(status="closed_duplicate", duplicate_of=decision.duplicate_of)
        elif decision.is_bug_candidate and decision.kind == "bug":
            update["status"] = "triaged"
        else:
            update.update(
                status="closed_not_bug",
                no_bug_reason=f"triage ({decision.kind}): {decision.reason}",
            )
        return update

    return triage
