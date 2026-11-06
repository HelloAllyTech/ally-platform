"""LangChain tool wrappers: right names and bundles, errors returned as text."""

from __future__ import annotations

from pathlib import Path

from bug_hunter.config import BugHunterConfig
from bug_hunter.tools.fs import Workspace
from bug_hunter.tools.lc import read_tools, runner_tools, write_tools
from bug_hunter.tools.runner import Runner
from tests.test_runner import FakeSandbox


def _workspace(tmp_path: Path, config: BugHunterConfig) -> Workspace:
    (tmp_path / "ally-be/src/test").mkdir(parents=True)
    (tmp_path / "ally-be/src/a.ts").write_text("const a = 1;\n")
    return Workspace(tmp_path, config, "ally-be")


def test_bundles_and_invocation(tmp_path: Path, config: BugHunterConfig) -> None:
    ws = _workspace(tmp_path, config)
    reads = read_tools(ws)
    writes = write_tools(ws)
    runs = runner_tools(Runner(config, FakeSandbox("ally-be")))
    assert [t.name for t in reads] == ["list_dir", "glob", "grep", "read_file"]
    assert [t.name for t in writes] == ["edit_file", "write_test_file"]
    assert [t.name for t in runs] == ["run_tests", "run_lint", "run_typecheck"]
    assert "a.ts" in reads[0].invoke({"path": "."})
    assert "1| const a = 1;" in reads[3].invoke({"path": "src/a.ts"})
    assert runs[0].invoke({}) == "ally-be test: passed in 1.5s"
    assert runs[0].args_schema.model_json_schema()["properties"]["target"]


def test_errors_come_back_as_text(tmp_path: Path, config: BugHunterConfig) -> None:
    ws = _workspace(tmp_path, config)
    out = read_tools(ws)[3].invoke({"path": "../.env"})
    assert "denied" in out or "outside" in out
    out = write_tools(ws)[0].invoke(
        {"path": "src/a.ts", "old_str": "zzz", "new_str": "y"}
    )
    assert "not found" in out
    out = write_tools(ws)[1].invoke({"path": "src/helper.ts", "content": "x"})
    assert "not a test location" in out
