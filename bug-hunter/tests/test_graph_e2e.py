"""Graph v1 end to end with scripted models on a throwaway repo: the three outcomes
(no bug, reproduced, could not reproduce), the budget stop, and the invariant that no
source file is ever modified (only a new test file appears in the worktree diff)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.graph.build import build_graph, run_graph
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.nodes.reproduce import RightReasonJudgement
from bug_hunter.graph.nodes.triage import TriageDecision
from bug_hunter.graph.state import Signal
from bug_hunter.tools.fs import Workspace
from tests.fakes import ScriptedChatModel, ScriptedRunner, ai, run_result, structured

SIGNAL = Signal(
    source="issue",
    ref="issue-1",
    raw_summary="x() returns 0 instead of 3 for a user, phone +91 98765 43210",
    reported_by="staff",
)


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


@pytest.fixture
def repo(config: BugHunterConfig, tmp_path: Path):
    root = tmp_path / "wt"
    (root / "ally-be/src").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text("{}")
    (root / "ally-be/src/x.ts").write_text("export const x = () => 0; // bug\n")
    _git(root, "init", "-q", "-b", "master")
    _git(root, "add", ".")
    _git(root, "commit", "-qm", "init")
    return root


def _triage(candidate: bool = True, kind: str = "bug"):
    return structured(
        TriageDecision(
            is_bug_candidate=candidate,
            app="ally-be",
            severity="medium",
            confidence="medium",
            reason="x returns 0",
            kind=kind,  # type: ignore[arg-type]
        ),
        model="gpt-5-mini",
    )


FINDING_CALL = {
    "name": "submit_finding",
    "args": {
        "title": "x returns 0",
        "category": "logic",
        "severity": "medium",
        "suspected_files": ["src/x.ts"],
        "evidence": ["src/x.ts:1 — returns 0"],
        "hypothesis": "x hard-codes 0",
        "root_cause": "src/x.ts:1 returns 0 instead of 3",
        "confidence": "medium",
    },
}
REPRO_CALL = {
    "name": "submit_repro",
    "args": {
        "test_path": "src/x.spec.ts",
        "test_name": "x returns 3",
        "expected_failure": "expect(x()).toBe(3) fails with 0",
    },
}


def _deps(config, repo, tmp_path, models, runner=None, budget_cap=None) -> GraphDeps:
    cfg = config.model_copy(update={"repo_root": repo})
    if budget_cap is not None:
        limits = cfg.limits.model_copy(
            update={
                "run": cfg.limits.run.model_copy(update={"max_cost_usd": budget_cap})
            }
        )
        cfg = cfg.model_copy(update={"limits": limits})
    artefacts = tmp_path / "artefacts"
    artefacts.mkdir(exist_ok=True)

    def write_artefact(name: str, content: str) -> Path:
        path = artefacts / name
        path.write_text(content, encoding="utf-8")
        return path

    return GraphDeps(
        config=cfg,
        run_id="run-test",
        app="ally-be",
        mode="issue",
        worktree=repo,
        app_root=repo / "ally-be",
        workspace=Workspace(repo, cfg, "ally-be"),
        models=models,
        scratchpad=Scratchpad(artefacts / "scratchpad.md"),
        write_artefact=write_artefact,
        runner=runner,
        ref="HEAD",
    )


def test_not_a_bug_closes_with_a_report(config, repo, tmp_path) -> None:
    deps = _deps(
        config,
        repo,
        tmp_path,
        {"triage": ScriptedChatModel(script=[_triage(False, "question")])},
    )
    state = run_graph(build_graph(deps), deps, SIGNAL)
    assert state.status == "closed_not_bug" and "question" in (
        state.no_bug_reason or ""
    )
    assert "[phone]" in state.signal.raw_summary  # intake scrubbed the signal
    assert (tmp_path / "artefacts/report.md").exists()
    report = json.loads((tmp_path / "artefacts/report.json").read_text())
    assert report["budget_used"]["per_node"]["triage"]["calls"] == 1
    assert state.budget_used.cost_usd > 0
    assert _git(repo, "status", "--porcelain") == ""  # nothing touched


def test_reproduced_bug_writes_only_a_test_file(config, repo, tmp_path) -> None:
    investigate = ScriptedChatModel(
        script=[
            ai(tool_calls=[{"name": "grep", "args": {"pattern": "x", "path": "src"}}]),
            ai(tool_calls=[{"name": "read_file", "args": {"path": "src/x.ts"}}]),
            ai(tool_calls=[FINDING_CALL]),
        ]
    )
    fix = ScriptedChatModel(
        script=[
            ai(
                tool_calls=[
                    {
                        "name": "write_test_file",
                        "args": {
                            "path": "src/x.spec.ts",
                            "content": (
                                "import {x} from './x';\n"
                                "it('x returns 3', () => expect(x()).toBe(3));\n"
                            ),
                        },
                    }
                ]
            ),
            ai(tool_calls=[{"name": "run_tests", "args": {"target": "src/x.spec.ts"}}]),
            ai(tool_calls=[REPRO_CALL]),
            structured(
                RightReasonJudgement(related=True, why="the assertion is the defect")
            ),
        ]
    )
    runner = ScriptedRunner(
        "ally-be",
        [
            run_result(
                "ally-be",
                False,
                "● x returns 3\n expect(received).toBe(3)\n Received: 0",
            )
        ],
    )
    deps = _deps(
        config,
        repo,
        tmp_path,
        {
            "triage": ScriptedChatModel(script=[_triage()]),
            "investigate": investigate,
            "fix": fix,
        },
        runner=runner,
    )
    state = run_graph(build_graph(deps), deps, SIGNAL)
    assert state.status == "reproduced", state.stop_reason
    assert state.finding and state.finding.title == "x returns 0"
    assert state.repro and state.repro.fails_for_the_right_reason
    assert state.repro.failure_kind == "genuine"
    assert runner.calls[-1] == ("src/x.spec.ts", "x returns 3")  # verified in code
    # the invariant: the only change in the worktree is the new test file
    assert _git(repo, "status", "--porcelain") == "?? ally-be/src/x.spec.ts"
    assert (
        repo / "ally-be/src/x.ts"
    ).read_text() == "export const x = () => 0; // bug\n"
    nodes = state.budget_used.per_node
    assert set(nodes) == {"triage", "investigate", "reproduce"}
    assert nodes["reproduce"].calls == 4  # 3 loop calls + the right-reason judgement
    assert "Cost per node" in (tmp_path / "artefacts/report.md").read_text()
    tool_log = json.loads((tmp_path / "artefacts/tool-log.json").read_text())
    assert [t["tool"] for t in tool_log] == [
        "grep",
        "read_file",
        "write_test_file",
        "run_tests",
    ]
    assert all("content" not in t["args"] for t in tool_log)


def test_setup_failure_is_not_a_reproduction_and_escalates(
    config, repo, tmp_path
) -> None:
    fix = ScriptedChatModel(
        script=[
            ai(
                tool_calls=[
                    {
                        "name": "write_test_file",
                        "args": {
                            "path": "src/x.spec.ts",
                            "content": "import {y} from './y';\n",
                        },
                    }
                ]
            ),
            ai(tool_calls=[REPRO_CALL]),
        ]
    )
    runner = ScriptedRunner(
        "ally-be",
        [
            run_result(
                "ally-be", False, "Test suite failed to run\n Cannot find module './y'"
            )
        ],
    )
    deps = _deps(
        config,
        repo,
        tmp_path,
        {
            "triage": ScriptedChatModel(script=[_triage()]),
            "investigate": ScriptedChatModel(script=[ai(tool_calls=[FINDING_CALL])]),
            "fix": fix,
        },
        runner=runner,
    )
    state = run_graph(build_graph(deps), deps, SIGNAL)
    assert state.status == "escalated"
    assert state.repro and state.repro.failure_kind == "setup"
    assert not state.repro.fails_for_the_right_reason
    assert "could not reproduce" in (state.stop_reason or "")
    # no model judgement was asked for a setup failure
    assert state.budget_used.per_node["reproduce"].calls == 2
    escalation = (tmp_path / "artefacts/escalation.md").read_text()
    assert "## Why the agent stopped" in escalation and "import, compile" in escalation


def test_no_bug_from_investigation_and_cannot_reproduce(config, repo, tmp_path) -> None:
    deps = _deps(
        config,
        repo,
        tmp_path,
        {
            "triage": ScriptedChatModel(script=[_triage()]),
            "investigate": ScriptedChatModel(
                script=[
                    ai(
                        tool_calls=[
                            {
                                "name": "report_no_bug",
                                "args": {
                                    "reason": "intentional and tested",
                                    "confidence": "medium",
                                },
                            }
                        ]
                    )
                ]
            ),
        },
    )
    state = run_graph(build_graph(deps), deps, SIGNAL)
    assert (
        state.status == "closed_not_bug"
        and state.no_bug_reason == "intentional and tested"
    )

    deps = _deps(
        config,
        repo,
        tmp_path,
        {
            "triage": ScriptedChatModel(script=[_triage()]),
            "investigate": ScriptedChatModel(script=[ai(tool_calls=[FINDING_CALL])]),
            "fix": ScriptedChatModel(
                script=[
                    ai(
                        tool_calls=[
                            {
                                "name": "cannot_reproduce",
                                "args": {
                                    "reason": "needs a live database",
                                    "tried": ["mocking"],
                                },
                            }
                        ]
                    )
                ]
            ),
        },
        runner=ScriptedRunner("ally-be", [run_result("ally-be", True)]),
    )
    state = run_graph(build_graph(deps), deps, SIGNAL)
    assert state.status == "escalated" and "needs a live database" in state.stop_reason


def test_budget_exceeded_escalates_instead_of_looping(config, repo, tmp_path) -> None:
    # the triage call alone costs more than the cap, so investigate must not run
    deps = _deps(
        config,
        repo,
        tmp_path,
        {
            "triage": ScriptedChatModel(script=[_triage()]),
            "investigate": ScriptedChatModel(script=[]),
        },
        budget_cap=0.000001,
    )
    state = run_graph(build_graph(deps), deps, SIGNAL)
    assert state.status == "escalated" and "cost budget exceeded" in state.stop_reason
    assert state.finding is None
    assert (tmp_path / "artefacts/escalation.md").exists()


def test_graph_checkpoints_and_resumes_after_a_crash(config, repo, tmp_path) -> None:
    investigate = ScriptedChatModel(
        script=[
            ai(tool_calls=[{"name": "read_file", "args": {"path": "src/x.ts"}}]),
            ai(
                tool_calls=[
                    {
                        "name": "report_no_bug",
                        "args": {"reason": "fine", "confidence": "medium"},
                    }
                ]
            ),
        ],
        fail_on_call=2,
    )
    deps = _deps(
        config,
        repo,
        tmp_path,
        {"triage": ScriptedChatModel(script=[_triage()]), "investigate": investigate},
    )
    saver = InMemorySaver()
    graph = build_graph(deps, saver)
    with pytest.raises(RuntimeError):
        run_graph(graph, deps, SIGNAL)
    state = run_graph(graph, deps, None, resume=True)
    assert state.status == "closed_not_bug" and state.no_bug_reason == "fine"
    # triage was not re-run and the investigate loop kept its first tool turn
    assert state.budget_used.per_node["triage"].calls == 1
    assert sum(1 for m in investigate.calls[-1] if m.type == "tool") == 1


def test_graph_agent_exports_only_an_accepted_repro(
    config, repo, tmp_path, monkeypatch
) -> None:
    """A repro whose test passed on the buggy code is not a claim the harness should
    score; the GitHub run showed 'repro: yes' for two such cases."""
    from evals.agents import GraphAgent
    from evals.schema import Case

    repro_passed = ScriptedChatModel(
        script=[
            ai(
                tool_calls=[
                    {
                        "name": "write_test_file",
                        "args": {
                            "path": "src/x.spec.ts",
                            "content": "it('x', () => {});\\n",
                        },
                    }
                ]
            ),
            ai(tool_calls=[REPRO_CALL]),
        ]
    )
    runner = ScriptedRunner("ally-be", [run_result("ally-be", True)])
    models = {
        "triage": ScriptedChatModel(script=[_triage()]),
        "investigate": ScriptedChatModel(script=[ai(tool_calls=[FINDING_CALL])]),
        "fix": repro_passed,
    }
    monkeypatch.setattr(
        "bug_hunter.graph.deps.GraphDeps.for_run",
        classmethod(
            lambda cls, cfg, run, app, mode, **kw: _deps(
                cfg, repo, tmp_path, models, runner=runner
            )
        ),
    )
    monkeypatch.setattr("bug_hunter.graph.tracing.trace_url", lambda run_id: None)

    from types import SimpleNamespace

    fake_run = SimpleNamespace(
        config=config.model_copy(update={"repo_root": repo}),
        run_id="run-test",
        worktree=repo,
        sandbox=None,
        ref="HEAD",
        write_artefact=lambda name, content: tmp_path / name,
    )

    case = Case(
        id="ally-be-x",
        kind="bug",
        app="ally-be",
        parent="a" * 40,
        commit="b" * 40,
        expected="fix",
        description="x returns 0 instead of 3",
        src_files=["src/x.ts"],
        oracle_tests=["src/x.spec.ts"],
    )
    from evals.agents import CaseInput

    result = GraphAgent(checkpoint="memory").run(
        CaseInput(
            case,
            "issue",
            "ally-be",
            repo,
            app_root=repo / "ally-be",
            description=case.description,
        ),
        fake_run,
    )
    assert result.escalated and result.repro_test is None
