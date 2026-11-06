"""Run an app's tests, lint and typecheck in the sandbox, from ``apps.yaml`` commands.

Results are pass/fail plus the failing test names and a truncated, scrubbed
excerpt. Nothing here is judgement: ``passed`` is the exit code.
"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from bug_hunter.config import AppConfig, BugHunterConfig
from bug_hunter.safety.phi import scrub
from bug_hunter.tools.sandbox import ExecResult, Sandbox

EXCERPT_MAX_CHARS = 6000
EXCERPT_TAIL_LINES = 120


class RunnerError(ValueError):
    pass


@dataclass(frozen=True)
class RunResult:
    app: str
    kind: str  # test | lint | typecheck
    command: str
    passed: bool
    exit_code: int
    duration_s: float
    failing_tests: list[str] = field(default_factory=list)
    excerpt: str = ""
    timed_out: bool = False
    skipped: bool = False

    def summary(self) -> str:
        if self.skipped:
            return f"{self.app} {self.kind}: skipped (no command configured)"
        state = (
            "timed out" if self.timed_out else ("passed" if self.passed else "failed")
        )
        line = f"{self.app} {self.kind}: {state} in {self.duration_s}s"
        if self.failing_tests:
            line += f"; {len(self.failing_tests)} failing: " + ", ".join(
                self.failing_tests[:10]
            )
        return line


# --- command templates ----------------------------------------------------------------


def nx_project(file: str) -> str:
    """``apps/<name>/...`` or ``libs/<name>/...`` → ``<name>`` (ally-web)."""
    parts = PurePosixPath(file).parts
    if len(parts) >= 3 and parts[0] in ("apps", "libs"):
        return parts[1]
    raise RunnerError(
        f"{file}: cannot derive the Nx project (expected apps/<p>/… or libs/<p>/…)"
    )


def single_test_command(app: AppConfig, file: str, name: str | None) -> str:
    if not app.test_one:
        raise RunnerError(
            f"{app.path}: no single-test command configured; run the suite"
        )
    template = app.test_one
    if name is None:
        # drop the flag that carries {name}: "-t {name}", "-k {name}", "--name {name}"
        template = re.sub(r"\s+\S+\s+\{name\}", "", template)
    values = {"file": shlex.quote(file), "name": shlex.quote(name) if name else ""}
    if "{project}" in template:
        values["project"] = nx_project(file)
    return template.format(**values)


# --- output parsing ---------------------------------------------------------------------

_JEST_FAIL = re.compile(r"^\s*● (.+?)(?: › (.+))?$", re.MULTILINE)
_JEST_FAIL_SUITE = re.compile(r"^\s*FAIL\s+(\S+)", re.MULTILINE)
_VITEST_FAIL = re.compile(r"^\s*(?:FAIL|×|✗)\s+(.+?)(?:\s+\d+ms)?$", re.MULTILINE)
_PYTEST_FAIL = re.compile(r"^(?:FAILED|ERROR)\s+(\S+::\S+)", re.MULTILINE)
_FLUTTER_FAIL = re.compile(
    r"^\d+:\d+ \+\d+(?: ~\d+)? -\d+: (.+?) \[E\]\s*$", re.MULTILINE
)
_NOISE = re.compile(r"^(?:Test Suites:|Tests:|Snapshots:|Time:|Ran all test suites)")


def parse_failing_tests(app: AppConfig, output: str) -> list[str]:
    found: list[str] = []
    if app.lang == "python":
        found = [m.group(1) for m in _PYTEST_FAIL.finditer(output)]
    elif app.lang == "dart":
        found = [m.group(1).strip() for m in _FLUTTER_FAIL.finditer(output)]
    elif app.lang == "typescript":
        found = [
            " › ".join(part for part in m.groups() if part)
            for m in _JEST_FAIL.finditer(output)
            if not _NOISE.match(m.group(1))
        ]
        if not found:
            found = [m.group(1).strip() for m in _VITEST_FAIL.finditer(output)]
        if not found:
            found = [m.group(1) for m in _JEST_FAIL_SUITE.finditer(output)]
    seen: dict[str, None] = {}
    for item in found:
        seen.setdefault(item.strip(), None)
    return list(seen)


def make_excerpt(result: ExecResult) -> str:
    text = result.stdout
    if result.stderr.strip():
        text = (
            f"{text}\n--- stderr ---\n{result.stderr}"
            if text.strip()
            else result.stderr
        )
    lines = text.splitlines()
    if len(lines) > EXCERPT_TAIL_LINES:
        lines = [
            f"… ({len(lines) - EXCERPT_TAIL_LINES} earlier lines omitted)"
        ] + lines[-EXCERPT_TAIL_LINES:]
    excerpt = "\n".join(lines)
    if len(excerpt) > EXCERPT_MAX_CHARS:
        excerpt = "…" + excerpt[-EXCERPT_MAX_CHARS:]
    if result.timed_out:
        excerpt = f"[timed out after {result.duration_s}s]\n{excerpt}"
    return scrub(excerpt)


# --- runner -----------------------------------------------------------------------------------


class Runner:
    def __init__(self, config: BugHunterConfig, sandbox: Sandbox):
        self.config = config
        self.sandbox = sandbox
        self.app = sandbox.app
        self.app_config = config.app(self.app)

    def _run(self, kind: str, command: str | None) -> RunResult:
        if not command:
            return RunResult(self.app, kind, "", True, 0, 0.0, skipped=True)
        result = self.sandbox.exec(command)
        return RunResult(
            app=self.app,
            kind=kind,
            command=command,
            passed=result.ok,
            exit_code=result.exit_code,
            duration_s=result.duration_s,
            failing_tests=(
                [] if result.ok else parse_failing_tests(self.app_config, result.stdout)
            ),
            excerpt=make_excerpt(result),
            timed_out=result.timed_out,
        )

    def run_tests(
        self, target: str | None = None, name: str | None = None
    ) -> RunResult:
        """Full suite, or one file (``target``, app-relative) and optionally one test."""
        if target is None:
            return self._run("test", self.app_config.test)
        return self._run("test", single_test_command(self.app_config, target, name))

    def run_lint(self) -> RunResult:
        return self._run("lint", self.app_config.lint)

    def run_typecheck(self) -> RunResult:
        return self._run("typecheck", self.app_config.typecheck)
