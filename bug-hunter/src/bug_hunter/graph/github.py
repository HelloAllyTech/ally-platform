"""GitHub access for open_pr and escalate, behind an interface tests can fake.

The default is **dry-run**: nothing leaves the machine; the branch diff, the PR body
and the issue body are written to the run's artefacts. With ``push``, ``GhCliGitHub``
(chunk 11) uses `gh`, authenticated by the GitHub App's token or a developer's login;
without either, ``UnavailableGitHub`` refuses with a clear message so a misconfigured
run can never push by accident.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol


class GitHubUnavailable(RuntimeError):
    pass


@dataclass
class PullRequest:
    number: int | None
    url: str
    branch: str
    draft: bool = True


@dataclass
class Issue:
    number: int | None
    url: str


class GitHubClient(Protocol):
    name: str

    def push_branch(self, worktree: Path, branch: str) -> None: ...

    def open_draft_pr(self, branch: str, title: str, body: str) -> PullRequest: ...

    def mark_ready(self, pr: PullRequest, auto_merge: bool) -> None: ...

    def close_pr(self, pr: PullRequest, reason: str) -> None: ...

    def create_or_update_issue(
        self, title: str, body: str, labels: list[str], existing: str | None
    ) -> Issue: ...


@dataclass
class DryRunGitHub:
    """Writes what would have been sent; never pushes. ``pr_url`` is ``dry-run``."""

    write_artefact: Callable[[str, str], Path]
    name: str = "dry-run"
    pushed: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)

    def push_branch(self, worktree: Path, branch: str) -> None:
        self.actions.append(f"push {branch} (dry-run: not pushed)")

    def open_draft_pr(self, branch: str, title: str, body: str) -> PullRequest:
        self.write_artefact("pr-body.md", f"# {title}\n\nbranch: `{branch}`\n\n{body}")
        self.actions.append(f"open draft PR for {branch} (dry-run)")
        return PullRequest(number=None, url="dry-run", branch=branch, draft=True)

    def mark_ready(self, pr: PullRequest, auto_merge: bool) -> None:
        self.actions.append(
            f"mark ready {pr.branch}, auto-merge="
            f"{'on' if auto_merge else 'off'} (dry-run)"
        )

    def close_pr(self, pr: PullRequest, reason: str) -> None:
        self.actions.append(f"close PR {pr.branch}: {reason} (dry-run)")

    def create_or_update_issue(
        self, title: str, body: str, labels: list[str], existing: str | None
    ) -> Issue:
        self.write_artefact(
            "escalation-issue.md", f"# {title}\n\nlabels: {', '.join(labels)}\n\n{body}"
        )
        self.actions.append("create escalation issue (dry-run)")
        return Issue(number=None, url="dry-run")


@dataclass
class UnavailableGitHub:
    """Selected when ``--push`` is given but the GitHub App is not configured."""

    name: str = "unavailable"

    def _refuse(self) -> None:
        raise GitHubUnavailable(
            "real GitHub access needs the Ally Bug Hunter GitHub App "
            "(BUGHUNTER_GITHUB_APP_ID, "
            "BUGHUNTER_GITHUB_INSTALLATION_ID, BUGHUNTER_GITHUB_PRIVATE_KEY); none is "
            "configured. Run without --push for a dry run."
        )

    def push_branch(self, worktree: Path, branch: str) -> None:
        self._refuse()

    def open_draft_pr(self, branch: str, title: str, body: str) -> PullRequest:
        self._refuse()
        raise AssertionError("unreachable")

    def mark_ready(self, pr: PullRequest, auto_merge: bool) -> None:
        self._refuse()

    def close_pr(self, pr: PullRequest, reason: str) -> None:
        self._refuse()

    def create_or_update_issue(
        self, title: str, body: str, labels: list[str], existing: str | None
    ) -> Issue:
        self._refuse()
        raise AssertionError("unreachable")


ENV_TOKEN = "BUGHUNTER_GITHUB_TOKEN"  # the App's installation token on the VM

Runner = Callable[
    [list[str], dict[str, str] | None], "subprocess.CompletedProcess[str]"
]


def _run(
    args: list[str], env: dict[str, str] | None
) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(args, capture_output=True, text=True, env=env, timeout=120)


@dataclass
class GhCliGitHub:
    """The real client (chunk 11): `gh` for PRs, the run's Git for the push.

    Authenticated by ``BUGHUNTER_GITHUB_TOKEN`` (the GitHub App's installation token
    on the VM) or, on a developer's machine, their own ``gh`` login. Only draft PRs
    against ``base``; pushes go through ``Git.push``, which refuses anything but a
    ``bughunter/`` branch. Escalations are never filed here: nothing about a finding
    goes to the public repo (the private reports repo has them), so an escalation
    issue is written to the run's artefacts only.
    """

    repo: str
    git: Any
    write_artefact: Callable[[str, str], Path]
    base: str = "master"
    name: str = "github"
    run: Runner = field(default=_run)

    def _env(self) -> dict[str, str]:
        env = dict(os.environ)
        if env.get(ENV_TOKEN):
            env["GH_TOKEN"] = env[ENV_TOKEN]
        return env

    def _gh(self, *args: str) -> str:
        result = self.run(["gh", *args, "-R", self.repo], self._env())
        if result.returncode != 0:
            raise GitHubUnavailable(
                f"gh {args[0]} {args[1] if len(args) > 1 else ''} failed: "
                f"{(result.stderr or result.stdout).strip()[-300:]}"
            )
        return result.stdout.strip()

    def push_branch(self, worktree: Path, branch: str) -> None:
        self.git.push(worktree, branch)

    def open_draft_pr(self, branch: str, title: str, body: str) -> PullRequest:
        if branch in (self.base, "main", "master"):
            raise GitHubUnavailable(f"refusing to open a PR from {branch!r}")
        url = self._gh(
            "pr",
            "create",
            "--draft",
            "--base",
            self.base,
            "--head",
            branch,
            "--title",
            title,
            "--body",
            body,
        ).splitlines()[-1]
        match = re.search(r"/pull/(\d+)", url)
        return PullRequest(
            number=int(match.group(1)) if match else None,
            url=url,
            branch=branch,
            draft=True,
        )

    def mark_ready(self, pr: PullRequest, auto_merge: bool) -> None:
        # auto_merge stays off (CONTEXT.md rule 8): merging is an admin's button
        self._gh("pr", "ready", str(pr.number or pr.branch))

    def close_pr(self, pr: PullRequest, reason: str) -> None:
        self._gh("pr", "close", str(pr.number or pr.branch), "--comment", reason)

    def create_or_update_issue(
        self, title: str, body: str, labels: list[str], existing: str | None
    ) -> Issue:
        self.write_artefact(
            "escalation-issue.md", f"# {title}\n\nlabels: {', '.join(labels)}\n\n{body}"
        )
        return Issue(number=None, url="private-reports-only")


def gh_ready(run: Runner = _run) -> bool:
    """Whether `gh` is installed and can reach GitHub with a token or a login."""
    env = dict(os.environ)
    if env.get(ENV_TOKEN):
        env["GH_TOKEN"] = env[ENV_TOKEN]
    try:
        return run(["gh", "auth", "status"], env).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def github_client(
    push: bool,
    write_artefact: Callable[[str, str], Path],
    git: Any = None,
    repo: str = "",
    ready: Callable[[], bool] = gh_ready,
) -> GitHubClient:
    """Dry-run unless ``push`` is asked for; then `gh`, if it is set up."""
    if not push:
        return DryRunGitHub(write_artefact)
    if git is not None and repo and ready():
        return GhCliGitHub(repo=repo, git=git, write_artefact=write_artefact)
    return UnavailableGitHub()
