"""Actions an admin asks for in the dashboard that need git and GitHub (chunk 11).

ally-be writes a row to ``bughunter.actions``; the worker takes pending rows before it
claims a bug. Today there is one kind:

- ``open_pr``: an admin pressed **Open PR** on a suggested fix. The fix is rebuilt on a
  fresh checkout of the base branch from the report (the patch and the failing test),
  committed on a ``bughunter/`` branch, pushed and opened as a draft PR. Findings about
  security, auth, tenants or data exposure never become a public PR (CONTEXT.md rule
  8), whoever asks.

Merge and Release are not here: ally-be does them with the old Bug Hunter's GitHub
services, as a person's click.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from bug_hunter.graph.github import GitHubClient
from bug_hunter.graph.nodes.approve import slug_for
from bug_hunter.graph.output import MANUAL_LINE
from bug_hunter.graph.risk import topic_hits
from bug_hunter.reports.store import Report
from bug_hunter.tools.git import branch_name

ACTION_KINDS = ("open_pr",)
_DIFF_FILE = re.compile(r"^\+\+\+ [a-z]/(.+)$", re.MULTILINE)


class ActionRefused(RuntimeError):
    """The action must not run (it would publish something it must not)."""


@dataclass
class Action:
    id: int
    bug_id: int
    kind: str
    requested_by: int | None = None


def never_public_reasons(report: Report) -> list[str]:
    finding = report.finding or {}
    reasons = []
    if finding.get("category") == "security":
        reasons.append("finding category: security")
    reasons += topic_hits(
        report.title, str(finding.get("hypothesis", "")), report.root_cause or ""
    )
    return reasons


def files_in_patch(diff: str) -> list[str]:
    return sorted(set(_DIFF_FILE.findall(diff)))


def short_pr_body(report: Report) -> str:
    repro = report.repro or {}
    lines = [
        "## Bug",
        report.title,
        "",
        "## Root cause",
        report.root_cause or "(not recorded)",
    ]
    if repro.get("test_path"):
        lines += [
            "",
            "## Reproduction",
            f"`{repro['test_path']}` fails before this change and passes after.",
        ]
    lines += [
        "",
        "Opened by Bug Hunter from its suggested fix, at an admin's request. "
        "A person decides the merge.",
        "",
        MANUAL_LINE,
    ]
    return "\n".join(lines)


def open_pr_from_report(
    report: Report,
    *,
    git: Any,
    github: GitHubClient,
    app_path: str,
    runs_dir: Path,
    base: str = "origin/master",
    apply: Callable[[Path, str], None] | None = None,
) -> str:
    """Rebuild a suggested fix on ``base`` and open it as a draft PR (its URL)."""
    blocked = never_public_reasons(report)
    if blocked:
        raise ActionRefused(
            "never a public PR: " + "; ".join(blocked) + ". Fix it privately."
        )
    if not report.patch_diff:
        raise ActionRefused("this report has no patch to open a PR from")
    repro = report.repro or {}
    apply = apply or _git_apply
    with git.clean_checkout(runs_dir, f"open-pr-{report.id}", base) as wt:
        apply(wt, report.patch_diff)
        paths = files_in_patch(report.patch_diff)
        if repro.get("test_path") and repro.get("source"):
            test = f"{app_path}/{repro['test_path']}"
            (wt / test).parent.mkdir(parents=True, exist_ok=True)
            (wt / test).write_text(repro["source"], encoding="utf-8")
            paths.append(test)
        slug = slug_for(report.title)
        branch = branch_name(report.app, f"{slug}-{report.id}")
        git.create_branch(wt, report.app, f"{slug}-{report.id}")
        title = f"fix({report.app}): {report.title}"[:120]
        git.commit(wt, title, paths)
        github.push_branch(wt, branch)
        return github.open_draft_pr(branch, title, short_pr_body(report)).url


def _git_apply(worktree: Path, diff: str) -> None:
    result = subprocess.run(
        ["git", "apply", "--3way", "-"],
        input=diff,
        cwd=worktree,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise ActionRefused(
            "the suggested patch no longer applies to master: "
            + result.stderr.strip()[-300:]
        )
