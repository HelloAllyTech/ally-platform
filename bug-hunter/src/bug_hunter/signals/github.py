"""Read-only GitHub access for the signal sources, behind an interface (the GitHub
App client in production; recorded fixtures in tests). Nothing here writes to
ally-platform: reports go to the private reports repo (``reports/``)."""

from __future__ import annotations

from typing import Any, Protocol


class GitHubReader(Protocol):
    def workflow_runs(
        self, workflow: str, branch: str, conclusion: str, created_after: str
    ) -> list[dict[str, Any]]:
        """``[{id, head_sha, created_at, html_url}]`` for one workflow file."""
        ...

    def failed_job_logs(self, run_id: int) -> str:
        """The logs of the run's failed jobs, concatenated."""
        ...

    def issues(self, since: str, label: str) -> list[dict[str, Any]]:
        """Open issues with ``label`` updated since: ``[{number, title, body,
        user: {login}, labels: [{name}], created_at, pull_request?}]``."""
        ...

    def label_events(self, number: int) -> list[dict[str, Any]]:
        """``[{event: "labeled", label: {name}, actor: {login}}]``."""
        ...

    def is_org_member(self, org: str, login: str) -> bool: ...
