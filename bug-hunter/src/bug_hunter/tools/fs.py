"""File-system tools over one worktree, for one app.

Every call goes through ``PathPolicy``; results are compact text, scrubbed with
the pattern layer (source code keeps its ``name:`` values, see ``safety.phi``).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from bug_hunter.config import BugHunterConfig
from bug_hunter.safety.paths import PathDenied, PathPolicy
from bug_hunter.safety.phi import scrub_code

MAX_READ_LINES = 400
MAX_LINE_CHARS = 400
SKIP_DIRS = {
    "node_modules",
    ".git",
    ".venv",
    "dist",
    "build",
    ".dart_tool",
    ".nx",
    "coverage",
}


class FsError(ValueError):
    pass


def _clip(line: str) -> str:
    return line if len(line) <= MAX_LINE_CHARS else line[:MAX_LINE_CHARS] + " …"


class Workspace:
    """Tools scoped to ``app`` inside ``worktree``. Paths are relative to the app
    directory (``src/foo.ts``), or to the worktree if they start with another app's
    name; reads may cross apps, writes may not."""

    def __init__(self, worktree: Path, config: BugHunterConfig, app: str):
        self.worktree = Path(worktree).resolve()
        self.config = config
        self.app = app
        self.app_dir = self.worktree / config.app(app).path
        self.policy = PathPolicy(self.worktree, config)

    # --- helpers ---------------------------------------------------------------------

    def _abs(self, path: str) -> Path:
        """Resolve an agent path: app-relative first, then worktree-relative."""
        raw = Path(path)
        if raw.is_absolute():
            return self.policy.resolve(raw)
        app_candidate = self.app_dir / raw
        if app_candidate.exists() or not (self.worktree / raw).exists():
            return self.policy.resolve(app_candidate)
        return self.policy.resolve(self.worktree / raw)

    def _display(self, path: Path) -> str:
        rel = self.policy.rel(path)
        app_prefix = self.config.app(self.app).path + "/"
        return rel[len(app_prefix) :] if rel.startswith(app_prefix) else rel

    def _is_hidden_from_listing(self, path: Path) -> bool:
        try:
            return self.policy.is_denied(self.policy.rel(path)) is not None
        except PathDenied:
            return True

    # --- read ------------------------------------------------------------------------

    def list_dir(self, path: str = ".", depth: int = 1) -> str:
        root = self.policy.check_read(self._abs(path))
        if not root.is_dir():
            raise FsError(f"{path}: not a directory")
        depth = max(1, min(depth, 4))
        lines: list[str] = []
        for current, dirs, files in os.walk(root):
            rel_depth = len(Path(current).relative_to(root).parts)
            dirs[:] = sorted(
                d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")
            )
            if rel_depth >= depth:
                dirs[:] = []
            for name in sorted(dirs):
                full = Path(current) / name
                if not self._is_hidden_from_listing(full):
                    lines.append(f"{self._display(full)}/")
            for name in sorted(files):
                full = Path(current) / name
                if not self._is_hidden_from_listing(full):
                    lines.append(self._display(full))
            if len(lines) > 500:
                lines.append("… (truncated at 500 entries)")
                break
        return "\n".join(lines) or "(empty)"

    def glob(self, pattern: str, max_results: int = 200) -> str:
        base = self.policy.check_read(self.app_dir)
        hits: list[str] = []
        for match in sorted(base.glob(pattern)):
            if any(part in SKIP_DIRS for part in match.relative_to(base).parts):
                continue
            if self._is_hidden_from_listing(match):
                continue
            hits.append(self._display(match))
            if len(hits) >= max_results:
                hits.append(f"… (truncated at {max_results})")
                break
        return "\n".join(hits) or "(no matches)"

    def grep(self, pattern: str, path: str = ".", max_results: int = 50) -> str:
        root = self.policy.check_read(self._abs(path))
        max_results = max(1, min(max_results, 200))
        try:
            re.compile(pattern)
        except re.error as exc:
            raise FsError(f"invalid regex: {exc}") from exc
        if shutil.which("rg"):
            lines = self._grep_rg(pattern, root, max_results)
        else:
            lines = self._grep_python(pattern, root, max_results)
        return scrub_code("\n".join(lines)) if lines else "(no matches)"

    def _grep_rg(self, pattern: str, root: Path, max_results: int) -> list[str]:
        args = [
            "rg",
            "--no-heading",
            "--line-number",
            "--color=never",
            "--no-messages",
            f"--max-count={max_results}",
            "--max-columns=400",
        ]
        for skip in SKIP_DIRS:
            args += ["--glob", f"!{skip}"]
        for deny in (".env*", "docker.env", "*.pem", "*.key"):
            args += ["--glob", f"!{deny}"]
        args += ["--glob", "!infra", "--glob", "!env", "--", pattern, str(root)]
        proc = subprocess.run(args, capture_output=True, text=True, timeout=60)
        out: list[str] = []
        for line in proc.stdout.splitlines():
            file_part, _, rest = line.partition(":")
            try:
                shown = self._display(self.policy.check_read(file_part))
            except PathDenied:
                continue
            out.append(f"{shown}:{rest}")
            if len(out) >= max_results:
                out.append(f"… (truncated at {max_results})")
                break
        return out

    def _grep_python(self, pattern: str, root: Path, max_results: int) -> list[str]:
        regex = re.compile(pattern)
        out: list[str] = []
        files = [root] if root.is_file() else []
        if root.is_dir():
            for current, dirs, names in os.walk(root):
                dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
                files += [Path(current) / n for n in sorted(names)]
        for file in files:
            if self._is_hidden_from_listing(file):
                continue
            try:
                text = file.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for number, line in enumerate(text.splitlines(), 1):
                if regex.search(line):
                    out.append(f"{self._display(file)}:{number}:{_clip(line)}")
                    if len(out) >= max_results:
                        out.append(f"… (truncated at {max_results})")
                        return out
        return out

    def read_file(
        self, path: str, start_line: int = 1, end_line: int | None = None
    ) -> str:
        file = self.policy.check_read(self._abs(path))
        if not file.is_file():
            raise FsError(f"{path}: not a file")
        try:
            lines = file.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError as exc:
            raise FsError(f"{path}: not a text file") from exc
        start = max(1, start_line)
        end = min(
            end_line or start + MAX_READ_LINES - 1,
            start + MAX_READ_LINES - 1,
            len(lines),
        )
        if start > len(lines):
            raise FsError(f"{path}: has only {len(lines)} lines")
        width = len(str(end))
        body = "\n".join(
            f"{number:>{width}}| {_clip(lines[number - 1])}"
            for number in range(start, end + 1)
        )
        header = f"{self._display(file)} lines {start}-{end} of {len(lines)}"
        return scrub_code(f"{header}\n{body}")

    # --- write (app-scoped) ----

    def edit_file(self, path: str, old_str: str, new_str: str) -> str:
        file = self.policy.check_write(self._abs(path), self.app)
        if not file.is_file():
            raise FsError(f"{path}: not a file")
        if not old_str:
            raise FsError("old_str must not be empty")
        text = file.read_text(encoding="utf-8")
        count = text.count(old_str)
        if count == 0:
            raise FsError(f"{path}: old_str not found")
        if count > 1:
            raise FsError(
                f"{path}: old_str matches {count} times; include more context"
            )
        file.write_text(text.replace(old_str, new_str, 1), encoding="utf-8")
        return f"edited {self._display(file)}"

    def write_test_file(self, path: str, content: str) -> str:
        raw = Path(path)
        target = self.policy.resolve(raw if raw.is_absolute() else self.app_dir / raw)
        if target.exists():
            raise FsError(f"{path}: exists; write_test_file never overwrites")
        self.policy.check_write(target, self.app)
        if not self.policy.is_test_path(target, self.app):
            raise FsError(
                f"{path}: not a test location for {self.app} "
                f"(allowed: {', '.join(self.config.app(self.app).test_dirs)})"
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"wrote {self._display(target)} ({len(content.splitlines())} lines)"
