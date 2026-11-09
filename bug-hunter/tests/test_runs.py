"""Run lifecycle: worktree and containers always cleaned, artefacts always kept
(also on failure), paused runs keep resume info, orphan sweep, artefact pruning."""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import pytest

from bug_hunter.config import BugHunterConfig
from bug_hunter.runs import Run, clean_artefacts, clean_orphans, dir_size
from bug_hunter.tools.sandbox import DockerResult


class FakeDocker:
    def __init__(self):
        self.calls = []
        self.containers = ["abc123"]

    def __call__(self, args, timeout=None):
        self.calls.append(list(args))
        if args[1:3] == ["ps", "-aq"]:
            return DockerResult(tuple(args), 0, "\n".join(self.containers), "")
        if args[1:3] == ["rm", "-f"]:
            self.containers = []
        return DockerResult(tuple(args), 0, "", "")


@pytest.fixture
def repo_config(config: BugHunterConfig, tmp_path: Path) -> BugHunterConfig:
    repo = tmp_path / "repo"
    (repo / "ally-be").mkdir(parents=True)
    (repo / "ally-be/a.ts").write_text("x")
    git = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q", "-b", "master"], cwd=repo, check=True)
    subprocess.run([*git, "add", "."], cwd=repo, check=True)
    subprocess.run([*git, "commit", "-qm", "feat: x"], cwd=repo, check=True)
    return config.model_copy(update={"repo_root": repo})


def test_success_keeps_artefacts_and_removes_worktree(
    repo_config, tmp_path: Path
) -> None:
    runs = tmp_path / "runs"
    docker = FakeDocker()
    with Run.start(
        repo_config, "ally-be", "HEAD", run_id="r1", runs_dir=runs, docker=docker
    ) as run:
        assert (run.worktree / "ally-be/a.ts").exists()
        run.write_artefact("diff.patch", "+1")
        run.write_artefact("scratchpad.md", "notes")
    assert not (runs / "r1").exists()
    kept = runs / "artefacts" / "r1"
    assert (kept / "diff.patch").read_text() == "+1" and (
        kept / "scratchpad.md"
    ).exists()
    status = json.loads((kept / "status.json").read_text())
    assert status["status"] == "completed" and status["app"] == "ally-be"
    assert ["docker", "rm", "-f", "abc123"] in docker.calls  # containers killed
    worktrees = subprocess.run(
        ["git", "worktree", "list"],
        cwd=repo_config.repo_root,
        capture_output=True,
        text=True,
    ).stdout
    assert "r1" not in worktrees
    assert (
        "worktree"
        not in subprocess.run(
            ["git", "worktree", "list"],
            cwd=repo_config.repo_root,
            capture_output=True,
            text=True,
        ).stdout.split("r1")[-1:][0]
    )


def test_failure_still_cleans_and_keeps(repo_config, tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    with pytest.raises(RuntimeError, match="boom"):
        with Run.start(
            repo_config,
            "ally-be",
            "HEAD",
            run_id="r2",
            runs_dir=runs,
            docker=FakeDocker(),
        ) as run:
            run.write_artefact("report.md", "partial")
            raise RuntimeError("boom")
    assert not (runs / "r2").exists()
    kept = runs / "artefacts" / "r2"
    status = json.loads((kept / "status.json").read_text())
    assert status["status"] == "failed" and "RuntimeError: boom" in status["error"]
    assert (kept / "report.md").read_text() == "partial"
    worktrees = subprocess.run(
        ["git", "worktree", "list"],
        cwd=repo_config.repo_root,
        capture_output=True,
        text=True,
    ).stdout
    assert "r2" not in worktrees


def test_pause_keeps_resume_info(repo_config, tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    with Run.start(
        repo_config, "ally-be", "HEAD", run_id="r3", runs_dir=runs, docker=FakeDocker()
    ) as run:
        run.pause(
            {
                "branch": "bughunter/ally-be/x",
                "head": "abc",
                "pr_url": "u",
                "checkpoint": "t1",
            }
        )
    kept = runs / "artefacts" / "r3"
    assert json.loads((kept / "status.json").read_text())["status"] == "paused"
    assert (
        json.loads((kept / "resume.json").read_text())["branch"]
        == "bughunter/ally-be/x"
    )
    # paused artefacts survive age and size pruning unless asked for
    old = time.time() + 40 * 86400
    result = clean_artefacts(repo_config, artefacts_dir=runs / "artefacts", now=old)
    assert result["deleted"] == [] and result["kept_paused"] == ["r3"]
    result = clean_artefacts(
        repo_config, artefacts_dir=runs / "artefacts", now=old, include_paused=True
    )
    assert result["deleted"] == ["r3"]


def test_clean_orphans_skips_runs_whose_owner_is_alive(
    repo_config, tmp_path: Path
) -> None:
    runs = tmp_path / "runs"
    run = Run.start(
        repo_config,
        "ally-be",
        "HEAD",
        run_id="live",
        runs_dir=runs,
        docker=FakeDocker(),
    )
    run._restore_sigterm()
    # pretend another live process owns it
    (runs / "live" / "owner.json").write_text(
        json.dumps({"pid": os.getpid() + 0, "started_at": "x"})
    )
    import bug_hunter.runs as runs_module

    monkey = pytest.MonkeyPatch()
    monkey.setattr(runs_module.os, "getpid", lambda: -1)
    try:
        removed = clean_orphans(repo_config, runs_dir=runs, docker=FakeDocker())
    finally:
        monkey.undo()
    assert removed["runs"] == [] and removed["skipped_live"] == ["live"]
    assert (runs / "live" / "worktree").exists()
    run.finish()


def test_clean_orphans_sweeps_crashed_runs(repo_config, tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    # simulate a crash: a live run dir with a worktree and artefacts, no status
    run = Run.start(
        repo_config, "ally-be", "HEAD", run_id="r4", runs_dir=runs, docker=FakeDocker()
    )
    run.write_artefact("escalation.md", "why it stopped")
    run._restore_sigterm()
    docker = FakeDocker()
    removed = clean_orphans(repo_config, runs_dir=runs, docker=docker)
    assert (
        removed["runs"] == ["r4"]
        and removed["worktrees"] == ["r4"]
        and removed["containers"] == ["abc123"]
    )
    assert not (runs / "r4").exists()
    kept = runs / "artefacts" / "r4"
    assert (kept / "escalation.md").exists()
    assert json.loads((kept / "status.json").read_text())["status"] == "failed"
    # the next Run.start sweeps too, so a fresh run never inherits leftovers
    with Run.start(
        repo_config, "ally-be", "HEAD", run_id="r5", runs_dir=runs, docker=FakeDocker()
    ):
        pass
    assert sorted(p.name for p in (runs / "artefacts").iterdir()) == ["r4", "r5"]


def test_clean_artefacts_by_age_then_size(repo_config, tmp_path: Path) -> None:
    artefacts = tmp_path / "artefacts"
    now = time.time()
    for name, age_days, size in (
        ("old", 40, 10),
        ("mid", 10, 2_000_000),
        ("new", 1, 2_000_000),
    ):
        folder = artefacts / name
        folder.mkdir(parents=True)
        (folder / "status.json").write_text(json.dumps({"status": "completed"}))
        (folder / "blob").write_bytes(b"x" * size)
        stamp = now - age_days * 86400
        os.utime(folder, (stamp, stamp))
    result = clean_artefacts(
        repo_config, artefacts_dir=artefacts, max_age_days=30, max_size_mb=3, now=now
    )
    assert result["deleted"] == [
        "old",
        "mid",
    ]  # old by age, mid as the oldest over the cap
    assert result["size_bytes"] == dir_size(artefacts / "new")
    assert (artefacts / "new").exists()


def test_orphan_sweep_only_touches_run_containers(config, tmp_path) -> None:
    """The checkpoint database container is `bughunter-pg`; the sweep must not list it
    (found the hard way: a run start removed the database the run was about to use)."""
    from bug_hunter.runs import RUN_CONTAINER_PREFIX, clean_orphans
    from bug_hunter.tools.sandbox import DockerResult

    seen: list[list[str]] = []

    def docker(args, timeout=None):
        seen.append(list(args))
        return DockerResult(tuple(args), 0, "", "")

    clean_orphans(config, runs_dir=tmp_path / "runs", docker=docker)
    ps = [a for a in seen if a[:2] == ["docker", "ps"]]
    assert ps and ps[0][-1] == f"name={RUN_CONTAINER_PREFIX}"
    assert RUN_CONTAINER_PREFIX == "bughunter-run-"
    assert not "bughunter-pg".startswith(RUN_CONTAINER_PREFIX)
