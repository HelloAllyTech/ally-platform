"""Distinctive terms from every eval case's diff, so prompt examples can be checked for
leaks: a prompt may not mention a file, symbol or string literal that an accepted,
disputed or dropped-near-duplicate case changed.

A term is distinctive when it is a changed file's basename, an identifier from a
changed line that is long or mixed-case/underscored, or a quoted string literal of
some length, and it is not in the generic stoplist below.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Iterable

from bug_hunter.config import PACKAGE_ROOT
from evals.schema import load_cases

CASES_FILE = PACKAGE_ROOT / "evals" / "golden" / "cases.yaml"
# near-duplicates the user dropped at curation (not in cases.yaml)
DROPPED_NEAR_DUPLICATES = ("e4b33dc8", "c2d5c1f8", "a6fb0071")

_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{5,}")
_LITERAL = re.compile(r"""(?:'([^'\n]{8,40})'|"([^"\n]{8,40})"|\[([a-z_ ]{4,20})\])""")
_FILE = re.compile(r"^diff --git a/(\S+) b/", re.MULTILINE)
_PLAIN_WORD = re.compile(r"^[a-z]+$")
GENERIC = {
    "constructor",
    "function",
    "describe",
    "expect",
    "import",
    "export",
    "return",
    "default",
    "interface",
    "private",
    "readonly",
    "string",
    "number",
    "boolean",
    "undefined",
    "console",
    "options",
    "service",
    "module",
    "require",
    "provide",
    "providers",
    "imports",
    "exports",
    "injectable",
    "override",
    "component",
    "message",
    "messages",
    "content",
    "context",
    "request",
    "response",
    "result",
    "results",
    "status",
    "config",
    "settings",
    "payload",
    "params",
    "value",
    "values",
    "length",
    "object",
    "assert",
    "pytest",
    "fixture",
    "mocker",
    "monkeypatch",
    "typescript",
    "javascript",
    "python",
    "usestate",
    "useeffect",
    "usecallback",
    "usememo",
    "children",
    "classname",
    "onclick",
    "onchange",
    "disabled",
    "loading",
    "error",
    "errors",
    "warning",
    "logger",
    "logging",
    "timeout",
    "promise",
    "resolve",
    "reject",
    "finally",
    "exception",
    "exceptions",
    "nullable",
    "optional",
    "required",
    "validate",
    "validation",
    "description",
    "transaction",
    "repository",
    "controller",
    "entity",
    "entities",
    "column",
    "columns",
    "tenant",
    "tenantid",
    "userid",
    "session",
    "sessions",
    "scenario",
    "scenarios",
    "course",
    "courses",
    "language",
    "languages",
    "translation",
    "translations",
    "english",
    "history",
    "elements",
    "element",
    "internal",
    "external",
    "enabled",
    "disabled",
    "complete",
    "completed",
    "pending",
    "running",
    "success",
    "failure",
    "failed",
    "testing",
    "tests",
    "spec",
    "specs",
    "mock",
    "mocks",
    "mocked",
    "stub",
    "stubs",
    "render",
    "screen",
    "fireevent",
    "waitfor",
    "getbyrole",
    "getbytext",
    "button",
    "textbox",
    "submit",
    "handlesubmit",
    "parsed",
    "number",
    "isfinite",
    "value",
    "returns",
    "return",
    "const",
    "class",
    "async",
    "await",
    "static",
    "public",
    "protected",
    "extends",
    "implements",
    "throws",
    "typeof",
    "instanceof",
    # test-framework API names
    "tohavebeencalled",
    "tohavebeencalledwith",
    "tohavebeencalledtimes",
    "tobeinthedocument",
    "tohavelength",
    "tostrictequal",
    "tomatchobject",
    "mockresolvedvalue",
    "mockreturnvalue",
    "mockimplementation",
    "beforeeach",
    "aftereach",
    "beforeall",
    "afterall",
    "testwidgets",
    "pumpwidget",
    "pumpandsettle",
    "findsonewidget",
    "findsnothing",
    "assertequal",
}


def _git_show(repo_root: Path, sha: str, paths: Iterable[str]) -> str:
    args = [
        "git",
        "-C",
        str(repo_root),
        "show",
        "--format=",
        "--unified=0",
        sha,
        "--",
        *paths,
    ]
    out = subprocess.run(args, capture_output=True, text=True)
    return out.stdout if out.returncode == 0 else ""


def terms_from_diff(diff: str) -> set[str]:
    terms: set[str] = set()
    for path in _FILE.findall(diff):
        stem = Path(path).name
        for suffix in (
            ".spec.ts",
            ".test.tsx",
            ".test.ts",
            ".spec.tsx",
            "_test.dart",
            ".py",
            ".ts",
            ".tsx",
            ".dart",
        ):
            if stem.endswith(suffix):
                stem = stem[: -len(suffix)]
                break
        # a plain English word as a file name ('resolver') is not distinctive
        if len(stem) >= 10 or any(c in stem for c in "-_."):
            terms.add(stem.lower())
    for line in diff.splitlines():
        if line[:1] not in "+-" or line.startswith(("+++", "---")):
            continue
        for ident in _IDENT.findall(line):
            low = ident.lower()
            if low in GENERIC:
                continue
            # camelCase / PascalCase with a second hump; a capitalised English word
            # ('Regression', 'Authorization') is not an identifier signal
            camel = any(ch.isupper() for ch in ident[1:]) and ident != ident.upper()
            distinctive = (
                ("_" in ident and len(ident) >= 8)
                or (camel and len(ident) >= 10)
                or len(ident) >= 16
            )
            if distinctive:
                terms.add(low)
        for match in _LITERAL.finditer(line):
            literal = next(g for g in match.groups() if g).strip()
            if match.group(3):  # [laughs]-style tags keep their brackets
                terms.add(f"[{literal.lower()}]")
            elif (
                literal
                and not literal.isdigit()
                and not _PLAIN_WORD.match(literal.lower())
            ):
                # a plain word ('configuration') is not distinctive; a phrase or
                # anything with punctuation, spaces or digits is
                terms.add(literal.lower())
    return terms


def eval_case_terms(
    repo_root: Path, cases_file: Path = CASES_FILE
) -> dict[str, set[str]]:
    """``{case id: terms}`` for every case in cases.yaml (any status) and the dropped
    near-duplicates, from the fix commit's (or clean commit's) own diff."""
    case_file = load_cases(cases_file)
    out: dict[str, set[str]] = {}
    for case in case_file.cases:
        app_path = "" if case.layout == "root" else None
        paths = [] if app_path == "" else []
        diff = _git_show(repo_root, case.commit, paths)
        out[case.id] = terms_from_diff(diff)
    for short in DROPPED_NEAR_DUPLICATES:
        diff = _git_show(repo_root, short, [])
        out[f"dropped-{short}"] = terms_from_diff(diff)
    return out


def leaks_in(text: str, terms: dict[str, set[str]]) -> list[tuple[str, str]]:
    """``[(case id, term)]`` for every distinctive term that appears in ``text``."""
    low = text.lower()
    found = []
    for case_id, case_terms in terms.items():
        for term in sorted(case_terms):
            if re.search(r"(?<![a-z0-9_])" + re.escape(term) + r"(?![a-z0-9_])", low):
                found.append((case_id, term))
    return found
