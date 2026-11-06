"""Runner: commands come from apps.yaml, failing tests are parsed per framework,
excerpts are truncated and scrubbed."""

from __future__ import annotations

import pytest

from bug_hunter.config import BugHunterConfig
from bug_hunter.tools.runner import (
    Runner,
    RunnerError,
    nx_project,
    parse_failing_tests,
    single_test_command,
)
from bug_hunter.tools.sandbox import ExecResult


class FakeSandbox:
    def __init__(self, app: str, exit_code=0, stdout="", stderr="", timed_out=False):
        self.app = app
        self.exit_code, self.stdout, self.stderr, self.timed_out = (
            exit_code,
            stdout,
            stderr,
            timed_out,
        )
        self.commands: list[str] = []

    def exec(self, command, **_):
        self.commands.append(command)
        return ExecResult(
            command, self.exit_code, self.stdout, self.stderr, 1.5, self.timed_out
        )


def test_single_test_commands(config: BugHunterConfig) -> None:
    be = config.app("ally-be")
    assert single_test_command(
        be, "src/user/test/user.service.spec.ts", "finds a user"
    ) == ("npx jest src/user/test/user.service.spec.ts -t 'finds a user' --forceExit")
    assert (
        single_test_command(be, "src/x.spec.ts", None)
        == "npx jest src/x.spec.ts --forceExit"
    )
    web = config.app("ally-web")
    web_file = "apps/ally-admin-dashboard/src/utils/__tests__/a.test.ts"
    assert single_test_command(web, web_file, None) == (
        f"npx nx test ally-admin-dashboard --testFile={web_file}"
    )
    assert single_test_command(config.app("ally-ai"), "tests/test_a.py", "test_b") == (
        "poetry run pytest tests/test_a.py -k test_b -v"
    )
    assert single_test_command(
        config.app("ally-mobile"), "test/a_test.dart", "renders"
    ) == ("flutter test test/a_test.dart --name renders")


def test_nx_project() -> None:
    assert (
        nx_project("apps/ally-helpline-dashboard/src/a.test.ts")
        == "ally-helpline-dashboard"
    )
    assert nx_project("libs/ui-shared/src/a.test.tsx") == "ui-shared"
    with pytest.raises(RunnerError):
        nx_project("src/a.test.ts")


def test_parse_jest(config: BugHunterConfig) -> None:
    out = """FAIL src/user/user.service.spec.ts
  ● UserService › findOne › returns null for a missing user

    expect(received).toBeNull()

  ● UserService › findOne › returns null for a missing user
Tests:       1 failed, 3 passed, 4 total
"""
    assert parse_failing_tests(config.app("ally-be"), out) == [
        "UserService › findOne › returns null for a missing user"
    ]


def test_parse_vitest(config: BugHunterConfig) -> None:
    out = (
        " ❯ src/utils/__tests__/a.test.ts (2)\n   × formats the version 12ms\n"
        "   ✓ keeps empty\n FAIL  src/utils/__tests__/a.test.ts > formats the version\n"
    )
    assert parse_failing_tests(config.app("ally-web"), out)[0] == "formats the version"


def test_parse_pytest_and_flutter(config: BugHunterConfig) -> None:
    out = (
        "FAILED tests/unit/test_a.py::test_one - AssertionError\n"
        "ERROR tests/unit/test_b.py::test_two\n"
    )
    assert parse_failing_tests(config.app("ally-ai"), out) == [
        "tests/unit/test_a.py::test_one",
        "tests/unit/test_b.py::test_two",
    ]
    out = (
        "00:03 +12 -1: test/features/a_test.dart: renders the sheet [E]\n"
        "00:03 +12 -1: Some tests failed.\n"
    )
    assert parse_failing_tests(config.app("ally-mobile"), out) == [
        "test/features/a_test.dart: renders the sheet"
    ]


def test_run_tests_result_is_scrubbed_and_truncated(config: BugHunterConfig) -> None:
    noise = "\n".join(f"line {n}" for n in range(300))
    sb = FakeSandbox(
        "ally-be", exit_code=1, stdout=f"{noise}\n  ● S › t\nemail ops@example.com\n"
    )
    result = Runner(config, sb).run_tests("src/a.spec.ts")
    assert sb.commands == ["npx jest src/a.spec.ts --forceExit"]
    assert not result.passed and result.failing_tests == ["S › t"]
    assert "ops@example.com" not in result.excerpt
    assert "earlier lines omitted" in result.excerpt
    assert "line 0" not in result.excerpt
    assert result.summary().startswith("ally-be test: failed in 1.5s; 1 failing: S › t")


def test_lint_and_typecheck(config: BugHunterConfig) -> None:
    sb = FakeSandbox("ally-ai")
    runner = Runner(config, sb)
    assert runner.run_lint().passed and sb.commands == ["poetry run flake8"]
    skipped = runner.run_typecheck()
    assert skipped.skipped and skipped.passed and len(sb.commands) == 1


def test_timed_out_run(config: BugHunterConfig) -> None:
    sb = FakeSandbox("ally-be", exit_code=-1, stdout="partial", timed_out=True)
    result = Runner(config, sb).run_tests()
    assert result.timed_out and not result.passed
    assert result.excerpt.startswith("[timed out after 1.5s]")
    assert "timed out" in result.summary()


def test_full_suite_needs_no_target_and_web_needs_project(
    config: BugHunterConfig,
) -> None:
    sb = FakeSandbox("ally-web")
    Runner(config, sb).run_tests()
    assert sb.commands == ["npm test"]
    with pytest.raises(RunnerError):
        Runner(config, sb).run_tests("src/a.test.ts")
