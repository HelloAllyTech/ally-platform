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
    escalated: bool = False
    escalation_reason: str | None = None
    tokens: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0
    notes: str = ""


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
    """``baseline`` or ``package.module:AgentClass``."""
    if spec == "baseline":
        return BaselineAgent()
    module_name, _, attr = spec.partition(":")
    if not attr:
        raise ValueError(f"agent spec {spec!r}: expected 'module:Class' or 'baseline'")
    module = importlib.import_module(module_name)
    return getattr(module, attr)()
