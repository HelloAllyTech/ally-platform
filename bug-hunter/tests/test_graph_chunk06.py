"""Chunk 06 end to end with scripted models: fix → verify → review → risk_gate →
open_pr (dry-run) → human_approval (interrupt) → resume. Proves: risky paths never
reach fix, existing tests cannot be edited, the line cap and forbidden test changes
escalate, attempts stop at 3, nothing is pushed, PRs are drafts, branch names follow
the pattern, the reviewer never sees the scratchpad, risk_gate re-checks the diff."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.graph import baseline as bl
from bug_hunter.graph.build import build_graph, run_graph
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.github import DryRunGitHub, GitHubUnavailable, UnavailableGitHub
from bug_hunter.graph.nodes.fix import count_changed_lines, forbidden_test_changes
from bug_hunter.graph.nodes.reproduce import RightReasonJudgement
from bug_hunter.graph.nodes.triage import TriageDecision
from bug_hunter.graph.risk import keyword_hits, risk_level
from bug_hunter.graph.state import Review, Signal
from bug_hunter.tools.fs import Workspace
from bug_hunter.tools.git import Git
from tests.fakes import ScriptedChatModel, ScriptedRunner, ai, run_result, structured

SIGNAL = Signal(
    source="issue", ref="i1", raw_summary="x() returns 0 not 3", reported_by="staff"
)
SRC_BUGGY = "export const x = () => {\n  return 0; // bug\n};\n"
SRC_FIXED = "export const x = () => {\n  return 3; // bug\n};\n"


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path):
    root = tmp_path / "wt"
    (root / "ally-be/src/auth").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text("{}")
    (root / "ally-be/src/x.ts").write_text(SRC_BUGGY)
    (root / "ally-be/src/auth/guard.ts").write_text("export const g = () => 0;\n")
    (root / "ally-be/src/old.spec.ts").write_text("it('old', () => {});\n")
    _git(root, "init", "-q", "-b", "master")
    _git(root, "add", ".")
    _git(root, "commit", "-qm", "init")
    return root


TRIAGE = structured(
    TriageDecision(
        is_bug_candidate=True,
        app="ally-be",
        severity="medium",
        confidence="medium",
        reason="r",
        kind="bug",
    ),
    model="gpt-5-mini",
)
FINDING = {
    "name": "submit_finding",
    "args": {
        "title": "x returns 0",
        "category": "logic",
        "severity": "medium",
        "suspected_files": ["src/x.ts"],
        "evidence": ["src/x.ts:2 — returns 0"],
        "hypothesis": "h",
        "root_cause": "src/x.ts:2",
        "confidence": "medium",
    },
}
WRITE_REPRO = ai(
    tool_calls=[
        {
            "name": "write_test_file",
            "args": {"path": "src/x.repro.spec.ts", "content": "tests src/x.ts\n"},
        }
    ]
)
SUBMIT_REPRO = ai(
    tool_calls=[
        {
            "name": "submit_repro",
            "args": {
                "test_path": "src/x.repro.spec.ts",
                "test_name": "x returns 3",
                "expected_failure": "0 != 3",
            },
        }
    ]
)
JUDGE_OK = structured(RightReasonJudgement(related=True, why="symptom"))
EDIT_FIX = ai(
    tool_calls=[
        {
            "name": "edit_file",
            "args": {
                "path": "src/x.ts",
                "old_str": "return 0;",
                "new_str": "return 3;",
            },
        }
    ]
)
RUN_REPRO = ai(tool_calls=[{"name": "run_repro_test", "args": {}}])
SUBMIT_FIX = ai(
    tool_calls=[
        {
            "name": "submit_fix",
            "args": {
                "rationale": "return the right value",
                "files_changed": ["src/x.ts"],
            },
        }
    ]
)
GIVE_UP = ai(tool_calls=[{"name": "give_up", "args": {"reason": "needs a human"}}])


def _deps(
    config, repo, tmp_path, fix_script, review_script=None, investigate=None, saver=None
) -> GraphDeps:
    cfg = config.model_copy(update={"repo_root": repo})
    artefacts = tmp_path / "artefacts"
    artefacts.mkdir(exist_ok=True)

    def write_artefact(name, content):
        p = artefacts / name
        p.write_text(content, encoding="utf-8")
        return p

    runner = ScriptedRunner(
        "ally-be",
        [
            run_result("ally-be", False, "● x returns 3\n expect 3 got 0"),
            run_result("ally-be", True),
        ],
    )
    models = {
        "triage": ScriptedChatModel(script=[TRIAGE]),
        "investigate": investigate
        or ScriptedChatModel(script=[ai(tool_calls=[FINDING])]),
        "fix": ScriptedChatModel(
            script=[WRITE_REPRO, SUBMIT_REPRO, JUDGE_OK, *fix_script]
        ),
        "review": ScriptedChatModel(
            script=review_script
            or [structured(Review(verdict="approve"), model="gemini-2.5-pro")]
        ),
    }
    return GraphDeps(
        config=cfg,
        run_id="run-c06",
        app="ally-be",
        mode="issue",
        worktree=repo,
        app_root=repo / "ally-be",
        workspace=Workspace(repo, cfg, "ally-be"),
        models=models,
        scratchpad=Scratchpad(artefacts / "scratchpad.md"),
        write_artefact=write_artefact,
        git=Git(repo),
        runner=runner,
        ref="HEAD",
        checkpointer=saver,
    )


@pytest.fixture(autouse=True)
def _isolated_caches(monkeypatch, tmp_path):
    monkeypatch.setattr(bl, "BASELINE_DIR", tmp_path / "bcache")
    # any attempt to push is a test failure
    monkeypatch.setattr(
        Git,
        "push",
        lambda self, *a, **k: (_ for _ in ()).throw(AssertionError("push called")),
    )


def _run(deps, saver=None):
    saver = saver or deps.checkpointer or InMemorySaver()  # interrupt() needs one
    deps.checkpointer = saver
    graph = build_graph(deps, saver)
    return graph, run_graph(graph, deps, SIGNAL)


def test_happy_path_to_dry_run_pr_and_approval(config, repo, tmp_path) -> None:
    saver = InMemorySaver()
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, RUN_REPRO, SUBMIT_FIX], saver=saver)
    graph, state = _run(deps, saver)
    assert state.status == "awaiting_human", state.stop_reason
    assert (
        state.patch
        and state.patch.files_changed == ["ally-be/src/x.ts"]
        and state.patch.lines_changed == 2
    )
    assert state.verification and state.verification.passed
    assert state.review and state.review.verdict == "approve"
    assert state.risk_level == "low"
    assert (
        state.pr_url == "dry-run" and state.pr_branch == "bughunter/ally-be/x-returns-0"
    )
    assert (repo / "ally-be/src/x.ts").read_text() == SRC_FIXED
    assert (
        _git(repo, "rev-parse", "--abbrev-ref", "HEAD")
        == "bughunter/ally-be/x-returns-0"
    )
    art = tmp_path / "artefacts"
    body = (art / "pr-body.md").read_text()
    assert (
        "## Root cause" in body
        and "x.repro.spec.ts::x returns 3" in body
        and "[x] repro test" in body
    )
    assert (art / "fix.patch").read_text().startswith("diff --git") and (
        art / "pr-branch.txt"
    ).exists()
    assert deps.github.actions == [
        "push bughunter/ally-be/x-returns-0 (dry-run: not pushed)",
        "open draft PR for bughunter/ally-be/x-returns-0 (dry-run)",
    ]
    pending = deps.approval_store().get("run-c06")
    assert pending and pending.status == "pending" and pending.risk_level == "low"
    # resume with the human decision
    final = run_graph(
        graph,
        deps,
        None,
        resume_with={"decision": "approved", "by": "sda", "reason": "looks right"},
    )
    assert final.status == "pr_opened" and final.approval_decision == "approved"
    assert (
        deps.github.actions[-1]
        == "mark ready bughunter/ally-be/x-returns-0, auto-merge=off (dry-run)"
    )
    assert deps.approval_store().get("run-c06").status == "approved"


def test_rejection_closes_the_pr(config, repo, tmp_path) -> None:
    saver = InMemorySaver()
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, SUBMIT_FIX], saver=saver)
    graph, state = _run(deps, saver)
    assert state.status == "awaiting_human"
    final = run_graph(
        graph,
        deps,
        None,
        resume_with={"decision": "rejected", "by": "sda", "reason": "wrong layer"},
    )
    assert final.status == "rejected" and "wrong layer" in final.stop_reason
    assert deps.github.actions[-1].startswith(
        "close PR bughunter/ally-be/x-returns-0: wrong layer"
    )


def test_risky_suspected_files_never_reach_fix(config, repo, tmp_path) -> None:
    risky = {
        **FINDING,
        "args": {**FINDING["args"], "suspected_files": ["src/auth/guard.ts"]},
    }
    deps = _deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX],
        investigate=ScriptedChatModel(script=[ai(tool_calls=[risky])]),
    )
    _, state = _run(deps)
    assert state.status == "escalated" and state.risk_level == "human_only"
    assert "human-only" in state.stop_reason and "src/auth/" in state.stop_reason
    assert state.patch is None and (repo / "ally-be/src/x.ts").read_text() == SRC_BUGGY
    assert deps.models["fix"].cursor == 3  # repro calls only; the fix loop never ran


def test_fix_cannot_edit_tests_and_gives_up(config, repo, tmp_path) -> None:
    edit_test = ai(
        tool_calls=[
            {
                "name": "edit_file",
                "args": {
                    "path": "src/old.spec.ts",
                    "old_str": "it('old'",
                    "new_str": "it.skip('old'",
                },
            }
        ]
    )
    edit_repro = ai(
        tool_calls=[
            {
                "name": "edit_file",
                "args": {
                    "path": "src/x.repro.spec.ts",
                    "old_str": "tests",
                    "new_str": "nope",
                },
            }
        ]
    )
    deps = _deps(config, repo, tmp_path, [edit_test, edit_repro, GIVE_UP])
    _, state = _run(deps)
    assert state.status == "escalated" and state.stop_reason == "fix: needs a human"
    tool_msgs = [m.content for m in deps.models["fix"].calls[-1] if m.type == "tool"]
    assert any("may not edit tests" in t for t in tool_msgs)
    assert (repo / "ally-be/src/old.spec.ts").read_text() == "it('old', () => {});\n"
    assert (repo / "ally-be/src/x.repro.spec.ts").read_text() == "tests src/x.ts\n"


def test_oversized_fix_escalates(config, repo, tmp_path) -> None:
    big = ai(
        tool_calls=[
            {
                "name": "edit_file",
                "args": {
                    "path": "src/x.ts",
                    "old_str": "return 0;",
                    "new_str": "\n".join(f"const a{i} = {i};" for i in range(90))
                    + "\nreturn 3;",
                },
            }
        ]
    )
    deps = _deps(config, repo, tmp_path, [big, SUBMIT_FIX])
    _, state = _run(deps)
    assert state.status == "escalated" and "fix too large" in state.stop_reason
    assert state.patch and state.patch.lines_changed > 80


def test_forbidden_test_changes_and_line_count() -> None:
    diff = (
        "--- a/x\n+++ b/x\n-  it('keeps', () => {});\n+  it.skip('new', () => {});\n"
        "+const y = 1;\n-const z = 2;\n"
    )
    hits = forbidden_test_changes(diff)
    assert (
        len(hits) == 2
        and hits[0].startswith("removes a test")
        and hits[1].startswith("skips a test")
    )
    assert count_changed_lines(diff) == 4


def test_verify_failure_feeds_fix_and_attempts_stop_at_three(
    config, repo, tmp_path
) -> None:
    # repro keeps failing after each "fix": three attempts, then escalate
    deps = _deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, SUBMIT_FIX, SUBMIT_FIX, SUBMIT_FIX, SUBMIT_FIX],
    )
    deps.runner.results = [
        run_result("ally-be", False, "● x returns 3\n still 0")
    ]  # every repro run fails
    _, state = _run(deps)
    assert state.status == "escalated" and state.attempts == 3
    assert state.verification and not state.verification.repro_passes
    prompts = [c[1].content for c in deps.models["fix"].calls if len(c) > 1]
    second = next(p for p in prompts if "Attempt 2 of 3" in p)
    assert "failed verification" in second


def test_review_request_changes_counts_as_an_attempt(config, repo, tmp_path) -> None:
    changes = structured(
        Review(verdict="request_changes", issues=["x.ts:2 — also handle null"]),
        model="gemini-2.5-pro",
    )
    approve = structured(Review(verdict="approve"), model="gemini-2.5-pro")
    deps = _deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, SUBMIT_FIX, SUBMIT_FIX],
        review_script=[changes, approve],
    )
    _, state = _run(deps)
    assert state.status == "awaiting_human" and state.attempts == 2
    fix_prompt_2 = deps.models["fix"].calls[-1][1].content
    assert "reviewer asked for changes" in fix_prompt_2
    assert "also handle null" in fix_prompt_2


def test_review_reject_escalates(config, repo, tmp_path) -> None:
    reject = structured(
        Review(verdict="reject", issues=["wrong root cause"]), model="gemini-2.5-pro"
    )
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, SUBMIT_FIX], review_script=[reject])
    _, state = _run(deps)
    assert state.status == "escalated"
    assert "review rejected: wrong root cause" in state.stop_reason
    assert state.pr_url is None
    assert deps.github.actions == ["create escalation issue (dry-run)"]  # no PR


def test_review_is_blind_to_the_scratchpad(config, repo, tmp_path) -> None:
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, SUBMIT_FIX])
    deps.scratchpad.append_note("SECRET-REASONING-MARKER the investigator thought hard")
    _, state = _run(deps)
    system = deps.models["review"].calls[0][0].content
    assert "SECRET-REASONING-MARKER" not in system
    assert (
        "return 3;" in system and "x.repro.spec.ts" in system
    )  # diff + repro are there
    assert "## Verification" not in system  # the state render, not a PR body


def test_risk_gate_rechecks_the_final_diff_even_after_approval(
    config, repo, tmp_path
) -> None:
    # the fix drifts into a safety keyword: approved by the reviewer, still human-only
    drift = ai(
        tool_calls=[
            {
                "name": "edit_file",
                "args": {
                    "path": "src/x.ts",
                    "old_str": "return 0;",
                    "new_str": "return 3; // crisis path unchanged",
                },
            }
        ]
    )
    deps = _deps(config, repo, tmp_path, [drift, SUBMIT_FIX])
    _, state = _run(deps)
    assert state.review and state.review.verdict == "approve"
    assert state.status == "escalated" and state.risk_level == "human_only"
    assert "safety keyword" in state.stop_reason and state.pr_url is None


def test_risk_rules() -> None:
    assert keyword_hits(
        ["+  if (isCrisis) {", "-  guardrail()", "+ const x = 1", "--- a/f"]
    ) == ["+  if (isCrisis) {", "-  guardrail()"]
    assert (
        risk_level(
            human_only_reasons=["x"],
            lines_changed=1,
            files_changed=1,
            severity="low",
            review_verdict="approve",
        )
        == "human_only"
    )
    assert (
        risk_level(
            human_only_reasons=[],
            lines_changed=1,
            files_changed=1,
            severity="low",
            review_verdict="approve",
        )
        == "low"
    )
    assert (
        risk_level(
            human_only_reasons=[],
            lines_changed=60,
            files_changed=1,
            severity="low",
            review_verdict="approve",
        )
        == "medium"
    )
    assert (
        risk_level(
            human_only_reasons=[],
            lines_changed=60,
            files_changed=5,
            severity="critical",
            review_verdict="approve",
        )
        == "high"
    )


def test_push_requires_the_github_app(tmp_path) -> None:
    client = UnavailableGitHub()
    with pytest.raises(GitHubUnavailable):
        client.open_draft_pr("bughunter/ally-be/x", "t", "b")
    dry = DryRunGitHub(lambda n, c: (tmp_path / n).write_text(c) or tmp_path / n)
    pr = dry.open_draft_pr("bughunter/ally-be/x", "fix(ally-be): x", "body")
    assert pr.draft and pr.url == "dry-run" and (tmp_path / "pr-body.md").exists()


def test_lint_failure_reaches_the_next_fix_attempt_and_exhaustion_has_a_reason(
    config, repo, tmp_path
) -> None:
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, SUBMIT_FIX, SUBMIT_FIX, SUBMIT_FIX])
    lint_fail = run_result(
        "ally-be",
        False,
        "src/x.ts:2:3 error Replace `return 3;` with ... prettier/prettier",
    )
    x_ts = repo / "ally-be/src/x.ts"
    # lint fails only with the fix applied; the baseline (patch stashed) is clean
    deps.runner.run_lint = lambda: (
        lint_fail if "return 3" in x_ts.read_text() else run_result("ally-be", True)
    )
    _, state = _run(deps)
    assert state.status == "escalated" and state.attempts == 3
    assert state.stop_reason.startswith("verification failed after 3 attempts")
    assert "lint FAIL" in state.stop_reason
    prompts = [c[1].content for c in deps.models["fix"].calls if len(c) > 1]
    second = next(p for p in prompts if "Attempt 2 of 3" in p)
    assert "Lint output" in second and "prettier/prettier" in second
    assert "run_lint" in deps.models["fix"].bound_tools[-1]
    verify_md = (tmp_path / "artefacts" / "verify-attempt-1.md").read_text()
    assert "--- lint ---" in verify_md and "prettier/prettier" in verify_md
