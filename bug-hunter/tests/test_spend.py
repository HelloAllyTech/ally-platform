"""The daily spend ledger: records, totals per day, refuses past the cap unless
overridden, and the harness records and refuses through it."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from bug_hunter import spend
from evals.agents import AgentResult
from evals.run_evals import DiskGuard, run_evals
from tests.test_evals_harness import _options


def test_record_total_and_summary(tmp_path: Path) -> None:
    ledger = tmp_path / "spend.json"
    spend.record(1.25, "local-eval", "graph issue 3 cases", path=ledger)
    spend.record(2.5, "github", "run 123", path=ledger)
    assert spend.total_for(path=ledger) == 3.75
    assert spend.total_for("2000-01-01", path=ledger) == 0
    text = spend.summary(path=ledger)
    assert "$3.75 of the $15 daily cap" in text and "run 123" in text
    data = json.loads(ledger.read_text())
    assert data["daily_cap_usd"] == 15 and len(data["entries"]) == 2


def test_cap_refuses_unless_overridden(tmp_path: Path, monkeypatch) -> None:
    ledger = tmp_path / "spend.json"
    monkeypatch.delenv(spend.ENV_OVERRIDE, raising=False)
    spend.record(14.0, "github", path=ledger)
    assert spend.check_cap(expected_usd=0.5, path=ledger) == 14.0  # 14.5 < 15
    with pytest.raises(spend.SpendCapExceeded):
        spend.check_cap(expected_usd=2.0, path=ledger)
    assert spend.check_cap(expected_usd=2.0, override=True, path=ledger) == 14.0
    monkeypatch.setenv(spend.ENV_OVERRIDE, "1")
    assert spend.check_cap(expected_usd=2.0, path=ledger) == 14.0


class CostlyAgent:
    name = "costly"

    def run(self, case_input, run) -> AgentResult:
        return AgentResult(found=False, cost_usd=0.75)


def test_harness_records_and_refuses_through_the_ledger(
    repo_config, tmp_path, monkeypatch
):
    cfg, repo, bug, clean = repo_config
    ledger = tmp_path / "spend.json"
    monkeypatch.delenv(spend.ENV_OVERRIDE, raising=False)
    report, path = run_evals(
        cfg,
        [bug, clean],
        CostlyAgent(),
        _options(spend_file=ledger),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    assert spend.total_for(path=ledger) == 1.5
    assert report.meta["spend_today_usd"] == 1.5
    assert "Today's model spend on this machine: $1.50 of the $15" in path.read_text()
    spend.record(14.0, "github", path=ledger)
    with pytest.raises(spend.SpendCapExceeded):
        run_evals(
            cfg,
            [bug],
            CostlyAgent(),
            _options(spend_file=ledger),
            repo=repo,
            guard=DiskGuard(5, probe=lambda: 50.0),
            results_dir=tmp_path / "r",
        )
    # explicit override lets it through; the baseline agent (no model) is never blocked
    run_evals(
        cfg,
        [bug],
        CostlyAgent(),
        _options(spend_file=ledger, override_spend_cap=True),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
