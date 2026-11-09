"""Why a test run failed, in code: setup failures (import or module errors, compile
errors, missing fixtures, timeouts, zero tests ran) never count as a reproduction.
The model is asked only about genuine assertion or runtime failures (chunk 05 §3).
"""

from __future__ import annotations

import re
from typing import Literal

from bug_hunter.config import AppConfig
from bug_hunter.tools.runner import RunResult

FailureKind = Literal["genuine", "setup", "passed", "no_tests"]

_SETUP = {
    "typescript": re.compile(
        r"Cannot find module|Module not found|Test suite failed to run"
        r"|error TS\d+:|SyntaxError|ReferenceError: \w+ is not defined"
        r"|Failed to resolve import|Error: Cannot find package"
        r"|Exceeded timeout of|Test timed out|ECONNREFUSED|ENOTFOUND",
        re.IGNORECASE,
    ),
    "python": re.compile(
        r"ModuleNotFoundError|ImportError|fixture '\w+' not found"
        r"|^E\s+SyntaxError|IndentationError|collection errors?|error during collection"
        r"|Timeout >|ConnectionRefusedError|Name or service not known",
        re.MULTILINE,
    ),
    "dart": re.compile(
        r"Error: Couldn't resolve the package|Target of URI doesn't exist"
        r"|Compilation failed|Error: The getter '\w+' isn't defined"
        r"|Error: Undefined name|TimeoutException|Failed to load|SocketException",
    ),
}


def classify_failure(app: AppConfig, result: RunResult) -> FailureKind:
    if result.no_tests:
        return "no_tests"
    if result.passed:
        return "passed"
    if result.timed_out:
        return "setup"
    text = result.excerpt or ""
    if _SETUP[app.lang].search(text):
        return "setup"
    return "genuine"


def describe(kind: FailureKind) -> str:
    return {
        "genuine": "the test ran and failed on an assertion or runtime error",
        "setup": "the test could not run: import, compile, fixture, network or timeout",
        "passed": "the test passed on the buggy code",
        "no_tests": "no test ran (wrong path or name filter)",
    }[kind]
