"""Outline-first read_file: a long file's first default read returns the outline and a
hint; ranges, second reads and short files behave as before."""

from __future__ import annotations

from pathlib import Path

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.tools import cheap_outline, outline_first_read_tools
from bug_hunter.tools.fs import Workspace


def _deps(config: BugHunterConfig, tmp_path: Path) -> GraphDeps:
    root = tmp_path / "wt"
    (root / "ally-be/src").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text("{}")
    big = ["export class Worker {", "  run() {}", "}"] + [
        f"const v{i} = {i};" for i in range(1000)
    ]
    big += ["export function helper() {}", "function hidden() {}"]
    (root / "ally-be/src/worker.ts").write_text("\n".join(big) + "\n")
    (root / "ally-be/src/small.ts").write_text("export const small = 1;\n")
    cfg = config.model_copy(update={"repo_root": root})
    return GraphDeps(
        config=cfg,
        run_id="r",
        app="ally-be",
        mode="issue",
        worktree=root,
        app_root=root / "ally-be",
        workspace=Workspace(root, cfg, "ally-be"),
        models={},
        scratchpad=Scratchpad(tmp_path / "pad.md"),
        write_artefact=lambda n, c: tmp_path / n,
    )


def test_first_read_of_a_long_file_returns_its_outline(config, tmp_path) -> None:
    deps = _deps(config, tmp_path)
    read = next(t for t in outline_first_read_tools(deps) if t.name == "read_file")
    first = read.invoke({"path": "src/worker.ts"})
    assert "1005 lines, more than 800" in first and "outline instead" in first
    assert "export class Worker" in first and "export function helper" in first
    assert "const v500" not in first  # declarations only, not the body
    # the second default read, and any explicit range, return real content
    second = read.invoke({"path": "src/worker.ts"})
    assert "lines 1-400 of 1005" in second and "const v100 = 100;" in second
    ranged = read.invoke(
        {"path": "src/worker.ts", "start_line": 1000, "end_line": 1005}
    )
    assert "lines 1000-1005" in ranged
    # short files are untouched
    assert "export const small" in read.invoke({"path": "src/small.ts"})
    # other read tools are still there
    assert {t.name for t in outline_first_read_tools(deps)} >= {
        "grep",
        "glob",
        "list_dir",
    }


def test_cheap_outline_lists_declarations_with_line_numbers(tmp_path) -> None:
    f = tmp_path / "a.py"
    f.write_text(
        "import os\n\nclass A:\n    def m(self):\n        pass\n\n"
        "def top():\n    x = 1\n"
    )
    text = cheap_outline(f, "a.py")
    assert (
        "a.py (8 lines)" in text and "3  class A:" in text and "7  def top():" in text
    )
    assert "x = 1" not in text
