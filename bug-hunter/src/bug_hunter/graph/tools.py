"""Graph-side wrappers over the chunk 02 tools.

``outline_first_read_tools``: the first ``read_file`` of a long file (over
``limits.context.outline_first_min_lines``) with no explicit range returns the file's
outline (symbols with line numbers, from the repo map or a cheap scan) plus a hint to
use ``find_symbol`` or a line range. The 995242d7 issue run read a 4 700-line file
eleven times in 400-line slices; prose told the agent to use the outline first, code
now makes the linear read impossible by accident.
"""

from __future__ import annotations

import re
from pathlib import Path

from langchain_core.tools import StructuredTool

from bug_hunter.graph.deps import GraphDeps
from bug_hunter.tools.lc import ReadFileArgs, read_tools

# Structural declarations always count; variables only when exported, otherwise a
# file of constants drowns the classes and functions the agent is looking for.
_DEF = re.compile(
    r"^(?P<indent>\s*)(?P<export>export\s+)?(?:default\s+)?(?:async\s+)?"
    r"(?P<kind>abstract class|class|def|function|interface|enum|mixin"
    r"|type|const|let|var)"
    r"\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)"
)
_VARIABLE_KINDS = ("const", "let", "var", "type")


def cheap_outline(path: Path, display: str, max_items: int = 120) -> str:
    """Top-level-ish declarations with line numbers when the repo map has no entry."""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    items = []
    for number, line in enumerate(lines, 1):
        match = _DEF.match(line)
        if (
            match
            and len(match.group("indent")) <= 4
            and (match.group("kind") not in _VARIABLE_KINDS or match.group("export"))
        ):
            items.append(f"  {number:>5}  {line.strip()[:100]}")
            if len(items) >= max_items:
                items.append("  … (more declarations omitted)")
                break
    head = f"{display} ({len(lines)} lines): declarations"
    return head + ("\n" + "\n".join(items) if items else "\n  (none found)")


def outline_first_read_tools(deps: GraphDeps) -> list[StructuredTool]:
    """``read_tools`` with ``read_file`` replaced by the outline-first variant."""
    tools = read_tools(deps.workspace, deps.git)
    plain = next(t for t in tools if t.name == "read_file")
    workspace = deps.workspace
    min_lines = deps.config.limits.context.outline_first_min_lines
    outlined: set[str] = set()

    def read_file(path: str, start_line: int = 1, end_line: int | None = None) -> str:
        explicit_range = end_line is not None or start_line > 1
        if not explicit_range:
            try:
                file = workspace.policy.check_read(workspace._abs(path))
                count = (
                    sum(1 for _ in file.open("r", encoding="utf-8", errors="replace"))
                    if file.is_file()
                    else 0
                )
            except Exception:  # noqa: BLE001 - let the real tool report the error
                count = 0
            display = workspace._display(file) if count else path
            if count > min_lines and display not in outlined:
                outlined.add(display)
                outline = None
                if deps.repo_map is not None:
                    text = deps.repo_map.outline(display)
                    if "not in the map" not in text:
                        outline = text
                if outline is None:
                    outline = cheap_outline(file, display)
                return (
                    f"{display} has {count} lines, more than {min_lines}: here is its "
                    "outline instead of the first 400 lines. Use find_symbol or "
                    "callers/callees to locate what you need, then read_file with "
                    "start_line and end_line around it (at most 400 lines per "
                    "call).\n\n" + outline
                )
        return plain.invoke(
            {"path": path, "start_line": start_line, "end_line": end_line}
        )

    guarded = StructuredTool.from_function(
        func=read_file,
        name="read_file",
        description=(
            "Read a file, or a line range of it, with line numbers. The first read of "
            "a long file returns its outline; then read ranges."
        ),
        args_schema=ReadFileArgs,
        handle_validation_error=True,
    )
    return [guarded if t.name == "read_file" else t for t in tools]


def fix_edit_tool(deps: GraphDeps, protected: list[str]) -> StructuredTool:
    """``edit_file`` for the fix node: exact single replace, and the fix rules enforced
    before anything is written (no tests, no test/CI config, no risk paths, never the
    reproduction test files)."""
    from bug_hunter.tools.lc import EditFileArgs

    workspace = deps.workspace

    def edit_file(path: str, old_str: str, new_str: str) -> str:
        try:
            target = workspace._abs(path)
            workspace.policy.check_fix_write(target, deps.app, protected)
            return workspace.edit_file(path, old_str, new_str)
        except Exception as exc:  # noqa: BLE001 - the model needs the message
            return f"error: {exc}"

    return StructuredTool.from_function(
        func=edit_file,
        name="edit_file",
        description=(
            "Replace one exact occurrence of old_str with new_str in a source file. "
            "Tests, test/CI configuration and risk paths are refused."
        ),
        args_schema=EditFileArgs,
        handle_validation_error=True,
    )


def repro_only_run_tests(
    deps: GraphDeps, test_path: str, test_name: str
) -> StructuredTool:
    """``run_tests`` that can only run the reproduction test (the fix loop's signal)."""
    from bug_hunter.tools.lc import NoArgs

    def run_repro() -> str:
        if deps.runner is None:
            return "error: no sandbox available in this run"
        deps.ensure_sandbox()
        result = deps.runner.run_tests(test_path, test_name)
        text = result.summary()
        if result.excerpt and (not result.passed or result.timed_out):
            text += "\n" + result.excerpt
        return text

    return StructuredTool.from_function(
        func=run_repro,
        name="run_repro_test",
        description=(
            f"Run the reproduction test {test_path}::{test_name} in the sandbox."
        ),
        args_schema=NoArgs,
    )


def lint_tool(deps: GraphDeps) -> StructuredTool:
    """``run_lint`` for the fix loop: the app's lint in the sandbox, tail only."""
    from bug_hunter.tools.lc import NoArgs

    def run_lint() -> str:
        if deps.runner is None:
            return "error: no sandbox available in this run"
        deps.ensure_sandbox()
        result = deps.runner.run_lint()
        text = result.summary()
        if result.excerpt and not result.passed:
            text += "\n" + result.excerpt[-3000:]
        return text

    return StructuredTool.from_function(
        func=run_lint,
        name="run_lint",
        description="Run the app's lint in the sandbox (slow; once the repro passes).",
        args_schema=NoArgs,
    )
