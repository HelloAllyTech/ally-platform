"""The agent interface the harness drives, and the trivial baseline.

An agent gets one case's input (the commit diff in ``sweep`` mode, the issue-style
description in ``issue`` mode) plus the live ``Run`` (worktree, sandbox, artefacts)
and returns what it claims: whether it found a bug, an optional reproduction test,
an optional patch, or an escalation. The harness scores those claims itself.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from bug_hunter.runs import Run
from evals.schema import Case


@dataclass
class CaseInput:
    case: Case
    mode: str  # sweep | issue
    app: str
    worktree: Path
    app_root: Path | None = (
        None  # the app directory on disk (worktree itself for old layout)
    )
    diff: str = ""  # sweep mode: the commit's diff (scrubbed)
    description: str = ""  # issue mode: the report, as a reporter would write it


@dataclass
class AgentResult:
    found: bool = False
    findings: list[dict[str, Any]] = field(default_factory=list)
    repro_test: tuple[str, str] | None = None  # (app-relative path, content)
    patch: str | None = None  # unified diff against the worktree, repo-relative paths
    patch_applied: bool = False  # the agent already applied it in the worktree (graph)
    escalated: bool = False
    escalation_reason: str | None = None
    tokens: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0
    notes: str = ""
    trace_url: str | None = None
    status: str | None = None  # the graph's final status, for the report
    confidence: str | None = None
    review_verdicts: list[str] = field(default_factory=list)
    fix_attempts: int = 0
    final_outcome: str | None = None  # pr | escalated | no_bug | rejected | other
    stop_reason: str | None = None
    error: str | None = None  # the agent crashed; cost/tokens are still what it spent


class Agent(Protocol):
    name: str

    def run(self, case_input: CaseInput, run: Run) -> AgentResult: ...


class BaselineAgent:
    """Never finds anything. The floor every real agent must beat: 0 % detection,
    0 % false alarms, no cost."""

    name = "baseline"

    def run(self, case_input: CaseInput, run: Run) -> AgentResult:
        run.write_artefact(
            "agent.md", f"baseline agent: no action on {case_input.case.id}\n"
        )
        return AgentResult(found=False, notes="baseline never finds anything")


def load_agent(spec: str) -> Agent:
    """``baseline``, ``graph`` or ``package.module:AgentClass``."""
    if spec == "baseline":
        return BaselineAgent()
    if spec == "graph":
        return GraphAgent()
    module_name, _, attr = spec.partition(":")
    if not attr:
        raise ValueError(f"agent spec {spec!r}: expected 'module:Class' or 'baseline'")
    module = importlib.import_module(module_name)
    return getattr(module, attr)()


class GraphAgent:
    """Graph v1 (chunk 05) driven on the case's run. Checkpoints in memory by default;
    ``BUGHUNTER_EVAL_CHECKPOINT=postgres`` uses the real checkpointer."""

    name = "graph"

    def __init__(self, checkpoint: str | None = None):
        import os

        self.checkpoint = checkpoint or os.environ.get(
            "BUGHUNTER_EVAL_CHECKPOINT", "memory"
        )

    def run(self, case_input: CaseInput, run: Run) -> AgentResult:
        import time

        from bug_hunter.graph.build import build_graph, run_graph
        from bug_hunter.graph.checkpointer import open_checkpointer
        from bug_hunter.graph.deps import GraphDeps
        from bug_hunter.graph.routing import CLOSED
        from bug_hunter.graph.state import Signal
        from bug_hunter.graph.tracing import trace_url

        case = case_input.case
        if case_input.mode == "sweep":
            signal = Signal(
                source="commit_sweep",
                ref=case.parent[:12],
                raw_summary=_diff_summary(case_input.diff),
                reported_by="agent",
            )
        else:
            signal = Signal(
                source="issue",
                ref=case.id,
                raw_summary=case_input.description,
                reported_by="staff",
            )
        started = time.monotonic()
        with open_checkpointer(in_memory=self.checkpoint != "postgres") as saver:
            deps = GraphDeps.for_run(
                run.config,
                run,
                case_input.app,
                case_input.mode,
                app_root=case_input.app_root,
                diff=case_input.diff,
                ref=case.parent,
                checkpointer=saver,
            )
            graph = build_graph(deps, saver)
            try:
                state = run_graph(graph, deps, signal)
            except Exception as exc:  # noqa: BLE001 - report the spend, then the error
                budget = None
                try:
                    snap = graph.get_state({"configurable": {"thread_id": run.run_id}})
                    budget = snap.values.get("budget_used") if snap else None
                except Exception:  # noqa: BLE001
                    budget = None
                return AgentResult(
                    tokens=getattr(budget, "tokens", 0) or 0,
                    cost_usd=getattr(budget, "cost_usd", 0.0) or 0.0,
                    seconds=round(time.monotonic() - started, 1),
                    trace_url=trace_url(run.run_id),
                    status="error",
                    error=f"{type(exc).__name__}: {exc}"[:500],
                )
        seconds = time.monotonic() - started
        repro_test = None
        # only a reproduction the graph itself accepted (ran, failed, for the right
        # reason) is a claim; a file whose test passed on the buggy code is not
        if state.repro is not None and state.repro.fails_for_the_right_reason:
            test_file = Path(deps.app_root) / state.repro.test_path
            if test_file.is_file():
                repro_test = (
                    state.repro.test_path,
                    test_file.read_text(encoding="utf-8", errors="replace"),
                )
        found = state.finding is not None and state.status not in CLOSED
        escalated = state.status == "escalated"
        patch = None
        if state.patch and state.status in (
            "awaiting_human",
            "pr_opened",
            "suggested_fix",
            "verified",
            "reviewed",
        ):
            try:
                patch = Path(state.patch.diff_path).read_text(encoding="utf-8")
            except OSError:
                patch = None
        return AgentResult(
            found=found or escalated,
            findings=[state.finding.model_dump()] if state.finding else [],
            repro_test=repro_test,
            patch=patch,
            patch_applied=patch is not None,  # the graph edited the worktree in place
            escalated=escalated,
            escalation_reason=state.stop_reason if escalated else None,
            tokens=state.budget_used.tokens,
            cost_usd=state.budget_used.cost_usd,
            seconds=round(seconds, 1),
            notes=(
                f"status={state.status}; "
                f"{state.no_bug_reason or state.stop_reason or state.root_cause or ''}"
            )[:500],
            trace_url=trace_url(run.run_id),
            status=state.status,
            confidence=state.confidence,
            review_verdicts=list(state.review_verdicts),
            fix_attempts=state.attempts,
            final_outcome=final_outcome(state.status),
            stop_reason=state.stop_reason,
        )


def final_outcome(status: str) -> str:
    """pr (draft PR ready or awaiting approval), suggested_fix (verified fix reported,
    no PR), escalated, no_bug, rejected, other."""
    if status in ("awaiting_human", "pr_opened"):
        return "pr"
    if status == "suggested_fix":
        return "suggested_fix"
    if status == "escalated":
        return "escalated"
    if status in ("closed_not_bug", "closed_duplicate"):
        return "no_bug"
    if status == "rejected":
        return "rejected"
    return "other"


def _diff_summary(diff: str, max_chars: int = 6000) -> str:
    """The sweep signal: files touched plus the head of the diff; the full diff is an
    artefact the investigator can open."""
    files = [
        line[6:]
        for line in diff.splitlines()
        if line.startswith("+++ b/") and not line.endswith("/dev/null")
    ]
    head = diff[:max_chars] + (
        "\n… (diff truncated; see signal-diff.patch)" if len(diff) > max_chars else ""
    )
    return "Files changed: " + ", ".join(files) + "\n\n" + head
