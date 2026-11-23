"""CI failures on master (spec §12): a failed ``test-*.yml`` run becomes a signal whose
reproduction already exists (the failing test). One candidate per workflow and commit,
so re-runs of the same commit do not repeat it."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from bug_hunter.safety.phi import scrub
from bug_hunter.signals.base import Candidate
from bug_hunter.signals.github import GitHubReader
from bug_hunter.signals.state import SignalState

WORKFLOW_APPS = {
    "test-ally-be.yml": "ally-be",
    "test-ally-web.yml": "ally-web",
    "test-ally-ai.yml": "ally-ai",
    "test-ally-ai-learn.yml": "ally-ai-learn",
    "test-ally-mobile.yml": "ally-mobile",
    # test-ally-archiver.yml: no app config in the bug hunter, skipped
}
CURSOR = "ci_failures:since"
_TS = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ")
_FAILED = [
    re.compile(r"^\s*●\s+(.+?›.+)$"),  # jest: ● Suite › test
    re.compile(r"^\s*(?:×|✕)\s+(.+?)(?:\s+\d+ms)?$"),  # vitest / jest summary marks
    re.compile(r"^FAILED\s+(\S+::\S+)"),  # pytest
    re.compile(r"^\d\d:\d\d \+\d+(?: ~\d+)? -\d+: (.+?) \[E\]$"),  # flutter
]
EXCERPT_LINES = 60


def failing_tests(log: str) -> list[str]:
    names: list[str] = []
    for raw in log.splitlines():
        line = _TS.sub("", raw)
        for rx in _FAILED:
            m = rx.match(line)
            if m and m.group(1).strip() not in names:
                names.append(m.group(1).strip())
                break
    return names[:20]


def failure_excerpt(log: str) -> str:
    """The lines around the first failures, scrubbed (test output can carry data)."""
    lines = [_TS.sub("", raw) for raw in log.splitlines()]
    start = next(
        (
            i
            for i, line in enumerate(lines)
            if any(rx.match(line) for rx in _FAILED) or "FAIL " in line
        ),
        max(0, len(lines) - EXCERPT_LINES),
    )
    return scrub("\n".join(lines[start : start + EXCERPT_LINES]))


def collect(
    reader: GitHubReader,
    state: SignalState,
    apps: list[str],
    now: datetime | None = None,
) -> tuple[list[Candidate], dict[str, Any]]:
    """Candidates since the cursor, and the cursor update to save after dispatch."""
    now = now or datetime.now(timezone.utc)
    since = state.get(CURSOR) or (now - timedelta(days=1)).isoformat(timespec="seconds")
    out: list[Candidate] = []
    for workflow, app in WORKFLOW_APPS.items():
        if app not in apps:
            continue
        seen_shas: set[str] = set()
        for run in reader.workflow_runs(workflow, "master", "failure", since):
            sha = run["head_sha"]
            if sha in seen_shas:
                continue
            seen_shas.add(sha)
            log = reader.failed_job_logs(run["id"])
            tests = failing_tests(log)
            title = f"{workflow} failed on master at {sha[:10]}: " + (
                ", ".join(tests[:3]) if tests else "no test names found"
            )
            out.append(
                Candidate(
                    source="ci_failure",
                    app=app,
                    key=f"ci:{workflow}:{sha[:12]}",
                    title=title[:200],
                    summary=(
                        f"CI workflow {workflow} failed on master at commit {sha}.\n"
                        f"Failing tests: {', '.join(tests) or '(not parsed)'}\n\n"
                        f"Output (scrubbed):\n{failure_excerpt(log)}"
                    ),
                    ref=sha,
                    reported_by="ci",
                    severity_hint="high",
                    extra={"run_id": run["id"], "failing_tests": tests},
                )
            )
    return out, {CURSOR: now.isoformat(timespec="seconds")}
