"""Run lifecycle: one directory per run, cleaned up whatever happens.

Layout (all under ``bug-hunter/runs/``, gitignored)::

    runs/<run_id>/worktree/      git worktree of the commit under test (live runs only)
    runs/<run_id>/artefacts/     diff, scratchpad, report, escalation, resume info
    runs/artefacts/<run_id>/     where artefacts move when the run ends (kept)
    runs/cache/                  shared caches: repo map, tiktoken

``Run`` is a context manager. On exit, by return, exception or SIGTERM, it kills the
run's containers, removes the worktree and moves the artefacts to the kept folder
with a ``status.json``. Artefacts are never deleted by a run, including failed ones;
``clean_artefacts`` prunes them by age and total size, except paused runs, which
keep everything they need to resume. Dependency volumes and the repo-map cache are
shared across runs on purpose and are not touched by a run.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from bug_hunter.config import ARTEFACTS_DIR, CACHE_DIR, RUNS_DIR, BugHunterConfig
from bug_hunter.tools.git import Git, GitError
from bug_hunter.tools.sandbox import DockerRunner, Sandbox, subprocess_docker

STATUS_FILE = "status.json"
OWNER_FILE = "owner.json"  # pid of the process running a live run
RESUME_FILE = "resume.json"
PAUSED = "paused"


RUN_CONTAINER_PREFIX = "bughunter-run-"  # Sandbox.container_name = bughunter-<run_id>-…


def new_run_id(prefix: str = "run") -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{prefix}-{stamp}-{uuid.uuid4().hex[:6]}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def dir_size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                pass
    return total


@dataclass
class Run:
    """A live run. Use as ``with Run.start(config, app, ref) as run:``."""

    config: BugHunterConfig
    app: str
    ref: str
    run_id: str
    runs_dir: Path = RUNS_DIR
    docker: DockerRunner = subprocess_docker
    git: Git | None = None
    worktree: Path | None = None
    sandbox: Sandbox | None = None
    status: str = "running"
    error: str | None = None
    started_at: str = field(default_factory=_now)
    _previous_sigterm: Any = field(default=None, init=False, repr=False)
    _finished: bool = field(default=False, init=False, repr=False)

    # --- paths -------------------------------------------------------------------

    @property
    def dir(self) -> Path:
        return self.runs_dir / self.run_id

    @property
    def artefacts(self) -> Path:
        return self.dir / "artefacts"

    @property
    def kept_artefacts(self) -> Path:
        return self.runs_dir / "artefacts" / self.run_id

    @property
    def scratchpad_path(self) -> Path:
        return self.artefacts / "scratchpad.md"

    # --- lifecycle -----------------------------------------------------------------

    @classmethod
    def start(
        cls,
        config: BugHunterConfig,
        app: str,
        ref: str = "origin/master",
        run_id: str | None = None,
        runs_dir: Path = RUNS_DIR,
        docker: DockerRunner = subprocess_docker,
    ) -> "Run":
        clean_orphans(config, runs_dir=runs_dir, docker=docker)
        run = cls(
            config, app, ref, run_id or new_run_id(), runs_dir=runs_dir, docker=docker
        )
        run.git = Git(config.repo_root)
        run.dir.mkdir(parents=True, exist_ok=False)
        (run.dir / OWNER_FILE).write_text(
            json.dumps({"pid": os.getpid(), "started_at": run.started_at})
        )
        run.artefacts.mkdir()
        try:
            run.worktree = run.git.create_worktree(runs_dir, run.run_id, ref)
            run.sandbox = Sandbox(config, run.worktree, app, run.run_id, docker=docker)
        except Exception:
            run.finish(error="failed to start")
            raise
        run._install_sigterm()
        return run

    def __enter__(self) -> "Run":
        return self

    def __exit__(self, exc_type, exc, _tb) -> bool:
        if exc is not None and self.status == "running":
            self.status = "failed"
            self.error = f"{exc_type.__name__}: {exc}"[:2000]
        self.finish()
        return False

    def pause(self, resume: dict[str, Any]) -> None:
        """Mark the run as waiting for a human. ``resume`` holds what a later process
        needs (branch, head, app, PR url, checkpoint id); it is kept with the artefacts
        and the artefacts are exempt from age/size cleaning while paused."""
        self.status = PAUSED
        self.write_artefact(RESUME_FILE, json.dumps(resume, indent=2))

    def finish(self, error: str | None = None) -> Path:
        """Kill containers, remove the worktree, move artefacts to the kept folder.
        Idempotent. Returns the kept artefacts folder."""
        if self._finished:
            return self.kept_artefacts
        self._finished = True
        if error:
            self.status, self.error = "failed", error
        elif self.status == "running":
            self.status = "completed"
        self._restore_sigterm()
        if self.sandbox is not None:
            try:
                self.sandbox.cleanup()
            except Exception:  # noqa: BLE001 - cleanup must not mask the real error
                pass
        if self.worktree is not None and self.git is not None:
            try:
                self.git.remove_worktree(self.worktree)
            except GitError:
                shutil.rmtree(self.worktree, ignore_errors=True)
        self.artefacts.mkdir(parents=True, exist_ok=True)
        (self.artefacts / STATUS_FILE).write_text(
            json.dumps(
                {
                    "run_id": self.run_id,
                    "app": self.app,
                    "ref": self.ref,
                    "status": self.status,
                    "error": self.error,
                    "started_at": self.started_at,
                    "ended_at": _now(),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        self.kept_artefacts.parent.mkdir(parents=True, exist_ok=True)
        if self.kept_artefacts.exists():
            shutil.rmtree(self.kept_artefacts)
        shutil.move(str(self.artefacts), str(self.kept_artefacts))
        shutil.rmtree(self.dir, ignore_errors=True)
        return self.kept_artefacts

    # --- artefacts ------------------------------------------------------------------

    def write_artefact(self, name: str, content: str) -> Path:
        target = (self.kept_artefacts if self._finished else self.artefacts) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return target

    # --- signals ---------------------------------------------------------------------

    def _install_sigterm(self) -> None:
        try:
            self._previous_sigterm = signal.getsignal(signal.SIGTERM)

            def handler(signum, frame):  # noqa: ARG001
                self.finish(error="terminated (SIGTERM)")
                if callable(self._previous_sigterm):
                    self._previous_sigterm(signum, frame)
                else:
                    raise SystemExit(143)

            signal.signal(signal.SIGTERM, handler)
        except (ValueError, OSError):  # not in the main thread
            self._previous_sigterm = None

    def _restore_sigterm(self) -> None:
        if self._previous_sigterm is not None:
            try:
                signal.signal(signal.SIGTERM, self._previous_sigterm)
            except (ValueError, OSError):
                pass
            self._previous_sigterm = None


# --- sweeping ------------------------------------------------------------------------


def clean_orphans(
    config: BugHunterConfig,
    runs_dir: Path = RUNS_DIR,
    docker: DockerRunner = subprocess_docker,
    git_runner: Callable[..., Any] | None = None,
) -> dict[str, list[str]]:
    """Remove what a crashed run left behind: live run dirs (artefacts are kept
    first), stale git worktrees and ``bughunter-run-*`` containers (never the
    ``bughunter-pg`` checkpoint database)."""
    removed: dict[str, list[str]] = {"runs": [], "worktrees": [], "containers": []}
    skipped_live: list[str] = []
    git = Git(config.repo_root, git_runner) if git_runner else Git(config.repo_root)
    if runs_dir.is_dir():
        for entry in sorted(runs_dir.iterdir()):
            if not entry.is_dir() or entry.name in ("artefacts", "cache"):
                continue
            if _owner_alive(entry):
                skipped_live.append(entry.name)
                continue  # another process is still running this one
            worktree = entry / "worktree"
            if worktree.exists():
                try:
                    git.remove_worktree(worktree)
                except GitError:
                    shutil.rmtree(worktree, ignore_errors=True)
                removed["worktrees"].append(entry.name)
            artefacts = entry / "artefacts"
            if artefacts.is_dir() and any(artefacts.iterdir()):
                kept = runs_dir / "artefacts" / entry.name
                kept.parent.mkdir(parents=True, exist_ok=True)
                if not kept.exists():
                    shutil.move(str(artefacts), str(kept))
                    status = kept / STATUS_FILE
                    if not status.exists():
                        status.write_text(
                            json.dumps(
                                {
                                    "run_id": entry.name,
                                    "status": "failed",
                                    "error": "orphaned run swept",
                                }
                            )
                        )
            shutil.rmtree(entry, ignore_errors=True)
            removed["runs"].append(entry.name)
    removed["skipped_live"] = skipped_live
    try:
        git._git(["worktree", "prune"])
    except GitError:
        pass
    try:
        listing = docker(
            # run containers only (bughunter-run-<id>-<app>-N): never the
            # bughunter-pg checkpoint database or anything else with the prefix
            ["docker", "ps", "-aq", "--filter", f"name={RUN_CONTAINER_PREFIX}"],
            timeout=60,
        )
        ids = listing.stdout.split() if listing.ok else []
        if ids:
            docker(["docker", "rm", "-f", *ids], timeout=120)
            removed["containers"] = ids
    except Exception:  # noqa: BLE001 - no docker is fine
        pass
    return removed


def _owner_alive(run_dir: Path) -> bool:
    """True if the run's owner process still exists (so it is not an orphan)."""
    try:
        pid = int(json.loads((run_dir / OWNER_FILE).read_text())["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return False
    if pid == os.getpid():
        return False  # our own leftovers are ours to clean
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _status_of(kept: Path) -> dict[str, Any]:
    try:
        return json.loads((kept / STATUS_FILE).read_text())
    except (OSError, ValueError):
        return {}


def clean_artefacts(
    config: BugHunterConfig,
    artefacts_dir: Path = ARTEFACTS_DIR,
    max_age_days: int | None = None,
    max_size_mb: int | None = None,
    include_paused: bool = False,
    now: float | None = None,
) -> dict[str, Any]:
    """Delete kept artefacts older than ``max_age_days``, then the oldest until the
    folder is under ``max_size_mb``. Paused runs are kept unless ``include_paused``."""
    max_age_days = max_age_days or config.limits.artefacts.max_age_days
    max_size_mb = max_size_mb or config.limits.artefacts.max_size_mb
    now = now or time.time()
    deleted: list[str] = []
    skipped_paused: list[str] = []
    if not artefacts_dir.is_dir():
        return {"deleted": deleted, "kept_paused": skipped_paused, "size_bytes": 0}
    entries = []
    for entry in artefacts_dir.iterdir():
        if not entry.is_dir():
            continue
        status = _status_of(entry)
        paused = status.get("status") == PAUSED
        mtime = entry.stat().st_mtime
        entries.append((mtime, entry, paused))
    entries.sort()  # oldest first
    remaining = []
    for mtime, entry, paused in entries:
        age_days = (now - mtime) / 86400
        if age_days > max_age_days:
            if paused and not include_paused:
                skipped_paused.append(entry.name)
                remaining.append((mtime, entry, paused))
                continue
            shutil.rmtree(entry, ignore_errors=True)
            deleted.append(entry.name)
        else:
            remaining.append((mtime, entry, paused))
    total = sum(dir_size(entry) for _m, entry, _p in remaining)
    cap = max_size_mb * 1024 * 1024
    for mtime, entry, paused in remaining:
        if total <= cap:
            break
        if paused and not include_paused:
            if entry.name not in skipped_paused:
                skipped_paused.append(entry.name)
            continue
        size = dir_size(entry)
        shutil.rmtree(entry, ignore_errors=True)
        deleted.append(entry.name)
        total -= size
    return {"deleted": deleted, "kept_paused": skipped_paused, "size_bytes": total}


def cache_report(
    runs_dir: Path = RUNS_DIR, docker: DockerRunner = subprocess_docker
) -> dict[str, Any]:
    """Sizes of everything the bug hunter keeps on this machine."""
    report: dict[str, Any] = {
        "artefacts_bytes": dir_size(runs_dir / "artefacts"),
        "repo_map_bytes": dir_size(CACHE_DIR / "repo-map"),
        "tiktoken_bytes": dir_size(CACHE_DIR / "tiktoken"),
        "live_runs": (
            [
                p.name
                for p in runs_dir.iterdir()
                if p.is_dir() and p.name not in ("artefacts", "cache")
            ]
            if runs_dir.is_dir()
            else []
        ),
        "docker_volumes": {},
    }
    per_app: dict[str, int] = {}
    repo_map_dir = CACHE_DIR / "repo-map"
    if repo_map_dir.is_dir():
        for app_dir in repo_map_dir.iterdir():
            if app_dir.is_dir():
                per_app[app_dir.name] = dir_size(app_dir)
    report["repo_map_per_app_bytes"] = per_app
    try:
        listing = docker(
            ["docker", "system", "df", "-v", "--format", "{{json .}}"], timeout=60
        )
        if listing.ok and listing.stdout.strip():
            data = json.loads(listing.stdout.strip().splitlines()[-1])
            for volume in data.get("Volumes", []) or []:
                name = volume.get("Name", "")
                if name.startswith("bughunter-deps-"):
                    report["docker_volumes"][name] = volume.get("Size", "?")
    except Exception:  # noqa: BLE001 - docker is optional here
        pass
    return report


def remove_docker_dep_volumes(docker: DockerRunner = subprocess_docker) -> list[str]:
    """Delete the bug hunter's own dependency volumes (never anything else)."""
    listing = docker(
        ["docker", "volume", "ls", "-q", "--filter", "name=bughunter-deps-"], timeout=60
    )
    names = [n for n in listing.stdout.split() if n.startswith("bughunter-deps-")]
    if names:
        docker(["docker", "volume", "rm", "-f", *names], timeout=120)
    return names


def run_subprocess_quiet(args: list[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True).stdout
