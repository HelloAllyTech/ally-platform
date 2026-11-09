"""Baseline test results on the untouched code, so a fix is blamed only for *new*
failures. Cached per (commit SHA, app, command) under ``runs/cache/baseline/`` and
shared across runs: the same commit's suite is never paid for twice.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from bug_hunter.config import CACHE_DIR
from bug_hunter.tools.runner import RunResult

BASELINE_DIR = CACHE_DIR / "baseline"


@dataclass
class Baseline:
    commit: str
    app: str
    command: str
    passed: bool
    failing_tests: list[str]
    no_tests: bool
    duration_s: float
    recorded_at: str
    excerpt_tail: str = ""

    @classmethod
    def from_result(
        cls, commit: str, app: str, command: str, result: RunResult
    ) -> "Baseline":
        # keyed by the command we were asked for, not what the runner reports
        return cls(
            commit=commit,
            app=app,
            command=command,
            passed=result.passed,
            failing_tests=list(result.failing_tests),
            no_tests=result.no_tests,
            duration_s=result.duration_s,
            recorded_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            excerpt_tail=(result.excerpt or "")[-1500:],
        )


def cache_path(commit: str, app: str, command: str, root: Path = BASELINE_DIR) -> Path:
    digest = hashlib.sha256(command.encode("utf-8")).hexdigest()[:12]
    return root / app / f"{commit[:12]}-{digest}.json"


def load(
    commit: str, app: str, command: str, root: Path = BASELINE_DIR
) -> Baseline | None:
    path = cache_path(commit, app, command, root)
    if not path.exists():
        return None
    try:
        return Baseline(**json.loads(path.read_text(encoding="utf-8")))
    except (ValueError, TypeError):
        return None


def save(baseline: Baseline, root: Path = BASELINE_DIR) -> Path:
    path = cache_path(baseline.commit, baseline.app, baseline.command, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(baseline), indent=1), encoding="utf-8")
    return path


def baseline_for(
    commit: str,
    app: str,
    command: str,
    run,  # Callable[[], RunResult]
    root: Path = BASELINE_DIR,
) -> tuple[Baseline, bool]:
    """``(baseline, from_cache)``; runs ``run()`` on the untouched code on a miss."""
    cached = load(commit, app, command, root)
    if cached is not None:
        return cached, True
    baseline = Baseline.from_result(commit, app, command, run())
    save(baseline, root)
    return baseline, False
