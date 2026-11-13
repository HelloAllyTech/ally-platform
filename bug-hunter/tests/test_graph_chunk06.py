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
from bug_hunter.graph.state import BugState, Review, Signal
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


def _with_output_mode(config, mode: str):
    pr = config.limits.pr.model_copy(update={"output_mode": mode})
    limits = config.limits.model_copy(update={"pr": pr})
    return config.model_copy(update={"limits": limits})


def _deps(
    config,
    repo,
    tmp_path,
    fix_script,
    review_script=None,
    investigate=None,
    saver=None,
    output_mode="pr",  # these tests exercise the PR + approval path
) -> GraphDeps:
    cfg = _with_output_mode(config, output_mode).model_copy(update={"repo_root": repo})
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
    deps = GraphDeps(
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
        # the baseline runs in a clean checkout; scripted to pass unless a test says so
        baseline_runner=lambda wt, root: ScriptedRunner(
            "ally-be", [run_result("ally-be", True)]
        ),
    )
    return deps


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


def test_default_output_mode_is_suggested_fix(config) -> None:
    assert config.limits.pr.output_mode == "suggested_fix"


def test_suggested_fix_mode_ends_with_a_report_and_no_pr(
    config, repo, tmp_path
) -> None:
    saver = InMemorySaver()
    deps = _deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX],
        saver=saver,
        output_mode="suggested_fix",
    )
    _, state = _run(deps, saver)
    assert state.status == "suggested_fix", state.stop_reason
    assert state.review and state.review.verdict == "approve"
    # no branch, commit, PR or approval request
    assert state.pr_url is None and state.pr_branch is None
    assert _git(repo, "rev-parse", "--abbrev-ref", "HEAD") != (
        "bughunter/ally-be/x-returns-0"
    )
    assert deps.github is None or deps.github.actions == []
    assert deps.approval_store().get("run-c06") is None
    art = tmp_path / "artefacts"
    assert not (art / "pr-body.md").exists() and not (art / "pr-branch.txt").exists()
    assert (art / "suggested-fix.patch").read_text().startswith("diff --git")
    suggested = (art / "suggested-fix.md").read_text()
    for section in (
        "## Root cause",
        "## Verified failing test",
        "x.repro.spec.ts::x returns 3",
        "## Suggested patch",
        "```diff",
        "## Reviewer notes",
    ):
        assert section in suggested, section
    report = (art / "report.md").read_text()
    assert "# Run run-c06: suggested_fix" in report and "## Suggested patch" in report


def test_reviewer_notes_carry_issues_and_regression_risks() -> None:
    from bug_hunter.graph.output import reviewer_notes

    state = BugState(
        run_id="r",
        signal=SIGNAL,
        review=Review(
            verdict="approve",
            issues=["hardcoded 20"],
            regression_risks=["callers that pass null"],
        ),
    )
    assert reviewer_notes(state) == [
        "hardcoded 20",
        "regression risk: callers that pass null",
    ]


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


def test_verify_formats_only_the_changed_files_then_lints(
    config, repo, tmp_path
) -> None:
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, SUBMIT_FIX])
    seen = []

    def formatter(command):
        seen.append(command)
        x = repo / "ally-be/src/x.ts"
        x.write_text(
            x.read_text().replace("return 3; // bug", "return 3; // bug (formatted)")
        )

    deps.runner.format_hook = formatter
    _, state = _run(deps)
    assert state.status == "awaiting_human", state.stop_reason
    assert deps.runner.format_calls == ["npx prettier --write src/x.ts"]
    # the diff was re-measured after formatting and the formatted patch is the one kept
    assert state.patch.lines_changed == 2 and state.patch.diff_path.endswith(
        "formatted.patch"
    )
    assert "(formatted)" in (tmp_path / "artefacts" / "fix.patch").read_text()
    # lint ran after formatting, on the formatted tree
    assert any("prettier --write" in c for c in deps.runner.format_calls)


def test_formatting_that_blows_the_line_cap_escalates(config, repo, tmp_path) -> None:
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, SUBMIT_FIX])

    def formatter(command):
        x = repo / "ally-be/src/x.ts"
        x.write_text(
            x.read_text() + "\n".join(f"// line {i}" for i in range(100)) + "\n"
        )

    deps.runner.format_hook = formatter
    _, state = _run(deps)
    assert (
        state.status == "escalated"
        and "fix too large after formatting" in state.stop_reason
    )


def test_ally_mobile_is_never_formatted(config, tmp_path) -> None:
    from bug_hunter.config import ConfigError, load_config
    from bug_hunter.graph.nodes.verify import format_changed_files

    mobile = config.app("ally-mobile")
    assert mobile.format_files is None and mobile.lang == "dart"
    deps = GraphDeps(
        config=config,
        run_id="r",
        app="ally-mobile",
        mode="issue",
        worktree=tmp_path,
        app_root=tmp_path,
        workspace=None,
        models={},
        scratchpad=Scratchpad(tmp_path / "pad.md"),
        write_artefact=lambda n, c: tmp_path / n,
        runner=ScriptedRunner("ally-mobile", [run_result("ally-mobile", True)]),
    )
    assert format_changed_files(deps, ["lib/a.dart"]) is None
    assert deps.runner.format_calls == []
    # and the config refuses a formatter for a dart app at load time
    import yaml

    cfg_dir = tmp_path / "config"
    import shutil

    shutil.copytree(config.config_dir, cfg_dir)
    apps = yaml.safe_load((cfg_dir / "apps.yaml").read_text())
    apps["apps"]["ally-mobile"]["format_files"] = "dart format {files}"
    (cfg_dir / "apps.yaml").write_text(yaml.safe_dump(apps))
    with pytest.raises(ConfigError):
        load_config(config_dir=cfg_dir, repo_root=config.repo_root, env={})


def test_safety_words_in_the_findings_prose_do_not_escalate_precheck(
    config, repo, tmp_path
) -> None:
    """Keywords are checked on changed code (risk_gate), not on quoted evidence."""
    prose = {
        **FINDING,
        "args": {
            **FINDING["args"],
            "evidence": [
                "src/x.ts:2 — comment: fold ＳＵＩＣＩＤＥ to suicide for NFKC"
            ],
            "hypothesis": "the crisis of the regex is that it misses fullwidth braces",
        },
    }
    deps = _deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, SUBMIT_FIX],
        investigate=ScriptedChatModel(script=[ai(tool_calls=[prose])]),
    )
    _, state = _run(deps)
    assert state.status == "awaiting_human", state.stop_reason
    assert state.risk_level == "low"


def test_bounced_repro_files_are_not_part_of_the_fix_and_stash_works(
    config, repo, tmp_path
) -> None:
    """The 19-case eval crashed in verify when a bounced (untracked) repro attempt was
    listed in files_changed and passed to `git stash push`."""
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, SUBMIT_FIX])
    # a leftover repro attempt from a bounce: untracked, not protected
    (repo / "ally-be/src/x.repro-attempt1.spec.ts").write_text("tests src/x.ts\n")
    _, state = _run(deps)
    assert state.status == "awaiting_human", state.stop_reason
    assert state.patch.files_changed == ["ally-be/src/x.ts"]


# --- risk rules (a) topic and (b) risk-path dependents ---

TIER_CONSTANTS = (
    "export const OWNER_TIERS = ['OWNER'];\n" "export const LABEL = 'members';\n"
)
MEMBER_REPO = (
    "import { OWNER_TIERS } from '../../common/constants/team.constants';\n"
    "export class MemberRepository {\n"
    "  listVisible(rows: { tier: string }[]) {\n"
    "    return rows.filter((r) => !OWNER_TIERS.includes(r.tier));\n"
    "  }\n"
    "}\n"
)


@pytest.fixture
def tier_repo(tmp_path: Path):
    """The 87c6ecb8 shape with invented names: a constant outside the risk paths, used
    by a repository under src/user/ (a risk path)."""
    root = tmp_path / "tier"
    (root / "ally-be/src/common/constants").mkdir(parents=True)
    (root / "ally-be/src/user/repository").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text("{}")
    (root / "ally-be/src/common/constants/team.constants.ts").write_text(TIER_CONSTANTS)
    (root / "ally-be/src/user/repository/member.repository.ts").write_text(MEMBER_REPO)
    (root / "ally-be/src/x.ts").write_text(SRC_BUGGY)
    _git(root, "init", "-q", "-b", "master")
    _git(root, "add", ".")
    _git(root, "commit", "-qm", "init")
    return root


def _tier_deps(config, root, tmp_path, finding_title, edit):
    from bug_hunter.context.repo_map import build_map

    finding = {
        **FINDING,
        "args": {
            **FINDING["args"],
            "title": finding_title,
            "hypothesis": "the default list filter misses the newest tier",
            "root_cause": "src/common/constants/team.constants.ts:1",
            "suspected_files": ["src/common/constants/team.constants.ts"],
        },
    }
    deps = _deps(
        config,
        root,
        tmp_path,
        [edit, SUBMIT_FIX],
        investigate=ScriptedChatModel(script=[ai(tool_calls=[finding])]),
    )
    cfg = config.model_copy(update={"repo_root": root})
    deps.repo_map, _ = build_map(cfg, "ally-be", root=root, cache_root=tmp_path / "map")
    return deps


EDIT_TIERS = ai(
    tool_calls=[
        {
            "name": "edit_file",
            "args": {
                "path": "src/common/constants/team.constants.ts",
                "old_str": "['OWNER']",
                "new_str": "['OWNER', 'STAFF']",
            },
        }
    ]
)


def test_risk_gate_escalates_a_change_used_by_a_risk_path(
    config, tier_repo, tmp_path
) -> None:
    deps = _tier_deps(
        config, tier_repo, tmp_path, "list filter misses the newest tier", EDIT_TIERS
    )
    _, state = _run(deps)
    assert state.review and state.review.verdict == "approve"  # reviewer was fine
    assert state.status == "escalated" and state.risk_level == "human_only"
    assert (
        "used by risk-path ally-be/src/user/repository/member.repository.ts"
        in state.stop_reason
    )
    assert "imports OWNER_TIERS" in state.stop_reason and state.pr_url is None


def test_a_change_nobody_risky_uses_is_not_escalated(
    config, tier_repo, tmp_path
) -> None:
    edit_label = ai(
        tool_calls=[
            {
                "name": "edit_file",
                "args": {
                    "path": "src/common/constants/team.constants.ts",
                    "old_str": "'members'",
                    "new_str": "'people'",
                },
            }
        ]
    )
    deps = _tier_deps(config, tier_repo, tmp_path, "list label is wrong", edit_label)
    _, state = _run(deps)
    assert state.status == "awaiting_human", state.stop_reason
    assert state.risk_level == "low"


@pytest.mark.parametrize(
    "title",
    [
        "tenant admin sees accounts from another organisation",
        "permission check skipped for archived members",
        "auth guard accepts an expired session",
        "export exposes user records to the wrong team",
    ],
)
def test_topic_makes_a_finding_human_only_whatever_the_paths(
    config, repo, tmp_path, title
) -> None:
    topical = {**FINDING, "args": {**FINDING["args"], "title": title}}
    deps = _deps(
        config,
        repo,
        tmp_path,
        [EDIT_FIX, SUBMIT_FIX],
        investigate=ScriptedChatModel(script=[ai(tool_calls=[topical])]),
    )
    _, state = _run(deps)
    assert state.status == "escalated" and state.risk_level == "human_only"
    assert "topic:" in state.stop_reason and state.patch is None


def test_topic_rule_ignores_lookalikes() -> None:
    from bug_hunter.graph.risk import topic_hits

    assert topic_hits("translation token guard rejects placeholders") == []
    assert topic_hits("author name is truncated in the byline") == []
    assert topic_hits("x returns 0", "", "src/x.ts:2") == []


def test_review_sees_the_scrubbed_signal(config, repo, tmp_path) -> None:
    deps = _deps(config, repo, tmp_path, [EDIT_FIX, SUBMIT_FIX])
    _, state = _run(deps)
    system = deps.models["review"].calls[0][0].content
    assert "x() returns 0 not 3" in system  # the report, next to the finding


# --- ally-web reproduce fixes (f35e117d path prefix, 3b3db9b5 setup) --------------------  # noqa: E501


def test_app_prefixed_test_paths_land_in_the_app(config, repo, tmp_path) -> None:
    deps = _deps(config, repo, tmp_path, [])
    out = deps.workspace.write_test_file(
        "ally-be/src/y.repro.spec.ts", "tests src/x.ts\n"
    )
    assert (repo / "ally-be/src/y.repro.spec.ts").exists()
    assert not (repo / "ally-be/ally-be").exists()
    assert "run_tests(target='src/y.repro.spec.ts')" in out
    assert "export const x" in deps.workspace.read_file("ally-be/src/x.ts")


@pytest.mark.parametrize(
    "excerpt",
    [
        "TypeError: Cannot destructure property 'user' of 'useUser(...)' as it is undefined.",  # noqa: E501
        "Error: useGuide must be used within a GuideProvider",
        "TypeError: Cannot read properties of undefined (reading 'id')",
        "Error: No QueryClient set, use QueryClientProvider to set one",
    ],
)
def test_missing_provider_is_a_setup_failure(config, excerpt) -> None:
    from bug_hunter.graph.failure import classify_failure

    assert (
        classify_failure(config.app("ally-web"), run_result("ally-web", False, excerpt))
        == "setup"
    )


def test_setup_failure_bounces_back_then_reproduces(config, repo, tmp_path) -> None:
    deps = _deps(config, repo, tmp_path, [GIVE_UP])
    deps.models["fix"].script[2:2] = [SUBMIT_REPRO]  # one resubmission after the bounce
    deps.runner.results = [
        run_result(
            "ally-be",
            False,
            "TypeError: Cannot destructure property 'user' of 'useUser(...)' as it is undefined.",  # noqa: E501
        ),
        run_result("ally-be", False, "● x returns 3\n expect 3 got 0"),
    ]
    _, state = _run(deps)
    assert state.repro_attempts == 1 and state.repro.failure_kind == "genuine"
    bounce = [
        m
        for c in deps.models["fix"].calls
        for m in c
        if m.type == "human" and "SETUP" in str(m.content).upper()
    ]
    assert bounce and "FAILED BEFORE REACHING THE BEHAVIOUR" in str(bounce[0].content)


def test_neighbour_test_setup_is_the_part_before_the_first_test(
    config, repo, tmp_path
) -> None:
    from bug_hunter.graph.tools import neighbour_test_setup

    (repo / "ally-be/src/__tests__").mkdir()
    (repo / "ally-be/src/__tests__/x.test.ts").write_text(
        "import { x } from '../x';\nvi.mock('../hooks/useUser', () => ({ useUser: () => ({ user: {} }) }));\n\n"  # noqa: E501
        "describe('x', () => {\n  it('a', () => {});\n});\n"
    )
    deps = _deps(config, repo, tmp_path, [])
    text = neighbour_test_setup(deps, ["src/x.ts"])
    assert "vi.mock('../hooks/useUser'" in text and "describe(" not in text
    assert "x.test.ts" in text
    assert neighbour_test_setup(deps, ["src/none/y.ts"]).startswith("(no existing test")


def test_reproduce_v5_receives_the_neighbour_setup(config, repo, tmp_path) -> None:
    (repo / "ally-be/src/__tests__").mkdir()
    (repo / "ally-be/src/__tests__/x.test.ts").write_text(
        "vi.mock('./marker-module');\ndescribe('x', () => {});\n"
    )
    models = config.models.model_copy(
        update={"prompts": {**config.models.prompts, "reproduce": "v5"}}
    )
    deps = _deps(
        config.model_copy(update={"models": models}), repo, tmp_path, [GIVE_UP]
    )
    _run(deps)
    system = next(
        c[0].content
        for c in deps.models["fix"].calls
        if "reproduction step" in c[0].content
    )
    assert "vi.mock('./marker-module')" in system


def test_orphan_sweep_ignores_non_run_folders(config, tmp_path) -> None:
    from bug_hunter.runs import clean_orphans

    runs = tmp_path / "home"
    (runs / "src" / "bug-hunter").mkdir(parents=True)
    (runs / "src" / "keep.txt").write_text("x")
    clean_orphans(
        config,
        runs_dir=runs,
        docker=lambda *a, **k: type("R", (), {"ok": True, "stdout": ""})(),
    )
    assert (runs / "src" / "keep.txt").exists()


def test_clean_checkout_is_separate_and_removed(repo) -> None:
    git = Git(repo)
    (repo / "ally-be/src/x.ts").write_text(SRC_FIXED)  # the fix, uncommitted
    parent = repo.parent / "scratch"
    with git.clean_checkout(parent, "baseline", "HEAD") as clean:
        assert (clean / "ally-be/src/x.ts").read_text() == SRC_BUGGY
        assert (repo / "ally-be/src/x.ts").read_text() == SRC_FIXED
    assert not any(parent.glob("baseline*")) if parent.exists() else True
    assert "scratch" not in _git(repo, "worktree", "list")
    assert _git(repo, "stash", "list") == ""  # the shared stash stack is untouched


def test_neighbour_setup_is_capped_at_a_statement_end() -> None:
    from bug_hunter.graph.tools import TEMPLATE_MAX_LINES, cap_setup

    lines = ["import { a } from 'a';"] * (TEMPLATE_MAX_LINES - 2) + [
        "vi.mock('../hooks/useUser', () => ({",
        "  useUser: () => ({ user: {} }),",
        "}));",
    ]
    out = cap_setup(lines, lambda text: len(text) // 3)
    assert out[-1].startswith("// … (rest")
    assert "vi.mock('../hooks/useUser', () => ({" not in out  # never cut mid-mock
    assert len(out) <= TEMPLATE_MAX_LINES + 1
    small = ["import x from 'x';", "vi.mock('y');"]
    assert cap_setup(small, lambda t: 1) == small
    tokens = cap_setup(["const a = 1;"] * 50, lambda text: len(text.splitlines()) * 100)
    assert len(tokens) == 31 and tokens[-1].startswith("// …")  # 30 lines = 3000 tokens


def test_clean_checkout_cleanup_never_raises(repo, monkeypatch) -> None:
    """On Linux the sandbox leaves root-owned files the host cannot delete; the
    checkout must still close cleanly and the next one must work."""
    from bug_hunter.tools.git import GitError

    git = Git(repo)
    parent = repo.parent / "scratch2"
    real_remove = Git.remove_worktree

    def failing_remove(self, path):
        raise GitError("git worktree remove failed (255): Permission denied")

    monkeypatch.setattr(Git, "remove_worktree", failing_remove)
    with git.clean_checkout(parent, "baseline", "HEAD") as first:
        assert first.exists()
    monkeypatch.setattr(Git, "remove_worktree", real_remove)
    with git.clean_checkout(parent, "baseline", "HEAD") as second:
        assert second != first and (second / "ally-be/src/x.ts").exists()
