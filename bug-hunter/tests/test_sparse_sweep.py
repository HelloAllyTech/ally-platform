"""Chunk 08: the sparse, reused sweep worktree; the disk floor; the sweep cost cap."""

from __future__ import annotations

import subprocess
from contextlib import contextmanager
from pathlib import Path

import pytest

from bug_hunter.signals import commit_sweep as cs
from bug_hunter.signals.sparse import LowDisk, sparse_worktree
from bug_hunter.tools.git import Git


def _git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


@pytest.fixture
def mono(tmp_path: Path):
    root = tmp_path / "mono"
    for f in ("ally-be/src/a.ts", "ally-web/apps/x/A.tsx", "ally-ai/app/m.py"):
        (root / f).parent.mkdir(parents=True, exist_ok=True)
        (root / f).write_text("x\n")
    (root / "CLAUDE.md").write_text("root context\n")
    (root / "ally-be/AGENTS.md").write_text("be agents\n")
    _git(root, "init", "-q", "-b", "master")
    _git(root, "add", ".")
    _git(root, "commit", "-qm", "init")
    return root, _git(root, "rev-parse", "HEAD")


def test_only_the_app_folder_and_root_files_are_checked_out(mono, tmp_path) -> None:
    root, sha = mono
    with sparse_worktree(Git(root), tmp_path / "wts", probe=lambda p: 50.0) as wt:
        d = wt.checkout(sha, "ally-be")
        assert (d / "ally-be/src/a.ts").exists() and (d / "CLAUDE.md").exists()
        assert not (d / "ally-web").exists() and not (d / "ally-ai").exists()
        # reused for the next batch: the same folder now holds only ally-web
        assert wt.checkout(sha, "ally-web") == d
        assert (d / "ally-web/apps/x/A.tsx").exists() and not (d / "ally-be").exists()
        kept = d
    assert not kept.exists()  # removed at the end
    assert "sweep-sparse" not in _git(root, "worktree", "list")


def test_low_disk_stops_before_checking_out(mono, tmp_path) -> None:
    root, sha = mono
    with sparse_worktree(Git(root), tmp_path / "wts", probe=lambda p: 0.4) as wt:
        with pytest.raises(LowDisk, match="0.40 GB < 1.0 GB"):
            wt.checkout(sha, "ally-be")
        assert not wt.created


def test_the_cost_cap_stops_the_sweep_cleanly_and_keeps_results() -> None:
    class Runner:
        def __init__(self, spent):
            from bug_hunter.graph.state import Budget

            self.budget = Budget(cost_usd=0.6 if spent < 1.0 else 0.0)
            self.spent = spent

        def run(self, lens, app, commits):
            if self.spent >= 1.0:
                raise cs.StopSweep("cost cap $1.00 reached")
            return []

        def check(self, app, f):
            return "refuted", "low", "-"

    calls = []

    @contextmanager
    def runner_for(b, spent):
        calls.append(b.app)
        yield Runner(spent)

    batches = [
        cs.SweepBatch(a, ["c" * 40], []) for a in ("ally-be", "ally-web", "ally-ai")
    ]
    found, cost = cs.collect_with(batches, runner_for)
    # $0.60 + $0.60: the third batch's runner refuses before its first call
    assert calls == ["ally-be", "ally-web", "ally-ai"] and cost == pytest.approx(1.2)
    assert batches[2].stopped.startswith("cost cap") and batches[1].stopped == ""
