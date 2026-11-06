"""The tools as LangChain ``StructuredTool``s with Pydantic argument schemas.

Three bundles so each node binds only what it may do (spec §5): read-only file
system and git for ``investigate``, writes for ``reproduce`` and ``fix``, and the
runner for both. Errors come back to the model as text, not exceptions.
"""

from __future__ import annotations

from pathlib import Path

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from bug_hunter.tools.fs import Workspace
from bug_hunter.tools.git import Git
from bug_hunter.tools.runner import Runner


class ListDirArgs(BaseModel):
    path: str = Field(".", description="Directory, relative to the app (e.g. src/user)")
    depth: int = Field(1, ge=1, le=4, description="How many levels to list")


class GlobArgs(BaseModel):
    pattern: str = Field(
        ..., description="Glob relative to the app, e.g. src/**/*.spec.ts"
    )
    max_results: int = Field(200, ge=1, le=500)


class GrepArgs(BaseModel):
    pattern: str = Field(..., description="Regular expression")
    path: str = Field(
        ".", description="File or directory to search, relative to the app"
    )
    max_results: int = Field(50, ge=1, le=200)


class ReadFileArgs(BaseModel):
    path: str = Field(..., description="File relative to the app")
    start_line: int = Field(1, ge=1)
    end_line: int | None = Field(
        None, description="Inclusive; at most 400 lines per call"
    )


class EditFileArgs(BaseModel):
    path: str = Field(..., description="File relative to the app")
    old_str: str = Field(
        ..., description="Exact text to replace; must occur exactly once"
    )
    new_str: str = Field(..., description="Replacement text")


class WriteTestFileArgs(BaseModel):
    path: str = Field(
        ..., description="New test file, relative to the app, in a test location"
    )
    content: str


class GitLogArgs(BaseModel):
    path: str | None = Field(None, description="Limit to this path (worktree-relative)")
    n: int = Field(10, ge=1, le=50)


class GitBlameArgs(BaseModel):
    path: str = Field(
        ..., description="File, worktree-relative (e.g. ally-be/src/x.ts)"
    )
    start: int = Field(..., ge=1)
    end: int = Field(..., ge=1)


class GitDiffArgs(BaseModel):
    paths: list[str] = Field(default_factory=list, description="Limit to these paths")


class RunTestsArgs(BaseModel):
    target: str | None = Field(
        None, description="One test file relative to the app; omit for the whole suite"
    )
    name: str | None = Field(None, description="One test name inside the target file")


class NoArgs(BaseModel):
    pass


def _tool(func, name: str, description: str, schema: type[BaseModel]) -> StructuredTool:
    def guarded(**kwargs):
        try:
            return func(**kwargs)
        except (
            Exception
        ) as exc:  # noqa: BLE001 - the model needs the message, not a crash
            return f"error: {exc}"

    return StructuredTool.from_function(
        func=guarded,
        name=name,
        description=description,
        args_schema=schema,
        handle_validation_error=True,
    )


def read_tools(workspace: Workspace, git: Git | None = None) -> list[StructuredTool]:
    tools = [
        _tool(workspace.list_dir, "list_dir", "List files and folders.", ListDirArgs),
        _tool(workspace.glob, "glob", "Find files by glob pattern.", GlobArgs),
        _tool(workspace.grep, "grep", "Search file contents by regex.", GrepArgs),
        _tool(
            workspace.read_file,
            "read_file",
            "Read a file, or a line range of it, with line numbers.",
            ReadFileArgs,
        ),
    ]
    if git is not None:
        worktree = Path(workspace.worktree)
        tools += [
            _tool(
                lambda path=None, n=10: git.log(worktree, path, n),
                "git_log",
                "Recent commits, optionally for one path.",
                GitLogArgs,
            ),
            _tool(
                lambda path, start, end: git.blame(worktree, path, start, end),
                "git_blame",
                "Who last changed each line in a range.",
                GitBlameArgs,
            ),
            _tool(
                lambda paths=(): git.diff(worktree, list(paths)),
                "git_diff",
                "Uncommitted changes in the worktree.",
                GitDiffArgs,
            ),
        ]
    return tools


def write_tools(workspace: Workspace) -> list[StructuredTool]:
    return [
        _tool(
            workspace.edit_file,
            "edit_file",
            "Replace one exact occurrence of old_str with new_str in a file.",
            EditFileArgs,
        ),
        _tool(
            workspace.write_test_file,
            "write_test_file",
            "Create a new test file in the app's test location. Never overwrites.",
            WriteTestFileArgs,
        ),
    ]


def _result_text(result) -> str:
    text = result.summary()
    if result.excerpt and (not result.passed or result.timed_out):
        text += "\n" + result.excerpt
    return text


def runner_tools(runner: Runner) -> list[StructuredTool]:
    return [
        _tool(
            lambda target=None, name=None: _result_text(runner.run_tests(target, name)),
            "run_tests",
            "Run the app's tests in the sandbox: whole suite, one file, or one test.",
            RunTestsArgs,
        ),
        _tool(
            lambda: _result_text(runner.run_lint()),
            "run_lint",
            "Run the app's lint in the sandbox.",
            NoArgs,
        ),
        _tool(
            lambda: _result_text(runner.run_typecheck()),
            "run_typecheck",
            "Run the app's typecheck in the sandbox.",
            NoArgs,
        ),
    ]
