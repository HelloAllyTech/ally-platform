"""Run report (JSON + markdown) in the artefact folder: tokens and cost per node."""

from __future__ import annotations

import json
from typing import Any

from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.state import BugState


def report_markdown(state: BugState) -> str:
    b = state.budget_used
    lines = [
        f"# Run {state.run_id}: {state.status}"
        + (" (reviewer counterexample disputed)" if state.disputed else ""),
        "",
        f"- app: {state.app} · mode: {state.mode} · ref: `{state.ref[:12]}` · signal: "
        f"{state.signal.source} {state.signal.ref}",
        f"- confidence: {state.confidence or '–'} · stop reason: "
        f"{state.stop_reason or '–'}",
        f"- budget: {b.tokens} tokens (in {b.input_tokens}, "
        f"cached {b.cached_input_tokens}, "
        f"out {b.output_tokens}) · ${b.cost_usd:.3f} · {b.wall_clock_s:.0f}s",
    ]
    if state.trace_url:
        lines.append(f"- trace: {state.trace_url}")
    if state.no_bug_reason:
        lines += ["", f"**No bug:** {state.no_bug_reason}"]
    if state.finding:
        f = state.finding
        lines += [
            "",
            f"## Finding: {f.title}",
            f"{f.category} · {f.severity} · files: {', '.join(f.suspected_files)}",
            "",
            f.hypothesis,
            "",
            "Evidence:",
        ] + [f"- {e}" for e in f.evidence]
        lines += ["", f"Root cause: {state.root_cause}"]
    if state.repro:
        r = state.repro
        lines += [
            "",
            "## Reproduction",
            f"`{r.test_path}::{r.test_name}` · {r.failure_kind} · right reason: "
            f"{r.fails_for_the_right_reason} · {r.judgement}",
        ]
    if b.per_node:
        lines += [
            "",
            "## Cost per node",
            "",
            "| node | calls | in | cached | out | $ | s |",
            "|---|---|---|---|---|---|---|",
        ]
        for node, u in b.per_node.items():
            lines.append(
                f"| {node} | {u.calls} | {u.input_tokens} | {u.cached_input_tokens} "
                f"| {u.output_tokens} | {u.cost_usd:.3f} | {u.seconds:.0f} |"
            )
    return "\n".join(lines) + "\n"


def make_report_node(deps: GraphDeps):
    def report(state: BugState) -> dict[str, Any]:
        budget = with_clock(state.budget_used, state.started_at)
        state = state.model_copy(update={"budget_used": budget})
        artefacts = dict(state.artefacts)
        markdown = report_markdown(state)
        if state.status == "suggested_fix" and "suggested_fix" in artefacts:
            # the run's deliverable: root cause, failing test, patch, reviewer notes
            with open(artefacts["suggested_fix"], encoding="utf-8") as fh:
                markdown += "\n" + fh.read()
        artefacts["report"] = str(deps.write_artefact("report.md", markdown))
        deps.write_artefact(
            "report.json", json.dumps(state.model_dump(), indent=1, default=str)
        )
        if deps.tool_log:
            deps.write_artefact("tool-log.json", json.dumps(deps.tool_log, indent=1))
        return {"artefacts": artefacts, "budget_used": budget}

    return report
