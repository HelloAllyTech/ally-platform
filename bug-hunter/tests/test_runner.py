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
        "npx nx test ally-admin-dashboard -- src/utils/__tests__/a.test.ts"
    )
    assert single_test_command(web, web_file, "formats a version") == (
        "npx nx test ally-admin-dashboard -- src/utils/__tests__/a.test.ts "
        "--testNamePattern='formats a version'"
    )
    assert single_test_command(config.app("ally-ai"), "tests/test_a.py", "test_b") == (
        "poetry run pytest tests/test_a.py -k test_b -v"
    )
    assert single_test_command(
        config.app("ally-mobile"), "test/a_test.dart", "renders"
    ) == ("flutter test --no-pub test/a_test.dart --name renders")


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


@pytest.mark.parametrize(
    "app, exit_code, stdout",
    [
        (
            "ally-be",
            0,
            "No tests found, exiting with code 0\n",
        ),  # jest, passWithNoTests
        ("ally-be", 0, "Test Suites: 0 total\nTests:       0 total\n"),
        (
            "ally-web",
            0,
            " RUN  v3.2.4 /work/ally-web/apps/x\n\n"
            "No test files found, exiting with code 0\n",
        ),
        ("ally-web", 0, " Test Files  no tests\n      Tests  no tests\n"),
        (
            "ally-ai",
            5,
            "collected 0 items\n\n=== no tests ran in 0.01s ===\n",
        ),  # pytest exit 5
        ("ally-ai-learn", 0, "collected 4 items / 4 deselected / 0 selected\n"),
        ("ally-mobile", 0, 'No tests match regular expression "renders".\n'),
        ("ally-mobile", 0, "00:01 +0: All tests passed!\n"),
    ],
)
def test_zero_tests_ran_is_a_failure(
    config: BugHunterConfig, app: str, exit_code: int, stdout: str
) -> None:
    sb = FakeSandbox(app, exit_code=exit_code, stdout=stdout)
    result = Runner(config, sb).run_tests()
    assert not result.passed and result.no_tests
    assert "failed (no tests ran)" in result.summary()


@pytest.mark.parametrize(
    "app, stdout",
    [
        ("ally-be", "PASS src/a.spec.ts\nTests:       3 passed, 3 total\n"),
        ("ally-web", " Test Files  1 passed (1)\n      Tests  2 passed (2)\n"),
        ("ally-ai", "collected 2 items\n\n=== 2 passed in 0.5s ===\n"),
        ("ally-mobile", "00:03 +12: All tests passed!\n"),
    ],
)
def test_runs_with_tests_still_pass(
    config: BugHunterConfig, app: str, stdout: str
) -> None:
    result = Runner(config, FakeSandbox(app, stdout=stdout)).run_tests()
    assert result.passed and not result.no_tests


def test_suite_that_fails_to_compile_is_a_genuine_failure(
    config: BugHunterConfig,
) -> None:
    """Jest prints 'Tests: 0 total' when a suite fails to run; with exit 1 that is a
    real failure (the oracle test importing a symbol the fix adds), not 'no tests'."""
    out = (
        "FAIL src/user/repository/test/user.repository.spec.ts\n"
        "  ● Test suite failed to run\n\n"
        "    error TS2305: Module 'x' has no exported member 'PLATFORM_TIER_ROLES'.\n\n"
        "Test Suites: 1 failed, 1 total\nTests:       0 total\n"
    )
    result = Runner(config, FakeSandbox("ally-be", exit_code=1, stdout=out)).run_tests(
        "src/user/repository/test/user.repository.spec.ts"
    )
    assert not result.passed and not result.no_tests
    # the explicit message still counts on a non-zero exit (jest without
    # --passWithNoTests exits 1)
    sb = FakeSandbox(
        "ally-be", exit_code=1, stdout="No tests found, exiting with code 1"
    )
    assert Runner(config, sb).run_tests().no_tests


def test_zero_tests_rule_applies_to_test_runs_only(config: BugHunterConfig) -> None:
    # a linter printing "collected 0 items" is not a test run
    sb = FakeSandbox("ally-ai", stdout="collected 0 items\n")
    assert Runner(config, sb).run_lint().passed


def test_test_names_are_escaped_for_the_frameworks_filter(
    config: BugHunterConfig,
) -> None:
    from bug_hunter.tools.runner import test_name_filter

    dart = config.app("ally-mobile")
    cmd = single_test_command(
        dart, "test/a_test.dart", "Try again on disconnect (not navigate away)"
    )
    assert r"\(not navigate away\)" in cmd  # a literal match, not a regex group
    be = config.app("ally-be")
    assert single_test_command(be, "src/a.spec.ts", "x [edge] case").endswith(
        "-t 'x \\[edge\\] case' --forceExit"
    )
    assert test_name_filter(config.app("ally-ai"), "test_nested-path (variant)") == (
        "test_nested"
    )
    # plain names are unchanged for every framework
    assert test_name_filter(dart, "renders") == "renders"
    assert test_name_filter(be, "finds a user") == "finds a user"
