"""Chunk 07 eval side: the two-pass memory check and the holdout guard. Offline."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from bug_hunter.memory.store import in_memory
from evals.agents import AgentResult, CaseInput, GraphAgent
from evals.memory_check import Entry, load_entries, run_memory_check
from evals.run_evals import DiskGuard
from tests.test_evals_harness import _options, repo_config  # noqa: F401


class RememberingAgent:
    """Pass 1 reports a finding (and leaves the run's report.json, like the graph's
    report node); later passes show whatever memory recalls for the same report."""

    name = "remembering"

    def __init__(self):
        self.memory = None

    def run(self, case_input, run) -> AgentResult:
        summary = case_input.description or "diff"
        recalled = [
            r.id
            for kind in ("false_alarms", "wrong_theories", "bugs")
            for r in self.memory.search(
                case_input.app, kind, query=summary, files=["ally-be/src/x.ts"]
            )
        ]
        state = {
            "run_id": run.run_id,
            "app": case_input.app,
            "mode": case_input.mode,
            "ref": case_input.case.parent,
            "status": "closed_not_bug" if recalled else "escalated",
            "signal": {"source": "issue", "raw_summary": summary},
            "finding": {
                "title": "x is wrong",
                "category": "logic",
                "suspected_files": ["src/x.ts"],
                "evidence": ["src/x.ts:1 — x"],
                "hypothesis": "x has the wrong value",
            },
            "root_cause": "src/x.ts:1",
            "patch": None,
        }
        run.write_artefact("report.json", json.dumps(state))
        return AgentResult(
            found=not recalled,
            escalated=not recalled,
            cost_usd=0.1,
            recalled=recalled,
            finding_title="x is wrong",
            status=state["status"],
            final_outcome="no_bug" if recalled else "escalated",
        )


def test_the_spec_file_has_no_holdout_case_and_at_most_six() -> None:
    from bug_hunter.config import PACKAGE_ROOT
    from evals.schema import load_cases

    cases = {
        c.id: c
        for c in load_cases(PACKAGE_ROOT / "evals" / "golden" / "cases.yaml").cases
    }
    entries = load_entries()
    assert 1 <= len(entries) <= 6
    for e in entries:
        assert cases[e.case].split == "dev" and e.mode in cases[e.case].modes


def test_two_passes_recall_the_simulated_verdict(repo_config, tmp_path) -> None:
    cfg, repo, bug, clean = repo_config
    memory = in_memory(scope="eval-memcheck-test")
    report, path = run_memory_check(
        cfg,
        [Entry(clean.id, "issue", "not_a_bug", "none", "x is meant to be 'buggy'")],
        {clean.id: clean},
        RememberingAgent(),
        memory,
        _options(max_cost_usd=5.0),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    row = report["cases"][clean.id]
    fa_ids = [i for i in row["verdict"]["written"] if i.startswith("fa-")]
    assert fa_ids and row["pass1"]["recalled"] == []
    assert set(fa_ids) <= set(row["pass2"]["recalled"]) and row["recalled_memory"]
    assert any(c.startswith("ended_as") for c in row["changes"])
    md = path.read_text()
    assert fa_ids[0] in md and "expected row" in md
    assert report["meta"]["cost_usd_total"] == pytest.approx(0.2)
    # the false alarm carries fingerprints taken at the case's commit
    _, fa = memory.get(fa_ids[0])
    assert fa.fingerprints and fa.fingerprints[0].sha != "missing"


def test_holdout_and_live_memory_are_refused(repo_config, tmp_path) -> None:
    cfg, repo, bug, clean = repo_config
    held = bug.model_copy(update={"split": "holdout"})
    entry = Entry(held.id, "issue", "wrong", "none", "r")
    with pytest.raises(ValueError, match="holdout"):
        run_memory_check(
            cfg,
            [entry],
            {held.id: held},
            RememberingAgent(),
            in_memory(scope="eval-x"),
            _options(),
            repo=repo,
        )
    with pytest.raises(ValueError, match="eval-scoped"):
        run_memory_check(
            cfg,
            [Entry(bug.id, "issue", "wrong", "none", "r")],
            {bug.id: bug},
            RememberingAgent(),
            in_memory(),  # live scope
            _options(),
            repo=repo,
        )


def test_graph_agent_never_gives_a_holdout_case_memory(
    repo_config, monkeypatch, tmp_path
) -> None:
    from bug_hunter.graph import build as build_mod
    from bug_hunter.graph import deps as deps_mod

    cfg, repo, bug, clean = repo_config
    seen = []

    def fake_for_run(*a, **k):
        return SimpleNamespace(memory="unset")

    def fake_build(deps, saver):
        seen.append(deps.memory)
        return SimpleNamespace(get_state=lambda c: None)

    def boom(*a, **k):
        raise RuntimeError("stop here")

    monkeypatch.setattr(deps_mod.GraphDeps, "for_run", staticmethod(fake_for_run))
    monkeypatch.setattr(build_mod, "build_graph", fake_build)
    monkeypatch.setattr(build_mod, "run_graph", boom)
    agent = GraphAgent(checkpoint="memory", memory="eval-memory")
    run = SimpleNamespace(config=cfg, run_id="run-x")
    for case in (bug, bug.model_copy(update={"split": "holdout"})):
        agent.run(
            CaseInput(case=case, mode="issue", app="ally-be", worktree=Path(tmp_path)),
            run,
        )
    assert seen == ["eval-memory", None]


def test_expected_and_applied_rows() -> None:
    from evals.memory_check import applied_row, expected_row

    assert expected_row("wrong", "wrong", True).startswith("5")
    assert expected_row("correct", "needed_edits", True).startswith("3")
    assert expected_row("correct", "worked", True).startswith("1")
    assert expected_row("not_a_bug", "none", False).startswith("none")
    assert applied_row({"memory_route": "reuse:bug-1"}, "bug-1") == (
        "3 reuse diagnosis (bug-1)"
    )
    assert applied_row({"memory_route": "", "recalled": ["bug-1"]}, "bug-1").startswith(
        "4"
    )
    assert applied_row({"memory_route": "", "recalled": []}, "bug-1") == (
        "not recalled as a bug"
    )
