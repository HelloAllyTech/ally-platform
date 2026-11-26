"""CI failures on master (spec §12): a failed ``test-*.yml`` run becomes a signal whose
reproduction already exists (the failing test).

One candidate per workflow and **set of failing tests**: the same broken test failing on
five commits in a row is one bug, keyed on the test names so it is not reported again
the next day. A failed job whose failed steps are not tests (lint, format, typecheck,
build) is ignored with a reason, and so is a test job whose output names no test: the
agent needs a failing test to start from (rule 1)."""

from __future__ import annotations

import hashlib
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
    # playwright list reporter:
    #   ✘  4 [desktop] › e2e/a.e2e.ts:37:9 › suite › test (11.8s)
    re.compile(
        r"^\s*✘\s+\d+\s+(?:\[[^\]]+\]\s+›\s+)?(.+?)(?:\s+\(\d+(?:\.\d+)?m?s\))?$"
    ),
    re.compile(r"^FAILED\s+(\S+::\S+)"),  # pytest
    re.compile(r"^\d\d:\d\d \+\d+(?: ~\d+)? -\d+: (.+?) \[E\]$"),  # flutter
]
# A failed step whose name says it runs tests; anything else (Lint, Format check,
# Typecheck, Build, Install) is not a bug the agent can reproduce with a test.
_TEST_STEP = re.compile(r"test|spec|e2e|playwright|jest|vitest|pytest", re.I)
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


def tests_key(workflow: str, tests: list[str]) -> str:
    digest = hashlib.sha1("\n".join(sorted(tests)).encode()).hexdigest()[:12]
    return f"ci:{workflow}:t{digest}"


def group_failures(failures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Failures (oldest first) that share any failing test are one bug: the set of
    red tests drifts from commit to commit as other tests break or get fixed. Each
    group keeps its first failure, every commit and the union of the tests."""
    groups: list[dict[str, Any]] = []
    for f in failures:
        hits = [g for g in groups if g["tests"] & set(f["tests"])]
        if hits:
            first, rest = hits[0], hits[1:]
            for g in rest:  # this failure joins groups that were apart until now
                first["tests"] |= g["tests"]
                first["names"] += [n for n in g["names"] if n not in first["names"]]
                first["shas"] += g["shas"]
                groups.remove(g)
            group = first
        else:
            group = {"first": f, "tests": set(), "names": [], "shas": []}
            groups.append(group)
        group["tests"] |= set(f["tests"])
        group["names"] += [n for n in f["tests"] if n not in group["names"]]
        group["shas"].append(f["sha"])
    return groups


def _candidate(workflow: str, app: str, g: dict[str, Any]) -> Candidate:
    first, tests, shas = g["first"], g["names"], g["shas"]
    sha = first["sha"]
    since_txt = f" since {sha[:10]}" + (
        f" ({len(shas)} commits)" if len(shas) > 1 else ""
    )
    return Candidate(
        source="ci_failure",
        app=app,
        # one test of the group names it, so the same red test tomorrow dedupes
        key=tests_key(workflow, [min(tests)]),
        title=(f"{workflow} failing on master{since_txt}: " + ", ".join(tests[:3]))[
            :200
        ],
        summary=(
            f"CI workflow {workflow} failed on master, first at commit {sha}"
            + (f" and on {len(shas) - 1} later commit(s)" if shas[1:] else "")
            + f".\nFailing tests: {', '.join(tests[:20])}\n\n"
            f"Output (scrubbed):\n{failure_excerpt(first['log'])}"
        ),
        ref=sha,
        reported_by="ci",
        severity_hint="high",
        extra={
            "run_id": first["run"]["id"],
            "failing_tests": tests[:20],
            "commits": shas,
        },
    )


def collect(
    reader: GitHubReader,
    state: SignalState,
    apps: list[str],
    now: datetime | None = None,
) -> tuple[list[Candidate], dict[str, Any], list[str]]:
    """Candidates since the cursor, the cursor update to save after dispatch, and the
    failures ignored with a reason."""
    now = now or datetime.now(timezone.utc)
    since = state.get(CURSOR) or (now - timedelta(days=1)).isoformat(timespec="seconds")
    out: list[Candidate] = []
    ignored: list[str] = []
    for workflow, app in WORKFLOW_APPS.items():
        if app not in apps:
            continue
        seen_shas: set[str] = set()
        failures: list[dict[str, Any]] = []
        runs = sorted(
            reader.workflow_runs(workflow, "master", "failure", since),
            key=lambda r: r.get("created_at") or "",
        )
        for run in runs:
            sha = run["head_sha"]
            if sha in seen_shas:
                continue  # a re-run of the same commit
            seen_shas.add(sha)
            jobs = reader.failed_jobs(run["id"])
            test_jobs = [
                j for j in jobs if any(_TEST_STEP.search(s) for s in j["failed_steps"])
            ]
            if not test_jobs:
                steps = ", ".join(
                    f"{j['name']}/{s}" for j in jobs for s in j["failed_steps"]
                )
                ignored.append(
                    f"ci: {workflow} at {sha[:10]}: not a test failure "
                    f"({steps or 'no failed step reported'})"
                )
                continue
            log = "\n".join(j["log"] for j in test_jobs)
            tests = failing_tests(log)
            if not tests:
                ignored.append(
                    f"ci: {workflow} at {sha[:10]}: test step failed but no failing "
                    "test name was found in the output"
                )
                continue
            failures.append({"run": run, "sha": sha, "tests": tests, "log": log})
        out += [_candidate(workflow, app, g) for g in group_failures(failures)]
    return out, {CURSOR: now.isoformat(timespec="seconds")}, ignored
