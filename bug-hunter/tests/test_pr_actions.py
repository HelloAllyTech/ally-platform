"""Chunk 11: the strict gate, the gh client, Open PR and the worker's PR handling
(fakes only: no model, no network, no push)."""

from __future__ import annotations

import subprocess
from contextlib import contextmanager
from pathlib import Path

import pytest

from bug_hunter.graph import routing
from bug_hunter.graph.github import (
    DryRunGitHub,
    GhCliGitHub,
    GitHubUnavailable,
    PullRequest,
    UnavailableGitHub,
    github_client,
)
from bug_hunter.graph.pr_gate import strict_gate_blockers
from bug_hunter.graph.state import (
    BugState,
    Finding,
    Patch,
    Review,
    Signal,
    Verification,
)
from bug_hunter.queue.actions import (
    Action,
    ActionRefused,
    files_in_patch,
    open_pr_from_report,
)
from bug_hunter.queue.store import InMemoryQueue, InMemorySettings, Settings
from bug_hunter.queue.worker import do_actions, real_pr_url
from bug_hunter.reports.store import InMemoryReports, Report
from bug_hunter.signals.dispatcher import RunOutcome
from tests.test_queue_worker import NOW, bug, work

SIGNAL = Signal(source="issue", ref="1", raw_summary="x", reported_by="user")


def _ready(**over) -> BugState:
    """A run that passes every condition of the strict gate."""
    base = dict(
        run_id="r",
        signal=SIGNAL,
        app="ally-be",
        finding=Finding(
            app="ally-be",
            title="80% warning missing",
            category="logic",
            severity="medium",
            suspected_files=["src/x.ts"],
            evidence=["src/x.ts:1"],
            hypothesis="floor on floats",
        ),
        patch=Patch(
            branch="b",
            diff_path="",
            files_changed=["ally-be/src/x.ts"],
            lines_changed=10,
            rationale="micros",
        ),
        verification=Verification(
            repro_passes=True, app_tests_pass=True, lint_pass=True, typecheck_pass=True
        ),
        review=Review(verdict="approve"),
        confidence="high",
        risk_level="low",
        status="reviewed",
    )
    base.update(over)
    return BugState(**base)


def gate(state, prs_today=0):
    return strict_gate_blockers(
        state, max_lines=80, max_prs_per_day=3, prs_today=prs_today
    )


# --- the strict gate -------------------------------------------------------------


def test_the_gate_opens_only_when_every_condition_holds() -> None:
    assert gate(_ready()) == []


@pytest.mark.parametrize(
    "over, words",
    [
        ({"confidence": "medium"}, "confidence is medium"),
        ({"risk_level": "medium"}, "risk is medium"),
        ({"review": Review(verdict="request_changes")}, "review did not approve"),
        ({"disputed": True}, "counterexample is still open"),
        (
            {
                "verification": Verification(
                    repro_passes=True,
                    app_tests_pass=False,
                    lint_pass=True,
                    typecheck_pass=True,
                )
            },
            "verify is not green",
        ),
        (
            {
                "verification": Verification(
                    repro_passes=False,
                    app_tests_pass=True,
                    lint_pass=True,
                    typecheck_pass=True,
                )
            },
            "failing test does not pass",
        ),
    ],
)
def test_each_failed_condition_is_named(over, words) -> None:
    blockers = gate(_ready(**over))
    assert len(blockers) == 1 and words in blockers[0]


def test_big_diffs_security_findings_and_the_daily_cap_ask_a_person() -> None:
    big = _ready()
    big.patch.lines_changed = 81
    assert "81 lines" in gate(big)[0]
    sec = _ready()
    sec.finding.category = "security"
    assert gate(sec) == ["security findings never become public PRs"]
    assert "3 PRs already opened today" in gate(_ready(), prs_today=3)[0]


def test_routing_in_auto_mode_follows_the_gate() -> None:
    assert routing.after_risk_gate(_ready(), "auto") == "open_pr"
    blocked = _ready(pr_gate_blockers=["confidence is medium, not high"])
    assert routing.after_risk_gate(blocked, "auto") == "suggest_fix"
    # a disputed counterexample never becomes a PR, in any mode
    assert routing.after_risk_gate(_ready(disputed=True), "auto") == "suggest_fix"
    assert routing.after_risk_gate(_ready(), "suggested_fix") == "suggest_fix"


# --- the gh client ---------------------------------------------------------------


class FakeGh:
    def __init__(self, out="https://github.com/o/r/pull/42\n", code=0):
        self.calls, self.out, self.code = [], out, code

    def __call__(self, args, env):
        self.calls.append((args, env))
        return subprocess.CompletedProcess(args, self.code, self.out, "boom")


class FakeGit:
    def __init__(self):
        self.pushed, self.branches, self.commits = [], [], []

    def push(self, worktree, branch):
        self.pushed.append(branch)

    def create_branch(self, worktree, app, slug):
        self.branches.append(f"bughunter/{app}/{slug}")

    def commit(self, worktree, message, paths):
        self.commits.append((message, list(paths)))

    @contextmanager
    def clean_checkout(self, parent, name, ref):
        path = Path(parent) / name
        path.mkdir(parents=True, exist_ok=True)
        yield path


def test_gh_client_opens_a_draft_against_master_with_the_app_token(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("BUGHUNTER_GITHUB_TOKEN", "app-token")
    gh = FakeGh()
    client = GhCliGitHub(
        repo="o/r", git=FakeGit(), write_artefact=lambda n, t: tmp_path / n, run=gh
    )
    pr = client.open_draft_pr("bughunter/ally-be/x", "fix(ally-be): x", "body")
    args, env = gh.calls[0]
    assert args[:3] == ["gh", "pr", "create"] and "--draft" in args
    assert args[args.index("--base") + 1] == "master"
    assert args[-2:] == ["-R", "o/r"]
    assert env["GH_TOKEN"] == "app-token"
    assert (pr.number, pr.url) == (42, "https://github.com/o/r/pull/42")


def test_gh_client_refuses_a_pr_from_master_and_reports_gh_errors(tmp_path) -> None:
    client = GhCliGitHub(
        repo="o/r",
        git=FakeGit(),
        write_artefact=lambda n, t: tmp_path / n,
        run=FakeGh(code=1),
    )
    with pytest.raises(GitHubUnavailable):
        client.open_draft_pr("master", "t", "b")
    with pytest.raises(GitHubUnavailable, match="boom"):
        client.open_draft_pr("bughunter/ally-be/x", "t", "b")


def test_gh_client_never_files_an_escalation_on_the_public_repo(tmp_path) -> None:
    gh = FakeGh()
    written = {}
    client = GhCliGitHub(
        repo="o/r",
        git=FakeGit(),
        write_artefact=lambda n, t: written.setdefault(n, t),
        run=gh,
    )
    issue = client.create_or_update_issue("t", "b", ["bug"], None)
    assert gh.calls == [] and issue.url == "private-reports-only"
    assert "escalation-issue.md" in written


def test_client_choice() -> None:
    def write(n, t):
        return Path(n)

    assert isinstance(github_client(False, write), DryRunGitHub)
    assert isinstance(
        github_client(True, write, git=FakeGit(), repo="o/r", ready=lambda: True),
        GhCliGitHub,
    )
    # no gh login and no token: refuse rather than half-push
    assert isinstance(
        github_client(True, write, git=FakeGit(), repo="o/r", ready=lambda: False),
        UnavailableGitHub,
    )


# --- Open PR (an admin's click) ----------------------------------------------------

DIFF = """diff --git i/ally-be/src/x.ts w/ally-be/src/x.ts
--- i/ally-be/src/x.ts
+++ w/ally-be/src/x.ts
@@ -1 +1 @@
-a
+b
"""


def _report(**over) -> Report:
    base = dict(
        id=7,
        day="2026-11-21",
        source="reported",
        app="ally-be",
        signal_key="reported:1",
        status="suggested_fix",
        title="80 percent warning missing",
        root_cause="floor on floats",
        patch_diff=DIFF,
        repro={"test_path": "src/x.repro.spec.ts", "source": "it('x', () => {})"},
        finding={"category": "logic", "hypothesis": "floats"},
    )
    base.update(over)
    return Report(**base)


class FakeGitHub:
    name = "fake"

    def __init__(self):
        self.pushed, self.opened = [], []

    def push_branch(self, worktree, branch):
        self.pushed.append(branch)

    def open_draft_pr(self, branch, title, body):
        self.opened.append((branch, title, body))
        return PullRequest(number=5, url="https://github.com/o/r/pull/5", branch=branch)


def test_files_in_patch_reads_the_repo_paths() -> None:
    assert files_in_patch(DIFF) == ["ally-be/src/x.ts"]


def test_open_pr_rebuilds_the_fix_with_its_failing_test(tmp_path) -> None:
    git, github, applied = FakeGit(), FakeGitHub(), []
    url = open_pr_from_report(
        _report(),
        git=git,
        github=github,
        app_path="ally-be",
        runs_dir=tmp_path,
        apply=lambda wt, diff: applied.append(diff),
    )
    assert url == "https://github.com/o/r/pull/5" and applied == [DIFF]
    message, paths = git.commits[0]
    assert message.startswith("fix(ally-be): ")
    assert paths == ["ally-be/src/x.ts", "ally-be/src/x.repro.spec.ts"]
    branch = github.pushed[0]
    assert branch.startswith("bughunter/ally-be/") and branch.endswith("-7")
    assert "A person decides the merge." in github.opened[0][2]


@pytest.mark.parametrize(
    "over",
    [
        {"finding": {"category": "security", "hypothesis": "x"}},
        {"title": "orgs see another tenant's sessions"},
        {"root_cause": "the role check is skipped for platform admins"},
    ],
)
def test_open_pr_never_publishes_security_tenant_or_auth_findings(
    tmp_path, over
) -> None:
    github = FakeGitHub()
    with pytest.raises(ActionRefused, match="never a public PR"):
        open_pr_from_report(
            _report(**over),
            git=FakeGit(),
            github=github,
            app_path="ally-be",
            runs_dir=tmp_path,
            apply=lambda wt, diff: None,
        )
    assert github.pushed == [] and github.opened == []


# --- the worker ---------------------------------------------------------------------


def _queue_with_suggested_fix():
    queue, reports = InMemoryQueue(), InMemoryReports()
    report = reports.add(_report(id=None))
    queue.add(bug("a", status="needs_you"))
    queue.rows[0].report_id = report.id
    return queue, reports


def test_open_pr_action_moves_the_bug_to_in_progress_with_its_pr() -> None:
    queue, reports = _queue_with_suggested_fix()
    queue.actions.append(Action(id=1, bug_id=1, kind="open_pr", requested_by=7))
    results = do_actions(queue, reports, lambda r: "https://github.com/o/r/pull/9")
    assert results == [(1, "done", "https://github.com/o/r/pull/9")]
    b = queue.rows[0]
    assert (b.status, b.pr_number, b.pr_opened_by) == ("pr_open", 9, "admin")
    assert queue.pending_actions() == []


def test_a_refused_or_failed_open_pr_is_recorded_on_the_action() -> None:
    queue, reports = _queue_with_suggested_fix()
    queue.actions.append(Action(id=1, bug_id=1, kind="open_pr"))

    def refuse(report):
        raise ActionRefused("never a public PR: topic: tenant")

    do_actions(queue, reports, refuse)
    assert queue.action_results[1] == ("failed", "never a public PR: topic: tenant")
    assert queue.rows[0].status == "needs_you"


def test_actions_run_before_any_bug_even_when_the_mode_is_off(config) -> None:
    queue, reports = _queue_with_suggested_fix()
    queue.actions.append(Action(id=1, bug_id=1, kind="open_pr"))
    from bug_hunter.queue.worker import work_once
    from tests.test_spend import MemoryLedger

    result = work_once(
        config,
        InMemorySettings(Settings("off")),
        queue,
        reports,
        MemoryLedger(),
        lambda c: None,
        now=NOW,
        open_pr=lambda r: "https://github.com/o/r/pull/3",
    )
    assert result.action == "off" and queue.rows[0].status == "pr_open"


class GateRuns:
    def __init__(self, details):
        self.details = details

    def __call__(self, c):
        return RunOutcome(
            f"run-{c.key}", "awaiting_human", 0.5, "# report\n", details=self.details
        )


def test_a_run_that_opened_a_pr_is_in_progress_with_it(config) -> None:
    from bug_hunter.queue.store import InMemorySettings as S

    queue = InMemoryQueue()
    queue.add(bug("a", status="queued"))
    runs = GateRuns({"pr_url": "https://github.com/o/r/pull/11"})
    result = work(config, S(Settings("manual")), queue, runs)
    b = queue.rows[0]
    assert result.status == "pr_open"
    assert (b.pr_url, b.pr_opened_by) == ("https://github.com/o/r/pull/11", "agent")
    assert queue.prs_opened_since(NOW.replace(hour=0)) >= 0


def test_a_fix_the_gate_held_back_asks_with_the_reasons(config) -> None:
    queue = InMemoryQueue()
    queue.add(bug("a", status="queued"))

    def runs(c):
        return RunOutcome(
            "run-a",
            "suggested_fix",
            0.4,
            "# report\n",
            details={
                "pr_url": "dry-run",
                "pr_gate_blockers": ["confidence is medium, not high"],
            },
        )

    work(config, InMemorySettings(Settings("manual")), queue, runs)
    b = queue.rows[0]
    assert b.status == "needs_you" and b.pr_url is None
    assert b.reason == "asks you before a PR: confidence is medium, not high"


def test_dry_run_placeholders_are_not_pr_links() -> None:
    assert real_pr_url("dry-run") is None
    assert (
        real_pr_url("https://github.com/o/r/pull/1") == "https://github.com/o/r/pull/1"
    )


def test_the_output_mode_can_be_switched_by_env(monkeypatch) -> None:
    from bug_hunter.config import ConfigError, load_config

    assert load_config(env={}).limits.pr.output_mode == "auto"
    cfg = load_config(env={"BUGHUNTER_PR_OUTPUT_MODE": "suggested_fix"})
    assert cfg.limits.pr.output_mode == "suggested_fix"
    with pytest.raises(ConfigError):
        load_config(env={"BUGHUNTER_PR_OUTPUT_MODE": "yolo"})
