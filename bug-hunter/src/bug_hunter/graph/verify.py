"""Verification is code, not judgement (spec §5): the repro test must pass, the app's
checks may not add failures against the baseline, and the repro files must be the
ones reproduce wrote.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from bug_hunter.graph.baseline import Baseline
from bug_hunter.tools.runner import RunResult


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hashes_for(app_root: Path, rel_paths: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for rel in rel_paths:
        path = app_root / rel
        if path.is_file():
            out[rel] = file_hash(path)
    return out


def hashes_match(app_root: Path, expected: dict[str, str]) -> bool:
    return all(
        (app_root / rel).is_file() and file_hash(app_root / rel) == digest
        for rel, digest in expected.items()
    )


def new_failures(after: RunResult, baseline: Baseline, ignore: set[str]) -> list[str]:
    """Failing tests after the fix that did not fail on the untouched code."""
    if after.passed:
        return []
    before = set(baseline.failing_tests)
    now = [t for t in after.failing_tests if t not in before and t not in ignore]
    if not now and not after.no_tests and not baseline.passed:
        return []  # same pre-existing failures, nothing new
    if not now and after.exit_code != 0 and baseline.passed:
        # failed without a parsable test name (compile error, crash): blame it
        return [f"{after.kind} failed without a parsable failing test (see excerpt)"]
    return now


def check_passes(after: RunResult, baseline: Baseline | None) -> bool:
    """lint / typecheck: a failure counts only if the untouched code passed."""
    if after.skipped or after.passed:
        return True
    return baseline is not None and not baseline.passed
