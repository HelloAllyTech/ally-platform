"""GitHub access for open_pr and escalate, behind an interface tests can fake.

The default is **dry-run**: nothing leaves the machine; the branch diff, the PR body
and the issue body are written to the run's artefacts. A real client needs the
"Ally Bug Hunter" GitHub App (spec §15), which does not exist yet: ``UnavailableGitHub``
refuses with a clear message so a misconfigured run can never push by accident.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol


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


def github_client(
    push: bool, write_artefact: Callable[[str, str], Path]
) -> GitHubClient:
    """Dry-run unless ``push`` is asked for; the real client arrives with the App."""
    if not push:
        return DryRunGitHub(write_artefact)
    return UnavailableGitHub()
