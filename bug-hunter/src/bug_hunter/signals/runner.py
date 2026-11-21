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


def details_from_state(state: Any, artefacts: Path) -> dict[str, Any]:
    """The dashboard fields of a finished run, from its state and artefacts (all
    already scrubbed by the graph)."""
    finding = getattr(state, "finding", None)
    repro = getattr(state, "repro", None)
    review = getattr(state, "review", None)
    out: dict[str, Any] = {
        "finding": finding.model_dump() if finding is not None else None,
        "root_cause": getattr(state, "root_cause", None),
        "confidence": getattr(state, "confidence", None),
        "risk_level": getattr(state, "risk_level", None),
        "stop_reason": getattr(state, "stop_reason", None),
        "severity": finding.severity if finding is not None else None,
        # chunk 11: the draft PR, or why the strict gate asked a person instead
        "pr_url": getattr(state, "pr_url", None),
        "pr_gate_blockers": list(getattr(state, "pr_gate_blockers", None) or []),
    }
    if repro is not None:
        source = Path(artefacts) / "suggested-fix.md"
        out["repro"] = {
            "test_path": repro.test_path,
            "test_name": repro.test_name,
            "failure_excerpt": repro.failing_output_excerpt,
            "source": _repro_source(source),
        }
    for name in ("suggested-fix.patch", "fix.patch"):
        p = Path(artefacts) / name
        if p.is_file():
            out["patch_diff"] = p.read_text(encoding="utf-8")
            break
    if review is not None:
        out["review"] = {
            "verdict": review.verdict,
            "notes": list(review.notes) + list(review.issues),
            "counterexamples": [
                {
                    "name": c.name,
                    "claim": c.claim,
                    "status": c.status,
                    "dispute_reason": c.dispute_reason,
                }
                for c in getattr(state, "counterexamples", [])
            ],
            "disputed": bool(getattr(state, "disputed", False)),
        }
    return out


def _repro_source(suggested_fix_md: Path) -> str | None:
    """The failing test's source as the suggested-fix report printed it."""
    if not suggested_fix_md.is_file():
        return None
    text = suggested_fix_md.read_text(encoding="utf-8")
    start = text.find("## Verified failing test")
    end = text.find("## Suggested patch")
    if start < 0:
        return None
    block = text[start : end if end > start else None]
    fences = block.split("```")
    return fences[-2].strip() if len(fences) >= 3 else None


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
        details={
            "finding": {
                "title": c.title,
                "hypothesis": c.summary[:2000],
                "evidence": [],
                "files": [],
            },
            "severity": c.severity_hint,
            "stop_reason": "routed to a human: safety-related",
        },
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
            details=details_from_state(state, Path(artefacts)),
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
            if config.limits.pr.output_mode in ("auto", "pr"):
                # chunk 11: a run may open a real draft PR (auto: only through the
                # strict gate), and its approval row is durable
                from datetime import datetime, timezone

                from bug_hunter.graph.approvals import PostgresApprovals
                from bug_hunter.graph.checkpointer import db_url
                from bug_hunter.queue.store import PostgresQueue
                from bug_hunter.queue.worker import day_start

                deps.push = True
                deps.approvals = PostgresApprovals(db_url())
                deps.prs_opened_today = lambda: PostgresQueue(
                    db_url()
                ).prs_opened_since(day_start(datetime.now(timezone.utc)))
            state = run_graph(build_graph(deps, saver), deps, signal)
            run_id = run.run_id
        return run_id, state, run.kept_artefacts
