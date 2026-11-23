"""review.v4: evidence-only review, counterexample tests run by code, fixer disputes.

Reuses the chunk 06 fixture repo (ally-be, ``x()`` returns 0 instead of 3). The main
runner and the clean-checkout runner answer per test file, so each test scripts what
the reproduction and each counterexample do on the buggy code and on the fix.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import InMemorySaver

from bug_hunter.graph import routing
from bug_hunter.graph.nodes.challenge import counterexample_path
from bug_hunter.graph.nodes.reproduce import RightReasonJudgement
from bug_hunter.graph.nodes.review import ReviewV4
from bug_hunter.graph.state import BugState, Counterexample, ProposedCounterexample
from tests.fakes import ScriptedRunner, ai, run_result, structured
from tests.test_graph_chunk06 import (  # noqa: F401 - fixtures
    EDIT_FIX,
    RUN_REPRO,
    SIGNAL,
    SUBMIT_FIX,
    _deps,
    _isolated_caches,
    _run,
    repo,
)

REPRO = "src/x.repro.spec.ts"
CE1 = "src/x.ce1.spec.ts"
CE2 = "src/x.ce2.spec.ts"
FAIL_SYMPTOM = run_result("ally-be", False, "● x › returns 3 for y\n expect 3 got 0")
SETUP_FAIL = run_result(
    "ally-be", False, "Test suite failed to run\n Cannot find module './nope'"
)
PASS = run_result("ally-be", True)
JUDGE_OK = structured(RightReasonJudgement(related=True, why="the reported symptom"))
JUDGE_NO = structured(RightReasonJudgement(related=False, why="about naming"))


class KeyedRunner(ScriptedRunner):
    """``run_tests`` answers per target file; each file's list is consumed in order
    (the last answer repeats)."""

    def __init__(self, by_target: dict[str, list]):
        super().__init__("ally-be", [PASS])
        self.by_target = {k: list(v) for k, v in by_target.items()}

    def run_tests(self, target=None, name=None):
        self.calls.append((target, name))
        answers = self.by_target.get(target) or [PASS]
        return answers.pop(0) if len(answers) > 1 else answers[0]


def review(verdict="approve", ces=(), notes=(), issues=()):
    return structured(
        ReviewV4(
            verdict=verdict,
            issues=list(issues),
            counterexamples=[
                ProposedCounterexample(test_name=n, code=f"it('{n}', ...)\n", claim=c)
                for n, c in ces
            ],
            notes=list(notes),
        ),
        model="gemini-2.5-pro",
    )


def v4_deps(
    config,
    repo,
    tmp_path,
    fix_script,
    reviews,
    on_fix: dict[str, list],
    on_buggy: dict[str, list],
    output_mode="suggested_fix",
):
    deps = _deps(
        config,
        repo,
        tmp_path,
        fix_script,
        review_script=reviews,
        saver=InMemorySaver(),
        output_mode=output_mode,
        review_prompt="v4",
    )
    deps.runner = KeyedRunner({REPRO: [FAIL_SYMPTOM, PASS], **on_fix})
    buggy = KeyedRunner(on_buggy)
    deps.baseline_runner = lambda wt, root: buggy
    return deps


def artefact(tmp_path, name):
    return (tmp_path / "artefacts" / name).read_text()


# --- naming and routing ------------------------------------------------------------


def test_counterexample_files_follow_the_repro_naming() -> None:
    assert counterexample_path("src/x.repro.spec.ts", 1) == "src/x.ce1.spec.ts"
    assert counterexample_path("src/a/b.spec.tsx", 2) == "src/a/b.ce2.spec.tsx"
    assert (
        counterexample_path("tests/test_x_repro.py", 1) == "tests/test_x_repro_ce1.py"
    )
    assert counterexample_path("test/x_test.dart", 3) == "test/x_ce3_test.dart"


def _state(**kw) -> BugState:
    return BugState(run_id="r", signal=SIGNAL, **kw)


def test_routing_for_v4_verdicts() -> None:
    from bug_hunter.graph.state import Review

    kept = Counterexample(
        name="ce1",
        test_path=CE1,
        test_name="t",
        code="c",
        claim="c",
        proposed_at_attempt=1,
        status="passed",
    )
    ce = Review(verdict="counterexamples")
    ok = Review(verdict="approve")
    assert routing.after_review(_state(status="challenging", review=ce)) == "challenge"
    assert routing.after_review(_state(status="reviewed", review=ok)) == "risk_gate"
    # kept counterexamples re-run on every later fix, even after a plain approve
    assert (
        routing.after_review(
            _state(status="reviewed", review=ok, counterexamples=[kept])
        )
        == "challenge"
    )
    assert routing.after_challenge(_state(status="fixing")) == "fix"
    assert routing.after_challenge(_state(status="reviewed")) == "risk_gate"
    assert routing.after_fix(_state(status="reviewed")) == "risk_gate"
    # a disputed run never becomes a PR, whatever the output mode
    assert routing.after_risk_gate(_state(status="reviewed", disputed=True), "pr") == (
        "suggest_fix"
    )


# --- the graph -----------------------------------------------------------------------


def test_v4_approve_ends_as_a_suggested_fix_with_notes(config, repo, tmp_path) -> None:
    deps = v4_deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX],
        [review(notes=["the limit could be a named constant"])],
        {},
        {},
    )
    _, state = _run(deps)
    assert state.status == "suggested_fix", state.stop_reason
    assert state.counterexamples == [] and not state.disputed
    assert "- the limit could be a named constant" in artefact(
        tmp_path, "suggested-fix.md"
    )


def test_v4_reject_is_only_for_drift(config, repo, tmp_path) -> None:
    deps = v4_deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX],
        [review("reject_drift", issues=["finding drifted from the report: …"])],
        {},
        {},
    )
    _, state = _run(deps)
    assert state.status == "escalated"
    assert state.stop_reason.startswith("review rejected (drift):")


def test_counterexamples_that_prove_nothing_are_dropped(config, repo, tmp_path) -> None:
    """Passes on the buggy code; setup failure on the buggy code; genuine failure the
    judge says is not the reported problem. None of them reaches the fix."""
    deps = v4_deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX, JUDGE_NO],
        [
            review(
                "counterexamples",
                ces=[("passes", "a"), ("setup", "b"), ("unrelated", "c")],
            )
        ],
        {},
        {CE1: [PASS], CE2: [SETUP_FAIL], "src/x.ce3.spec.ts": [FAIL_SYMPTOM]},
    )
    _, state = _run(deps)
    assert state.status == "suggested_fix", state.stop_reason
    reasons = {c.name: (c.status, c.reason) for c in state.counterexamples}
    assert reasons["ce1"][0] == "dropped" and "passed" in reasons["ce1"][1]
    assert reasons["ce2"][0] == "dropped" and "could not run" in reasons["ce2"][1]
    assert reasons["ce3"] == ("dropped", "wrong reason: about naming")
    assert state.attempts == 1  # nothing sent the fix back
    # never run against the fix, and no counterexample file left in the worktree
    assert not any(t in (CE1, CE2) for t, _ in deps.runner.calls)
    assert not (repo / "ally-be" / CE1).exists()


def test_at_most_three_counterexamples(config, repo, tmp_path) -> None:
    deps = v4_deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX],
        [review("counterexamples", ces=[(f"t{i}", "c") for i in range(5)])],
        {},
        {},  # all pass on the buggy code: dropped
    )
    _, state = _run(deps)
    assert len(state.counterexamples) == 3


def test_a_kept_counterexample_the_fix_passes_becomes_an_extra_test(
    config, repo, tmp_path
) -> None:
    deps = v4_deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX, JUDGE_OK],
        [review("counterexamples", ces=[("x returns 3 for y", "y — returns 0")])],
        {CE1: [PASS]},
        {CE1: [FAIL_SYMPTOM]},
    )
    _, state = _run(deps)
    assert state.status == "suggested_fix", state.stop_reason
    (ce,) = state.counterexamples
    assert ce.status == "passed" and ce.failed_on_fix == 0 and state.attempts == 1
    report = artefact(tmp_path, "suggested-fix.md")
    assert "## Extra regression tests" in report and "x returns 3 for y" in report


def test_a_failing_counterexample_sends_the_fix_back_as_an_attempt(
    config, repo, tmp_path
) -> None:
    run_ce = ai(tool_calls=[{"name": "run_counterexample", "args": {"name": "ce1"}}])
    deps = v4_deps(
        config,
        repo,
        tmp_path,
        [
            EDIT_FIX,
            RUN_REPRO,
            SUBMIT_FIX,
            JUDGE_OK,
            # attempt 2: sees ce1's failure, runs it, edits, submits
            run_ce,
            ai(
                tool_calls=[
                    {
                        "name": "edit_file",
                        "args": {
                            "path": "src/x.ts",
                            "old_str": "// bug",
                            "new_str": "// fixed for y",
                        },
                    }
                ]
            ),
            SUBMIT_FIX,
        ],
        [
            review("counterexamples", ces=[("x returns 3 for y", "y — returns 0")]),
            review("approve"),
        ],
        {CE1: [FAIL_SYMPTOM, FAIL_SYMPTOM, PASS]},
        {CE1: [FAIL_SYMPTOM]},
    )
    _, state = _run(deps)
    assert state.status == "suggested_fix", state.stop_reason
    assert state.attempts == 2
    (ce,) = state.counterexamples
    assert ce.status == "passed" and ce.failed_on_fix == 1
    fix_messages = deps.models["fix"].calls
    assert any(
        "still FAIL with your fix" in str(m.content) for c in fix_messages for m in c
    )
    assert not (repo / "ally-be" / CE1).exists()


def test_out_of_attempts_with_a_failing_counterexample_escalates(
    config, repo, tmp_path
) -> None:
    limits = config.limits.model_copy(
        update={"run": config.limits.run.model_copy(update={"max_fix_attempts": 1})}
    )
    deps = v4_deps(
        config.model_copy(update={"limits": limits}),
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX, JUDGE_OK],
        [review("counterexamples", ces=[("x returns 3 for y", "y — returns 0")])],
        {CE1: [FAIL_SYMPTOM]},
        {CE1: [FAIL_SYMPTOM]},
    )
    _, state = _run(deps)
    assert state.status == "escalated"
    assert "counterexamples still fail" in state.stop_reason and "ce1" in (
        state.stop_reason
    )


def _wrong_expected_value_run(config, repo, tmp_path, output_mode="suggested_fix"):
    """The reviewer's test expects -1 where the report says 3 (a wrong expected value).
    The judge is fooled and keeps it; it fails on the fix; the fixer disputes it."""
    dispute = ai(
        tool_calls=[
            {
                "name": "dispute_counterexample",
                "args": {
                    "name": "ce1",
                    "reason": "the report says x() must return 3; this test expects -1",
                },
            }
        ]
    )
    again = ai(
        tool_calls=[
            {
                "name": "dispute_counterexample",
                "args": {"name": "ce1", "reason": "again"},
            }
        ]
    )
    deps = v4_deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX, JUDGE_OK, dispute, again, SUBMIT_FIX],
        [review("counterexamples", ces=[("x returns -1", "x() — should return -1")])],
        {CE1: [FAIL_SYMPTOM]},
        {CE1: [FAIL_SYMPTOM]},
        output_mode=output_mode,
    )
    return deps, _run(deps)[1]


def test_a_wrong_expected_value_is_disputed_and_does_not_send_the_fix_back(
    config, repo, tmp_path
) -> None:
    deps, state = _wrong_expected_value_run(config, repo, tmp_path)
    assert state.status == "suggested_fix", state.stop_reason
    assert state.disputed and state.attempts == 1  # no attempt spent on the dispute
    assert state.confidence == "low"  # medium -> low, one level
    (ce,) = state.counterexamples
    assert ce.status == "disputed" and "must return 3" in ce.dispute_reason
    # one dispute per counterexample: the second call is refused
    tool_texts = [
        str(m.content)
        for c in deps.models["fix"].calls
        for m in c
        if getattr(m, "type", "") == "tool"
    ]
    assert any("already disputed" in t for t in tool_texts)
    report = artefact(tmp_path, "suggested-fix.md")
    for part in (
        "Reviewer counterexample disputed",
        "x returns -1",
        "x() — should return -1",
        "the report says x() must return 3",
    ):
        assert part in report, part
    assert "(reviewer counterexample disputed)" in artefact(tmp_path, "report.md")
    # the suggested patch is still the verified fix
    assert artefact(tmp_path, "suggested-fix.patch").startswith("diff --git")


def test_a_disputed_run_never_opens_a_pr(config, repo, tmp_path) -> None:
    deps, state = _wrong_expected_value_run(config, repo, tmp_path, output_mode="pr")
    assert state.status == "suggested_fix" and state.pr_url is None
    assert deps.approval_store().get("run-c06") is None


def test_eval_counts_and_report_line(config, repo, tmp_path) -> None:
    from bug_hunter.graph.output import counterexample_counts
    from evals.metrics import CaseResult, aggregate, render_markdown

    _, state = _wrong_expected_value_run(config, repo, tmp_path)
    counts = counterexample_counts(state)
    assert counts == {"proposed": 1, "kept": 1, "failed": 1, "disputed": 1}
    row = CaseResult(
        "c1",
        "ally-be",
        "bug",
        "fix",
        "detected",
        review_verdicts=["counterexamples"],
        counterexamples=counts,
        disputed=True,
        final_outcome="suggested_fix",
    )
    md = render_markdown(
        {
            "meta": {
                "agent": "graph",
                "mode": "issue",
                "git_sha": "0" * 12,
                "prompt_versions": "",
                "models": {},
                "timestamp": "t",
                "cases": 1,
            },
            "metrics": {k: m.to_dict() for k, m in aggregate([row]).items()},
            "cases": [row.to_dict()],
        }
    )
    assert "| 1/1/1/1 |" in md and "suggested_fix (disputed)" in md
    assert (
        "Counterexamples: proposed 1, kept 1, failed on a fix 1, disputed 1 "
        "· runs with a dispute: 1 of 1 reviewed" in md
    )
