"""Context builder: declared fields only, trimming order, whole-item cuts, error
when nothing is left to trim, review blind to the scratchpad."""

from __future__ import annotations

from pathlib import Path

import pytest

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.app_context import AppContext
from bug_hunter.context.builder import NODE_INPUTS, BudgetError, build_context, shrink
from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.context.tokens import offline_counter

COUNT = offline_counter(3)


def _app_context() -> AppContext:
    return AppContext(
        app="ally-ai",
        commit="abc",
        agents_md="AGENTS body " * 200,
        repo_row="row",
        verified_commands="```bash\nmake test\n```",
        stack_rules="- Black 88",
        app_notes="",
    )


def _state() -> dict:
    return {
        "signal": {
            "source": "issue",
            "ref": "42",
            "raw_summary": "summary line\n" * 30,
        },
        "finding": {
            "app": "ally-ai",
            "title": "t",
            "evidence": [f"evidence {i} " * 8 for i in range(12)],
        },
        "root_cause": "because " * 50,
        "secret_reasoning": "must never appear",
    }


def test_only_declared_fields_are_included(config: BugHunterConfig) -> None:
    # undeclared fields never appear; declared-but-missing ones render as "(none)"
    ctx = build_context(
        config, "review", {**_state(), "repro": None}, counter=COUNT, budget=5000
    )
    assert set(ctx.sections) == {"finding", "repro", "patch", "verification"}
    assert ctx.sections["repro"] == "(none)"
    assert "secret_reasoning" not in ctx.render()
    assert NODE_INPUTS["review"] == ("finding", "repro", "patch", "verification")


def test_review_never_sees_the_scratchpad(
    config: BugHunterConfig, tmp_path: Path
) -> None:
    pad = Scratchpad(tmp_path / "s.md")
    pad.append_note("investigator reasoning")
    ctx = build_context(
        config, "review", _state(), scratchpad=pad, counter=COUNT, budget=5000
    )
    assert "scratchpad" not in ctx.sections
    ctx = build_context(
        config, "investigate", _state(), scratchpad=pad, counter=COUNT, budget=5000
    )
    assert "investigator reasoning" in ctx.sections["scratchpad"]


def test_trimming_order(config: BugHunterConfig, tmp_path: Path) -> None:
    pad = Scratchpad(tmp_path / "s.md")
    for i in range(60):
        pad.append_note(f"note {i} " * 5)
    recall = [f"past case {i} " * 10 for i in range(5)]
    ctx = build_context(
        config, "fix", _state(), _app_context(), pad, recall, counter=COUNT, budget=700
    )
    order = ctx.trimmed
    assert order[0].startswith("memory_recall")
    first_pad = next(i for i, t in enumerate(order) if t.startswith("scratchpad"))
    first_app = next(i for i, t in enumerate(order) if t.startswith("app_context"))
    first_state = next(
        (
            i
            for i, t in enumerate(order)
            if t.startswith(("finding", "signal", "root_cause", "repro"))
        ),
        len(order),
    )
    assert all(t.startswith("memory_recall") for t in order[:first_pad])
    assert first_pad < first_app < first_state
    assert ctx.tokens <= ctx.effective
    assert ctx.effective == int(700 * 0.85)


def test_lists_lose_whole_items_with_marker(config: BugHunterConfig) -> None:
    ctx = build_context(config, "investigate", _state(), counter=COUNT, budget=400)
    finding = ctx.sections["finding"]
    assert "more omitted)" in finding
    assert "evidence 0" in finding  # cut from the end, never the start
    assert all(
        not line.strip().endswith("evidence") for line in finding.splitlines()
    )  # no half items


def test_strings_are_cut_at_line_boundaries(config: BugHunterConfig) -> None:
    state = {
        "signal": {
            "source": "issue",
            "ref": "1",
            "raw_summary": "\n".join(f"row {i}" for i in range(200)),
        }
    }
    ctx = build_context(config, "triage", state, counter=COUNT, budget=300)
    summary = ctx.sections["signal"]
    assert "(truncated to fit budget)" in summary
    assert all(
        line.strip().startswith(("source", "ref", "raw_summary", "row ", "…"))
        for line in summary.splitlines()
    )


def test_budget_error_when_nothing_left(config: BugHunterConfig) -> None:
    # three short strings: none is long enough to truncate, together they overflow
    state = {"signal": {"a": "x" * 100, "b": "y" * 100, "c": "z" * 100}}
    with pytest.raises(BudgetError, match="nothing left to trim"):
        build_context(config, "triage", state, counter=COUNT, budget=60)
    with pytest.raises(BudgetError, match="unknown node"):
        build_context(config, "nope", {}, counter=COUNT, budget=100)


def test_shrink_rules() -> None:
    assert shrink([1, 2, 3], COUNT) == ([1, 2, "(1 more omitted)"], "item dropped")
    assert shrink([1, 2, "(1 more omitted)"], COUNT) == (
        [1, "(2 more omitted)"],
        "item dropped",
    )
    assert shrink([1], COUNT) is None
    assert shrink({"a": [1, 2], "b": "x"}, COUNT) == (
        {"a": [1, "(1 more omitted)"], "b": "x"},
        "a: item dropped",
    )
    long = "\n".join(["line"] * 100)
    value, what = shrink({"a": [1], "b": long}, COUNT)
    assert what == "b: truncated at a line boundary" and value["b"].endswith(
        "(truncated to fit budget)"
    )
    assert shrink({"a": 1}, COUNT) is None and shrink("short", COUNT) is None
