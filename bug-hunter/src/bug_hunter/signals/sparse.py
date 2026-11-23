"""A sparse, reusable worktree for the read-only commit sweep (chunk 08, user
2026-11-15): only the batch's app folder plus the root files the context needs are
checked out; the same worktree moves from batch to batch and is removed at the end.
Free disk is checked before every checkout; below the floor the sweep stops cleanly.
"""

from __future__ import annotations

import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

from bug_hunter.tools.git import Git, GitError

ROOT_FILES = ("CLAUDE.md", "AGENTS.md")  # what load_app_context reads at the root
MIN_FREE_GB = 1.0


class LowDisk(RuntimeError):
    pass


def free_gb(path: Path) -> float:
    """Free space on the volume holding ``path`` (or its nearest existing parent)."""
    path = Path(path)
    while not path.exists() and path != path.parent:
        path = path.parent
    return shutil.disk_usage(path).free / 1e9


class SparseWorktree:
    def __init__(
        self,
        git: Git,
        parent: Path,
        min_free_gb: float = MIN_FREE_GB,
        probe: Callable[[Path], float] = free_gb,
    ):
        self.git = git
        self.dir = parent / f"sweep-sparse-{uuid.uuid4().hex[:8]}"
        self.min_free_gb = min_free_gb
        self.probe = probe
        self.created = False

    def _guard(self, what: str) -> None:
        free = self.probe(self.dir.parent)
        if free < self.min_free_gb:
            raise LowDisk(
                f"free disk {free:.2f} GB < {self.min_free_gb:.1f} GB before {what}; "
                "stopping the sweep cleanly"
            )

    def checkout(self, sha: str, app_path: str) -> Path:
        """The worktree at ``sha`` with only ``app_path/`` and the root files."""
        self._guard(f"checking out {app_path} at {sha[:10]}")
        if not self.created:
            self.dir.parent.mkdir(parents=True, exist_ok=True)
            self.git._git(
                ["worktree", "add", "--no-checkout", "--detach", str(self.dir), sha]
            )
            self.created = True
        patterns = [f"/{app_path}/", *(f"/{f}" for f in ROOT_FILES)]
        self.git._git(["sparse-checkout", "set", "--no-cone", *patterns], cwd=self.dir)
        self.git._git(["checkout", "--detach", "--force", sha], cwd=self.dir)
        return self.dir

    def remove(self) -> None:
        if not self.created:
            return
        try:
            self.git._git(["worktree", "remove", "--force", str(self.dir)])
        except GitError:
            shutil.rmtree(self.dir, ignore_errors=True)
            try:
                self.git._git(["worktree", "prune"])
            except GitError:
                pass
        self.created = False


@contextmanager
def sparse_worktree(git: Git, parent: Path, **kw) -> Iterator[SparseWorktree]:
    wt = SparseWorktree(git, parent, **kw)
    try:
        yield wt
    finally:
        wt.remove()
