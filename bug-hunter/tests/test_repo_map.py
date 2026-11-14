"""Repo map on small fixture projects: symbols, DI-resolved calls, callers/callees,
tests_for, neighbourhood, incremental cache."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.repo_map import (
    RepoMap,
    build_map,
    parse_unified_diff,
    prune_cache,
    resolve_import,
)
from tests.fixtures.repo_map.projects import TS_PROJECT, make_repo


@pytest.fixture(scope="module")
def repo(tmp_path_factory) -> Path:
    return make_repo(tmp_path_factory.mktemp("fixture-repo"))


@pytest.fixture(scope="module")
def cache(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("cache")


@pytest.fixture(scope="module")
def maps(repo: Path, cache: Path):
    from bug_hunter.config import load_config

    config = load_config(env={})
    out = {}
    for app in ("ally-be", "ally-web", "ally-ai", "ally-mobile"):
        out[app] = build_map(config, app, root=repo, cache_root=cache)
    return out


def test_typescript_symbols_and_decorators(maps) -> None:
    m: RepoMap = maps["ally-be"][0]
    outline = m.outline("src/auth/auth.service.ts")
    assert "class     AuthService" in outline
    assert "method    AuthService.login" in outline and "@Post('login')" in outline
    assert "AuthService.validate (private)" not in outline  # methods count as exported
    util = {s.qualified: s.kind for s in m.files["src/util.ts"].symbols}
    assert util == {"helper": "function", "MAX": "constant", "internal": "function"}
    assert not next(
        s for s in m.files["src/util.ts"].symbols if s.name == "internal"
    ).exported


def test_nestjs_di_resolution(maps) -> None:
    m: RepoMap = maps["ally-be"][0]
    assert m.files["src/auth/auth.service.ts"].fields == {
        "AuthService": {"userService": "UserService", "jwt": "JwtService"}
    }
    callees = {(e.callee, e.method) for e in m.callees("AuthService.login")}
    assert ("src/user/user.service.ts::UserService.findByEmail", "di") in callees
    assert ("src/auth/auth.service.ts::AuthService.validate", "self") in callees
    assert ("src/util.ts::helper", "import") in callees
    # jwt.sign has no symbol in the app: unresolved, not guessed
    assert ("src/auth/auth.service.ts::AuthService.validate", "self") in callees
    assert any(name == "sign" for _c, name, _r in m.unresolved)
    stats = maps["ally-be"][1]
    assert stats.resolved_by["di"] == 1
    assert stats.resolution_share() > stats.resolution_share(exclude=("di",))


def test_callers_and_same_file(maps) -> None:
    m: RepoMap = maps["ally-be"][0]
    callers = {e.caller for e in m.callers("UserService.findByEmail")}
    assert "src/auth/auth.service.ts::AuthService.login" in callers
    same_file = {(e.callee, e.method) for e in m.callees("UserService.findOne")}
    assert ("src/user/user.service.ts::lookup", "same_file") in same_file


def test_tests_for(maps) -> None:
    be: RepoMap = maps["ally-be"][0]
    assert be.tests_for("src/auth/auth.service.ts") == [
        "src/auth/test/auth.service.spec.ts"
    ]
    assert be.tests_for("src/user/user.service.ts") == ["src/user/user.service.spec.ts"]
    assert "src/user/user.service.spec.ts" in be.tests_for("UserService.findOne")
    web: RepoMap = maps["ally-web"][0]
    assert web.tests_for("apps/app/src/utils/fmt.ts") == [
        "apps/app/src/utils/__tests__/fmt.test.ts"
    ]
    py: RepoMap = maps["ally-ai"][0]
    assert py.tests_for("app/core/service.py") == ["tests/core/test_service.py"]
    dart: RepoMap = maps["ally-mobile"][0]
    assert dart.tests_for("lib/features/home.dart") == ["test/features/home_test.dart"]


def test_python_and_dart_resolution(maps) -> None:
    py: RepoMap = maps["ally-ai"][0]
    callees = {(e.callee, e.method) for e in py.callees("Service.run")}
    assert ("app/core/service.py::Service.helper", "self") in callees
    assert ("app/core/util.py::util_fn", "import") in callees
    run_endpoint = py.find_symbol("run_endpoint")[0]
    assert run_endpoint.decorators == ["@router.post('/run')"]
    assert {s.qualified for s in py.files["app/core/util.py"].symbols} == {
        "util_fn",
        "MAX_ITEMS",
    }
    dart: RepoMap = maps["ally-mobile"][0]
    callees = {(e.callee, e.method) for e in dart.callees("Home.load")}
    assert ("lib/core/api.dart::Api.fetch", "di") in callees
    assert ("lib/features/home.dart::helper", "same_file") in callees
    assert "kMax" in {s.name for s in dart.files["lib/features/home.dart"].symbols}


def test_tsx_and_find_symbol(maps) -> None:
    web: RepoMap = maps["ally-web"][0]
    assert {(e.callee, e.method) for e in web.callees("Card")} == {
        ("apps/app/src/utils/fmt.ts::fmt", "import")
    }
    assert [s.qualified for s in web.find_symbol("fm")] == ["fmt"]
    assert web.find_symbol("Card.tsx")[0].qualified == "Card"
    assert web.outline("nope.ts").startswith("nope.ts: not in the map")


def test_neighbourhood_from_diff(maps) -> None:
    m: RepoMap = maps["ally-be"][0]
    diff = (
        "diff --git a/ally-be/src/user/user.service.ts "
        "b/ally-be/src/user/user.service.ts\n"
        "--- a/ally-be/src/user/user.service.ts\n"
        "+++ b/ally-be/src/user/user.service.ts\n"
        "@@ -5,1 +5,2 @@\n+  // changed findByEmail\n"
    )
    hood = m.neighbourhood(diff)
    assert hood.changed_files == ["ally-be/src/user/user.service.ts"]
    assert [i.symbol.qualified for i in hood.items] == ["UserService.findByEmail"]
    item = hood.items[0]
    assert [e.caller for e in item.callers] == [
        "src/auth/auth.service.ts::AuthService.login"
    ]
    assert [e.callee for e in item.callees] == [
        "src/user/user.service.ts::UserService.findOne"
    ]
    assert item.tests == ["src/user/user.service.spec.ts"]
    text = hood.render()
    assert (
        "## method UserService.findByEmail" in text
        and "tests: src/user/user.service.spec.ts" in text
    )


def test_parse_unified_diff() -> None:
    diff = (
        "--- a/x.py\n+++ b/x.py\n@@ -1,3 +1,4 @@\n@@ -10 +11 @@\n"
        "--- a/old\n+++ /dev/null\n"
    )
    assert parse_unified_diff(diff) == {"x.py": [(1, 4), (11, 11)]}


def test_import_resolution_rules() -> None:
    known = {
        "src/a/b.ts",
        "src/a/index.ts",
        "lib/core/api.dart",
        "app/core/util.py",
        "app/pkg/__init__.py",
    }
    assert resolve_import("./b", "src/a/c.ts", "typescript", known, "x") == "src/a/b.ts"
    assert resolve_import("..", "src/a/c.ts", "typescript", known, "x") is None
    assert (
        resolve_import("../a", "src/z/c.ts", "typescript", known, "x")
        == "src/a/index.ts"
    )
    assert (
        resolve_import("src/a/b", "src/z/c.ts", "typescript", known, "x")
        == "src/a/b.ts"
    )
    assert (
        resolve_import("@nestjs/common", "src/z/c.ts", "typescript", known, "x") is None
    )
    assert (
        resolve_import("app.core.util", "app/x.py", "python", known, "x")
        == "app/core/util.py"
    )
    assert (
        resolve_import("app.pkg", "app/x.py", "python", known, "x")
        == "app/pkg/__init__.py"
    )
    assert (
        resolve_import(
            "package:ally_mobile_flutter/core/api.dart",
            "lib/x.dart",
            "dart",
            known,
            "x",
        )
        == "lib/core/api.dart"
    )
    assert resolve_import("dart:io", "lib/x.dart", "dart", known, "x") is None


def test_cache_is_written_reused_incrementally_and_pruned(
    config: BugHunterConfig, tmp_path: Path
) -> None:
    repo = make_repo(tmp_path / "repo", {"ally-be": TS_PROJECT})
    cache = tmp_path / "cache"
    _m, first = build_map(config, "ally-be", root=repo, cache_root=cache)
    assert first.files_parsed == 5 and first.files_reused == 0 and first.cache_bytes > 0
    _m, again = build_map(config, "ally-be", root=repo, cache_root=cache)
    assert (
        again.files_reused == 5 and again.files_parsed == 0
    )  # same commit: loaded whole
    (repo / "ally-be/src/util.ts").write_text(
        "export function helper(x: unknown) { return x; }\n"
    )
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-qam",
            "fix: util",
        ],
        cwd=repo,
        check=True,
    )
    _m, third = build_map(config, "ally-be", root=repo, cache_root=cache)
    assert third.files_parsed == 1 and third.files_reused == 4  # only util.ts re-parsed
    assert (
        len(list((cache / "repo-map/ally-be").glob("*.json.gz")))
        == config.limits.context.repo_map_keep_commits
    )
    assert (
        prune_cache("ally-be", 1, cache)
        and len(list((cache / "repo-map/ally-be").glob("*.json.gz"))) == 1
    )
