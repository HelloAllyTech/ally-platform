"""Is this a real bug candidate? Cheap model, structured answer. Known false alarms
and past bugs are recalled from long-term memory (chunk 07); a close on them is
checked in code: a false alarm closes only while its code lines are unchanged."""

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
    memory_match: str | None = Field(
        default=None,
        description="Id of a recalled memory record (known false alarm or past bug) "
        "this signal repeats, if any",
    )


def make_triage_node(deps: GraphDeps):
    prompt = load_prompt(deps.config, "triage")

    def triage(state: BugState) -> dict[str, Any]:
        stop = over_budget(deps, state)
        if stop:
            return stop
        recalled = None
        if deps.memory is not None:
            from bug_hunter.memory.recall import diff_files, triage_recall

            recalled = triage_recall(
                deps.memory,
                state.app or deps.app,
                state.signal.raw_summary,
                diff_files(deps.diff),
                deps.read_at_ref,
            )
        ctx = node_context(
            deps, "triage", state, recall=recalled.lines if recalled else None
        )
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
        if recalled is not None:
            ids = [
                *recalled.blocking_false_alarms,
                *recalled.hint_false_alarms,
                *recalled.bugs,
            ]
            if ids:
                deps.scratchpad.append_note(f"triage: recalled {', '.join(ids)}")
                update["recalled"] = [*state.recalled, *ids]
        match = decision.memory_match or decision.duplicate_of
        if recalled is not None and match and match in recalled.blocking_false_alarms:
            fa = recalled.blocking_false_alarms[match]
            deps.scratchpad.append_note(f"triage: known false alarm {match}")
            update.update(
                status="closed_not_bug",
                duplicate_of=match,
                no_bug_reason=f"known false alarm {match} (code unchanged): "
                f"{fa.reason}"[:400],
            )
        elif (
            recalled is not None
            and decision.kind in ("not_a_bug", "duplicate")
            and (match in recalled.hint_false_alarms)
        ):
            # the lines changed since the verdict: a hint, never a close
            deps.scratchpad.append_note(
                f"triage: {match} is a false alarm on code that changed since; "
                "not closing, investigating"
            )
            update["status"] = "triaged"
        elif decision.kind == "duplicate" and match:
            if recalled is not None and match not in recalled.bugs:
                # with memory on, a duplicate must point at a recalled bug record
                deps.scratchpad.append_note(
                    f"triage: duplicate of unknown {match}; investigating"
                )
                update["status"] = "triaged"
            else:
                update.update(status="closed_duplicate", duplicate_of=match)
        elif decision.is_bug_candidate and decision.kind == "bug":
            update["status"] = "triaged"
        else:
            update.update(
                status="closed_not_bug",
                no_bug_reason=f"triage ({decision.kind}): {decision.reason}",
            )
        return update

    return triage
