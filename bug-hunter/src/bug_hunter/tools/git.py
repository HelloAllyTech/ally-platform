"""Git operations on a per-run worktree.

Nothing here pushes except ``push``, which only ``open_pr`` (chunk 06) calls. All
commands run through a ``CommandRunner`` the tests can fake; output is scrubbed
with the pattern layer before it is returned.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Protocol, Sequence

from bug_hunter.safety.phi import scrub_code

BRANCH_PREFIX = "bughunter"
_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_CONVENTIONAL = re.compile(
    r"^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)"
    r"(\([\w./-]+\))?!?: \S"
)


class GitError(RuntimeError):
    pass


@dataclass(frozen=True)
class CommandResult:
    args: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0


class CommandRunner(Protocol):
    def __call__(
        self, args: Sequence[str], cwd: Path, timeout: int | None = None
    ) -> CommandResult: ...


def subprocess_runner(
    args: Sequence[str], cwd: Path, timeout: int | None = None
) -> CommandResult:
    try:
        proc = subprocess.run(
            list(args), cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        return CommandResult(tuple(args), 127, "", str(exc))
    return CommandResult(tuple(args), proc.returncode, proc.stdout, proc.stderr)


def branch_name(app: str, slug: str) -> str:
    if not _SLUG.match(slug) or len(slug) > 60:
        raise GitError(f"invalid slug {slug!r}: lowercase words joined by '-'")
    return f"{BRANCH_PREFIX}/{app}/{slug}"


class Git:
    """Git commands against ``repo_root`` (the main checkout) or a worktree."""

    def __init__(self, repo_root: Path, runner: CommandRunner = subprocess_runner):
        self.repo_root = Path(repo_root)
        self.runner = runner

    def _git(self, args: Sequence[str], cwd: Path | None = None) -> CommandResult:
        result = self.runner(["git", *args], cwd=cwd or self.repo_root, timeout=300)
        if not result.ok:
            raise GitError(
                f"git {' '.join(args)} failed ({result.returncode}): "
                f"{scrub_code(result.stderr.strip())[:500]}"
            )
        return result

    # --- worktrees ---------------------------------------------------------------

    def create_worktree(self, runs_dir: Path, run_id: str, ref: str) -> Path:
        """Detached worktree of ``ref`` at ``runs_dir/<run_id>/worktree``."""
        path = Path(runs_dir) / run_id / "worktree"
        if path.exists():
            raise GitError(f"{path}: worktree already exists")
        path.parent.mkdir(parents=True, exist_ok=True)
        self._git(["worktree", "add", "--detach", str(path), ref])
        return path

    def remove_worktree(self, path: Path) -> None:
        path = Path(path)
        self._git(["worktree", "remove", "--force", str(path)])
        if path.exists():  # untracked leftovers (node_modules etc.)
            shutil.rmtree(path, ignore_errors=True)
        self._git(["worktree", "prune"])

    # --- read ----------------------------------------------------------------------

    def head(self, worktree: Path) -> str:
        return self._git(["rev-parse", "HEAD"], cwd=worktree).stdout.strip()

    def diff(
        self, worktree: Path, paths: Sequence[str] = (), staged: bool = False
    ) -> str:
        args = ["diff", "--no-color"]
        if staged:
            args.append("--cached")
        if paths:
            args += ["--", *paths]
        return scrub_code(self._git(args, cwd=worktree).stdout)

    def changed_files(self, worktree: Path) -> list[str]:
        """Tracked files modified plus untracked files, relative to the worktree."""
        out = self._git(
            ["status", "--porcelain", "--untracked-files=all"], cwd=worktree
        )
        return [line[3:] for line in out.stdout.splitlines() if line.strip()]

    def modified_tracked_files(self, worktree: Path) -> list[str]:
        """Tracked files with changes (staged or not), relative to the worktree.
        Untracked files (repro tests, bounced repro attempts) are not part of a fix."""
        out = self._git(["diff", "--name-only", "HEAD"], cwd=worktree)
        return [line.strip() for line in out.stdout.splitlines() if line.strip()]

    def log(self, worktree: Path, path: str | None = None, n: int = 10) -> str:
        args = [
            "log",
            "--no-color",
            f"-n{n}",
            "--format=%h %ad %an%n    %s",
            "--date=short",
        ]
        if path:
            args += ["--", path]
        return scrub_code(self._git(args, cwd=worktree).stdout)

    def blame(self, worktree: Path, path: str, start: int, end: int) -> str:
        if start < 1 or end < start:
            raise GitError("blame needs 1 <= start <= end")
        out = self._git(
            ["blame", "--date=short", f"-L{start},{end}", "--", path],
            cwd=worktree,
        )
        return scrub_code(out.stdout)

    # --- write (local only) ----------------------------------------------------------

    def create_branch(self, worktree: Path, app: str, slug: str) -> str:
        name = branch_name(app, slug)
        self._git(["checkout", "-b", name], cwd=worktree)
        return name

    def current_branch(self, worktree: Path) -> str:
        return self._git(
            ["rev-parse", "--abbrev-ref", "HEAD"], cwd=worktree
        ).stdout.strip()

    def commit(self, worktree: Path, message: str, paths: Sequence[str]) -> str:
        if not _CONVENTIONAL.match(message.splitlines()[0]):
            raise GitError("commit message must be conventional, e.g. 'fix(app): …'")
        if not paths:
            raise GitError("commit needs an explicit list of paths")
        self._git(["add", "--", *paths], cwd=worktree)
        self._git(
            [
                "-c",
                "user.name=ally-bug-hunter[bot]",
                "-c",
                "user.email=bug-hunter@helloally.ai",
                "commit",
                "-q",
                "-m",
                message,
            ],
            cwd=worktree,
        )
        return self.head(worktree)

    @contextmanager
    def clean_checkout(self, parent: Path, name: str, ref: str) -> Iterator[Path]:
        """A throwaway detached worktree of ``ref`` at ``parent/name/worktree``,
        removed afterwards whatever happens. Used to run commands on untouched code
        without touching the caller's worktree or the stash stack (which every
        worktree of the repo shares)."""
        # a unique folder per call: a leftover from an earlier checkout (files the
        # sandbox wrote as root, which the host user cannot delete on Linux) must
        # never block the next one
        unique = f"{name}-{uuid.uuid4().hex[:8]}"
        path = self.create_worktree(parent, unique, ref)
        try:
            yield path
        finally:
            # cleanup never raises: verify failed on CI because `git worktree remove`
            # hit root-owned test caches ("Permission denied")
            try:
                self.remove_worktree(path)
            except GitError:
                shutil.rmtree(path, ignore_errors=True)
                try:
                    self._git(["worktree", "prune"])
                except GitError:
                    pass
            shutil.rmtree(Path(parent) / unique, ignore_errors=True)

    # --- push: only open_pr may call this ------------------------------------------

    def push(self, worktree: Path, branch: str, remote: str = "origin") -> None:
        if not branch.startswith(f"{BRANCH_PREFIX}/"):
            raise GitError(
                f"refusing to push {branch!r}: not a {BRANCH_PREFIX}/ branch"
            )
        self._git(
            ["push", "--set-upstream", remote, f"HEAD:refs/heads/{branch}"],
            cwd=worktree,
        )
