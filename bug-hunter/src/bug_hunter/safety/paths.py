"""Path policy: what the agent may read, what it may write, and what counts as risky.

Every tool resolves its path through ``PathPolicy`` before touching the disk, so
the rules hold even if a prompt is ignored. Paths are resolved (``..`` and symlinks
followed) and must stay inside the worktree; deny patterns are then matched against
the resolved relative path, so a symlink to ``.env`` is still ``.env``.

Glob semantics, shared with the chunk 01 config test: ``*`` crosses ``/``; a pattern
with no ``/`` also matches the basename at any depth; a trailing ``/`` means the
whole subtree.
"""

from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Iterable

from bug_hunter.config import BugHunterConfig

# Spec §6: never readable, never writable.
DENY_PATTERNS: tuple[str, ...] = (
    ".env*",
    "**/env/**",
    "docker.env",
    "*.pem",
    "*.key",
    "infra/**",
    ".git/**",
    "**/.git/**",
    ".github/**",
)

# Readable, never writable.
LOCKFILE_PATTERNS: tuple[str, ...] = (
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "pubspec.lock",
    "Pipfile.lock",
)


class PathDenied(PermissionError):
    """The path is outside the worktree or matches a deny rule."""


def matches(rel_path: str, pattern: str) -> bool:
    """True if ``rel_path`` (posix, relative, no leading ``./``) matches ``pattern``."""
    rel_path = rel_path.lstrip("./") if rel_path.startswith("./") else rel_path
    if pattern.endswith("/"):
        pattern += "*"
    candidates = {pattern, pattern.replace("**/", "")}  # **/ = zero or more dirs
    if pattern.startswith("**/"):
        candidates.add(pattern[3:])
    for candidate in candidates:
        if fnmatch.fnmatchcase(rel_path, candidate):
            return True
    if "/" not in pattern:
        return fnmatch.fnmatchcase(rel_path.rsplit("/", 1)[-1], pattern)
    return False


def matches_any(rel_path: str, patterns: Iterable[str]) -> str | None:
    """The first pattern that matches, else None."""
    for pattern in patterns:
        if matches(rel_path, pattern):
            return pattern
    return None


class PathPolicy:
    """Path rules for one worktree. ``root`` is the worktree (ally-platform) root."""

    def __init__(
        self,
        root: Path,
        config: BugHunterConfig,
        app_roots: dict[str, str] | None = None,
    ):
        self.root = Path(root).resolve()
        self.config = config
        # Where each app lives inside this worktree, relative; "" for a pre-cutover
        # checkout where the app's files sit at the root. Defaults to apps.yaml paths.
        self.app_roots = dict(app_roots or {})

    def app_path_of(self, app: str) -> str:
        if app in self.app_roots:
            return self.app_roots[app].strip("/")
        return self.config.app(app).path

    # --- resolution ------------------------------------------------------------

    def resolve(self, path: str | Path) -> Path:
        """Absolute, symlink-free path inside the worktree, or ``PathDenied``."""
        raw = Path(path)
        candidate = raw if raw.is_absolute() else self.root / raw
        resolved = candidate.resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError:
            raise PathDenied(f"{path}: outside the worktree") from None
        return resolved

    def rel(self, path: str | Path) -> str:
        return self.resolve(path).relative_to(self.root).as_posix()

    def app_rel(self, path: str | Path, app: str) -> str:
        """Path relative to the app directory, or ``PathDenied`` if outside it."""
        rel = self.rel(path)
        app_path = self.app_path_of(app)
        if app_path == "":
            return rel
        if rel != app_path and not rel.startswith(app_path + "/"):
            raise PathDenied(f"{path}: not inside {app_path}/")
        return rel[len(app_path) + 1 :] if rel != app_path else ""

    # --- rules -------------------------------------------------------------------

    def is_denied(self, rel_path: str) -> str | None:
        return matches_any(rel_path, DENY_PATTERNS)

    def is_lockfile(self, rel_path: str) -> bool:
        return matches_any(rel_path, LOCKFILE_PATTERNS) is not None

    def check_read(self, path: str | Path) -> Path:
        resolved = self.resolve(path)
        rel = resolved.relative_to(self.root).as_posix()
        rule = self.is_denied(rel)
        if rule:
            raise PathDenied(f"{path}: reading denied (matches {rule})")
        return resolved

    def check_write(self, path: str | Path, app: str) -> Path:
        resolved = self.check_read(path)
        rel = resolved.relative_to(self.root).as_posix()
        if self.is_lockfile(rel):
            raise PathDenied(f"{path}: lockfiles are read-only")
        self.app_rel(resolved, app)
        return resolved

    def is_test_path(self, path: str | Path, app: str) -> bool:
        app_rel = self.app_rel(path, app)
        return matches_any(app_rel, self.config.app(app).test_dirs) is not None

    def touches_risk(self, paths: Iterable[str | Path], app: str) -> list[str]:
        """``"<path> (<pattern>)"`` for every path that hits a risk rule."""
        app_config = self.config.app(app)
        hits: list[str] = []
        for path in paths:
            rel = self.rel(path)
            rule = matches_any(rel, self.config.apps.global_risk_paths)
            if rule is None:
                try:
                    app_rel = self.app_rel(rel, app)
                except PathDenied:
                    app_rel = None
                if app_rel is not None:
                    rule = matches_any(app_rel, app_config.risk_paths)
            if rule:
                hits.append(f"{rel} ({rule})")
        return hits
