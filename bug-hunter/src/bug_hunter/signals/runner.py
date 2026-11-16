"""``start_run`` for the daily dispatcher (chunk 08): one graph run per candidate.

- Candidates marked ``human_only`` (a lens_logic safety finding) never start a
  graph run: they become an escalation report for a human at once.
- Every other candidate becomes a ``Signal`` in issue mode at the right commit (the
  commit for sweep and CI candidates, ``origin/master`` otherwise); the run uses the
  output mode in limits.yaml (suggested_fix), and its report.md is the outcome body.

The graph runner is injected, so tests never start a sandbox or call a model.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from bug_hunter.config import BugHunterConfig
from bug_hunter.graph.state import Signal
from bug_hunter.signals.base import Candidate
from bug_hunter.signals.dispatcher import RunOutcome

REF_FROM_CANDIDATE = ("commit_sweep", "ci_failure")


def signal_for(c: Candidate) -> Signal:
    return Signal(
        source=c.source,  # type: ignore[arg-type]
        ref=c.ref[:64],
        raw_summary=c.summary,
        reported_by=c.reported_by,  # type: ignore[arg-type]
    )


def ref_for(c: Candidate) -> str:
    return c.ref if c.source in REF_FROM_CANDIDATE else "origin/master"


def human_only_outcome(c: Candidate) -> RunOutcome:
    return RunOutcome(
        run_id="",
        status="escalated",
        cost_usd=0.0,
        body_md=(
            f"# Routed to a human: {c.title}\n\n{c.summary}\n\nThis finding touches "
            "crisis detection, guardrails or safety escalation. The bug hunter does "
            "not investigate or fix it automatically."
        ),
    )


# (config, app, ref, signal, memory) -> (run_id, final state, kept artefacts dir)
GraphRun = Callable[[BugHunterConfig, str, str, Signal, Any], tuple[str, Any, Path]]


def make_start_run(
    config: BugHunterConfig, graph_run: GraphRun, memory: Any = None
) -> Callable[[Candidate], RunOutcome]:
    def start_run(c: Candidate) -> RunOutcome:
        if c.extra.get("human_only"):
            return human_only_outcome(c)
        run_id, state, artefacts = graph_run(
            config, c.app, ref_for(c), signal_for(c), memory
        )
        report = Path(artefacts) / "report.md"
        body = report.read_text(encoding="utf-8") if report.is_file() else ""
        return RunOutcome(
            run_id=run_id,
            status=state.status,
            cost_usd=float(state.budget_used.cost_usd),
            body_md=body,
        )

    return start_run


def real_graph_run(config, app, ref, signal, memory):
    """The production graph run (VM): a run worktree and sandbox at ``ref``."""
    from bug_hunter.graph.build import build_graph, run_graph
    from bug_hunter.graph.checkpointer import open_checkpointer
    from bug_hunter.graph.deps import GraphDeps
    from bug_hunter.runs import Run

    with open_checkpointer() as saver:
        with Run.start(config, app, ref) as run:
            deps = GraphDeps.for_run(
                config, run, app, "issue", ref=ref, checkpointer=saver
            )
            deps.memory = memory
            state = run_graph(build_graph(deps, saver), deps, signal)
            run_id = run.run_id
        return run_id, state, run.kept_artefacts
