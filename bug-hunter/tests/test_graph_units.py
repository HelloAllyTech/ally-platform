"""Graph v1 units: routing edges, budget accounting and caps, failure classifier,
prompt loading, workspace at the old layout."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from bug_hunter.config import BugHunterConfig, ModelSpec
from bug_hunter.graph import routing
from bug_hunter.graph.budget import charge, cost_usd, exceeded, usage_of
from bug_hunter.graph.failure import classify_failure
from bug_hunter.graph.prompts import PromptError, load_prompt
from bug_hunter.graph.state import Budget, BugState, Finding, Repro, Signal
from bug_hunter.tools.fs import Workspace
from tests.fakes import ai, run_result

SIGNAL = Signal(source="issue", ref="1", raw_summary="x fails", reported_by="staff")


def _state(**over) -> BugState:
    base = dict(run_id="r1", signal=SIGNAL, app="ally-be", started_at="")
    base.update(over)
    return BugState(**base)


def _finding() -> Finding:
    return Finding(
        app="ally-be",
        title="t",
        category="logic",
        severity="medium",
        suspected_files=["src/x.ts"],
        evidence=["src/x.ts:1 — x"],
        hypothesis="h",
    )


def test_routing_covers_every_edge() -> None:
    assert routing.after_triage(_state(status="triaged")) == "investigate"
    assert routing.after_triage(_state(status="closed_not_bug")) == "report"
    assert routing.after_triage(_state(status="closed_duplicate")) == "report"
    assert routing.after_triage(_state(status="failed")) == "report"
    assert (
        routing.after_triage(_state(status="escalated", stop_reason="cost budget"))
        == "escalate"
    )
    assert (
        routing.after_investigate(_state(status="investigating", finding=_finding()))
        == "reproduce"
    )
    assert routing.after_investigate(_state(status="closed_not_bug")) == "report"
    assert routing.after_investigate(_state(status="escalated")) == "escalate"
    assert routing.after_investigate(_state(status="investigating")) == "report"
    repro = Repro(
        test_path="src/x.spec.ts",
        test_name="t",
        command="c",
        failing_output_excerpt="",
        fails_for_the_right_reason=True,
    )
    assert routing.after_reproduce(_state(status="reproduced", repro=repro)) == "report"
    assert routing.after_reproduce(_state(status="escalated")) == "escalate"
    assert routing.after_reproduce(_state(status="reproduced")) == "escalate"


def test_budget_charges_per_node_and_prices_cached_tokens(
    config: BugHunterConfig,
) -> None:
    spec = ModelSpec(provider="openai", model="gpt-5")
    msg = ai("ok", input=1_000_000, cached=500_000, output=100_000)
    assert usage_of(msg) == (1_000_000, 500_000, 100_000)
    # 0.5M fresh at 1.25 + 0.5M cached at 0.125 + 0.1M out at 10
    assert cost_usd(config, spec, 1_000_000, 500_000, 100_000) == pytest.approx(
        0.625 + 0.0625 + 1.0
    )
    budget = charge(config, Budget(), "investigate", spec, msg, seconds=2)
    budget = charge(config, budget, "investigate", spec, ai("ok"), seconds=1)
    assert budget.per_node["investigate"].calls == 2
    assert budget.tokens == 1_100_000 + 120
    assert budget.per_node["investigate"].seconds == 3


def test_every_cap_is_a_stop_reason(config: BugHunterConfig) -> None:
    assert exceeded(config, Budget(), "") is None
    limits = config.limits.run
    assert "token" in exceeded(config, Budget(input_tokens=limits.max_tokens), "")
    assert "cost" in exceeded(config, Budget(cost_usd=limits.max_cost_usd), "")
    old = (
        datetime.now(timezone.utc) - timedelta(seconds=limits.max_wall_clock_s + 5)
    ).isoformat(timespec="seconds")
    assert "wall-clock" in exceeded(config, Budget(), old)


@pytest.mark.parametrize(
    "app, excerpt, expected",
    [
        (
            "ally-be",
            "Test suite failed to run\n error TS2305: no exported member",
            "setup",
        ),
        ("ally-be", "Cannot find module 'src/missing'", "setup"),
        ("ally-be", "● x › fails\n expect(received).toBe(3)\n Received: 0", "genuine"),
        ("ally-web", "Error: Failed to resolve import './nope'", "setup"),
        ("ally-web", "AssertionError: expected false to be true", "genuine"),
        ("ally-ai", "E   ModuleNotFoundError: No module named 'app.nope'", "setup"),
        ("ally-ai", "fixture 'db' not found", "setup"),
        ("ally-ai", "E   assert 0 == 3", "genuine"),
        ("ally-mobile", "Error: Couldn't resolve the package 'nope'", "setup"),
        ("ally-mobile", "Expected: <3>\n  Actual: <0>", "genuine"),
    ],
)
def test_failure_classifier(config: BugHunterConfig, app, excerpt, expected) -> None:
    assert (
        classify_failure(config.app(app), run_result(app, False, excerpt)) == expected
    )


def test_failure_classifier_special_cases(config: BugHunterConfig) -> None:
    be = config.app("ally-be")
    assert classify_failure(be, run_result("ally-be", True)) == "passed"
    assert (
        classify_failure(be, run_result("ally-be", False, no_tests=True)) == "no_tests"
    )
    assert classify_failure(be, run_result("ally-be", False, timed_out=True)) == "setup"


def test_prompts_load_and_render_strictly(config: BugHunterConfig) -> None:
    prompt = load_prompt(config, "triage")
    assert prompt.name == "triage.v1" and set(prompt.inputs) == {
        "context",
        "app",
        "mode",
    }
    text = prompt.render(context="CTX", app="ally-be", mode="issue")
    assert "CTX" in text and "$context" not in text and "valued answer" in text
    with pytest.raises(PromptError):
        prompt.render(context="CTX", app="ally-be")
    with pytest.raises(PromptError):
        prompt.render(context="CTX", app="ally-be", mode="issue", extra="x")
    for node in ("investigate", "reproduce"):
        assert load_prompt(config, node).text.count("Bad") >= 1


def test_workspace_at_old_layout_writes_tests_at_the_root(
    config: BugHunterConfig, tmp_path: Path
) -> None:
    root = tmp_path / "wt"
    (root / "src").mkdir(parents=True)
    (root / "src/x.ts").write_text("export const x = 1;\n")
    (root / "package-lock.json").write_text("{}")
    cfg = config.model_copy(update={"repo_root": root})
    ws = Workspace(root, cfg, "ally-be", app_root=root)
    assert "x.ts" in ws.list_dir("src")
    assert ws.read_file("src/x.ts").strip().endswith("export const x = 1;")
    ws.write_test_file("src/x.spec.ts", "it('x', () => {});\n")
    assert (root / "src/x.spec.ts").exists()
    assert ws.policy.app_rel(root / "src/x.ts", "ally-be") == "src/x.ts"
