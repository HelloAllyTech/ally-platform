"""Per-app knowledge for prompts: the app's ``AGENTS.md`` plus the parts of the root
``CLAUDE.md`` that concern it (repo-map row, verified commands, stack rules such as
"never run dart format"). Cached in memory per (commit, app)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from bug_hunter.config import BugHunterConfig

_STACK_SECTION = {
    "ally-be": "TypeScript repos",
    "ally-web": "TypeScript repos",
    "ally-ai": "Python repos",
    "ally-ai-learn": "Python repos",
    "ally-mobile": "ally-mobile",
}


@dataclass(frozen=True)
class AppContext:
    app: str
    commit: str
    agents_md: str
    repo_row: str
    verified_commands: str
    stack_rules: str
    app_notes: str

    def render(self) -> str:
        parts = [f"# App: {self.app}", ""]
        if self.repo_row:
            parts += ["## Where it sits", self.repo_row, ""]
        if self.verified_commands:
            parts += [
                "## Verified commands (from the root CLAUDE.md)",
                self.verified_commands,
                "",
            ]
        if self.stack_rules:
            parts += ["## Stack rules", self.stack_rules, ""]
        if self.app_notes:
            parts += ["## Notes", self.app_notes, ""]
        parts += ["## AGENTS.md", self.agents_md.strip(), ""]
        return "\n".join(parts)

    def render_short(self) -> str:
        """Commands and rules only: what survives when the budget is tight."""
        parts = [f"# App: {self.app}", ""]
        if self.verified_commands:
            parts += ["## Verified commands", self.verified_commands, ""]
        if self.stack_rules:
            parts += ["## Stack rules", self.stack_rules, ""]
        if self.app_notes:
            parts += ["## Notes", self.app_notes, ""]
        return "\n".join(parts)


def _section(text: str, heading_regex: str, level: str = "##") -> str:
    """Body of the first heading at ``level`` matching ``heading_regex``, up to the
    next heading of the same or higher level."""
    pattern = re.compile(rf"^{re.escape(level)}\s+{heading_regex}\s*$", re.MULTILINE)
    match = pattern.search(text)
    if not match:
        return ""
    rest = text[match.end() :]
    stop = re.search(rf"^#{{1,{len(level)}}}\s", rest, re.MULTILINE)
    return rest[: stop.start()].strip() if stop else rest.strip()


def _verified_commands_for(claude_md: str, app: str) -> str:
    section = _section(claude_md, r"Verified commands")
    if not section:
        return ""
    # blocks look like: **ally-ai**: ... ```bash ... ```
    pattern = re.compile(rf"\*\*{re.escape(app)}\*\*(.*?)```bash\n(.*?)```", re.DOTALL)
    match = pattern.search(section)
    if not match:
        return ""
    intro = match.group(1).strip().lstrip(":").strip()
    body = match.group(2).rstrip()
    return (f"{intro}\n" if intro else "") + f"```bash\n{body}\n```"


def _commands_from_config(app_config) -> str:
    """Fallback when the root CLAUDE.md has no block for the app: apps.yaml holds the
    same CI-verified commands (chunk 01 checked them against the workflows)."""
    lines = [f"cd {app_config.path}", app_config.test]
    if app_config.test_one:
        lines.append(f"{app_config.test_one}   # one file / one test")
    if app_config.lint:
        lines.append(app_config.lint)
    if app_config.typecheck:
        lines.append(app_config.typecheck)
    return (
        "From apps.yaml (verified against CI):\n```bash\n" + "\n".join(lines) + "\n```"
    )


def _repo_row(claude_md: str, app: str) -> str:
    for line in claude_md.splitlines():
        if line.startswith("|") and f"`{app}`" in line.split("|")[1]:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            return " · ".join(c for c in cells if c)
    return ""


def _stack_rules(claude_md: str, app: str) -> str:
    quality = _section(claude_md, r"Code Quality & CI/CD")
    if not quality:
        return ""
    heading = _STACK_SECTION.get(app, "")
    pattern = re.compile(rf"^###\s+{re.escape(heading)}.*?$", re.MULTILINE)
    match = pattern.search(quality)
    if not match:
        return ""
    rest = quality[match.end() :]
    stop = re.search(r"^###\s", rest, re.MULTILINE)
    return (rest[: stop.start()] if stop else rest).strip()


def load_app_context(
    config: BugHunterConfig, app: str, commit: str, root: Path | None = None
) -> AppContext:
    """Build (or fetch from cache) the context for ``app`` at ``commit``. ``root`` is
    the checkout to read from (a worktree); defaults to the repo root."""
    root_str = str((root or config.repo_root).resolve())
    key = (app, commit, root_str)
    cached = _CACHE.get(key)
    if cached is None:
        cached = _load(config, app, commit, root_str)
        if len(_CACHE) >= 32:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = cached
    return cached


_CACHE: dict[tuple[str, str, str], AppContext] = {}


def _load(config: BugHunterConfig, app: str, commit: str, root: str) -> AppContext:
    base = Path(root)
    app_dir = base / config.app(app).path
    agents = _read(app_dir / "AGENTS.md") or _read(app_dir / "CLAUDE.md")
    claude_md = _read(base / "CLAUDE.md")
    app_config = config.app(app)
    notes = app_config.notes or ""
    commands = _verified_commands_for(claude_md, app) or _commands_from_config(
        app_config
    )
    return AppContext(
        app=app,
        commit=commit,
        agents_md=agents,
        repo_row=_repo_row(claude_md, app),
        verified_commands=commands,
        stack_rules=_stack_rules(claude_md, app),
        app_notes=notes,
    )


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""
