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


def _reuse(record: Any, app: str) -> dict[str, Any] | None:
    """The confirmed finding of a past bug record, as state updates."""
    from bug_hunter.graph.state import Finding

    data = dict(getattr(record, "finding", None) or {})
    if not data:
        return None
    data.setdefault("app", app)
    try:
        finding = Finding.model_validate(
            {k: v for k, v in data.items() if k in Finding.model_fields}
        )
    except Exception:  # noqa: BLE001 - an old or partial record: investigate instead
        return None
    return {"finding": finding, "root_cause": record.root_cause or None}


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
        elif recalled is not None and match in recalled.duplicate_bugs:
            # row 1: confirmed, fix worked or not judged yet, code unchanged
            deps.scratchpad.append_note(f"triage: duplicate of confirmed {match}")
            update.update(status="closed_duplicate", duplicate_of=match)
        elif recalled is not None and match in recalled.regression_bugs:
            # row 2: confirmed, but the code changed since: investigate with a note
            deps.scratchpad.append_note(f"triage: possible regression of {match}")
            update.update(status="triaged", regression_of=match)
        elif recalled is not None and match in recalled.reuse_bugs:
            # row 3: confirmed diagnosis, the fix was wrong or needed edits: reuse the
            # diagnosis, skip investigate
            reused = _reuse(recalled.reuse_bugs[match], state.app or deps.app)
            if reused is None:
                deps.scratchpad.append_note(
                    f"triage: {match} has no stored finding; investigating"
                )
                update["status"] = "triaged"
            else:
                deps.scratchpad.append_note(
                    f"triage: reusing the confirmed diagnosis of {match}; "
                    "skipping investigate"
                )
                update.update(status="triaged", reused_from=match, **reused)
        elif (
            recalled is not None
            and match
            and (match in recalled.hint_bugs or decision.kind == "duplicate")
        ):
            # row 4 (no verdict: never closes) or a record triage was not shown
            deps.scratchpad.append_note(
                f"triage: {match} cannot close this signal; investigating"
            )
            update["status"] = "triaged"
        elif decision.kind == "duplicate" and match:
            update.update(status="closed_duplicate", duplicate_of=match)  # no memory
        elif decision.is_bug_candidate and decision.kind == "bug":
            update["status"] = "triaged"
        else:
            update.update(
                status="closed_not_bug",
                no_bug_reason=f"triage ({decision.kind}): {decision.reason}",
            )
        return update

    return triage
