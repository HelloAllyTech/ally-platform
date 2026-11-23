"""Escalation report in the artefact folder (GitHub issue arrives in chunk 06):
the §13 header and root cause, why the agent stopped, what it ruled out."""

from __future__ import annotations

import json
from typing import Any

from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.output import escalation_issue
from bug_hunter.graph.state import BugState


def escalation_markdown(state: BugState, scratchpad_text: str) -> str:
    f = state.finding
    title = f.title if f else f"{state.signal.source} {state.signal.ref}"
    lines = [
        f"## Bug\n{title} · app: {state.app} · severity: "
        f"{f.severity if f else 'unknown'} · source: {state.signal.source} "
        f"{state.signal.ref} · confidence: {state.confidence or 'unknown'}",
        "",
        "## Root cause",
        state.root_cause or "(not established)",
        "",
        "## Why the agent stopped",
        state.stop_reason or "(no reason recorded)",
    ]
    if f:
        lines += ["", "## Evidence"] + [f"- {e}" for e in f.evidence]
        lines += ["", "## Suspected files"] + [f"- `{p}`" for p in f.suspected_files]
    if state.repro:
        r = state.repro
        lines += [
            "",
            "## Reproduction attempt",
            f"Test: `{r.test_path}::{r.test_name}` · failure kind: {r.failure_kind} "
            f"· right reason: {r.fails_for_the_right_reason}",
            f"Judgement: {r.judgement}",
            "",
            "```",
            r.failing_output_excerpt[-1500:],
            "```",
        ]
    lines += [
        "",
        "## Ruled out / notes (scratchpad)",
        "",
        scratchpad_text.strip()[-4000:],
    ]
    lines += [
        "",
        "## Budget",
        f"tokens {state.budget_used.tokens} · ${state.budget_used.cost_usd:.3f} · "
        f"{state.budget_used.wall_clock_s:.0f}s",
    ]
    return "\n".join(lines) + "\n"


def make_escalate_node(deps: GraphDeps):
    def escalate(state: BugState) -> dict[str, Any]:
        budget = with_clock(state.budget_used, state.started_at)
        state = state.model_copy(update={"budget_used": budget})
        md = escalation_markdown(state, deps.scratchpad.read())
        path = deps.write_artefact("escalation.md", md)
        deps.write_artefact(
            "escalation.json",
            json.dumps(state.model_dump(exclude={"artefacts"}), indent=1, default=str),
        )
        artefacts = dict(state.artefacts)
        artefacts["escalation"] = str(path)
        update: dict[str, Any] = {
            "status": "escalated",
            "artefacts": artefacts,
            "budget_used": budget,
        }
        # GitHub issue labelled bug-hunter (dry-run writes escalation-issue.md)
        try:
            title, body = escalation_issue(state, deps.scratchpad.read())
            issue = deps.github_client().create_or_update_issue(
                title, body, ["bug-hunter"], state.escalation_url
            )
            update["escalation_url"] = issue.url
        except (
            Exception
        ) as exc:  # noqa: BLE001 - the artefact is the record; never fail here
            deps.scratchpad.append_note(f"escalate: issue not created: {exc}")
        return update

    return escalate
