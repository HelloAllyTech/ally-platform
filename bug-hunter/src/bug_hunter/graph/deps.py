"""Everything the nodes need that is not state: tools, models, context, the run.
Built once per run (``GraphDeps.for_run``) or assembled by tests with fakes."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from langchain_core.runnables import Runnable
from langgraph.checkpoint.base import BaseCheckpointSaver

from bug_hunter.config import BugHunterConfig
from bug_hunter.context.app_context import AppContext, load_app_context
from bug_hunter.context.repo_map import RepoMap, build_map
from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.context.tokens import TokenCounter, make_counter
from bug_hunter.models import get_model
from bug_hunter.runs import Run
from bug_hunter.tools.fs import Workspace
from bug_hunter.tools.git import Git
from bug_hunter.tools.runner import Runner


@dataclass
class GraphDeps:
    config: BugHunterConfig
    run_id: str
    app: str
    mode: str
    worktree: Path
    app_root: Path
    workspace: Workspace
    models: dict[str, Runnable]  # role -> chat model
    scratchpad: Scratchpad
    write_artefact: Callable[[str, str], Path]
    git: Git | None = None
    runner: Runner | None = None
    repo_map: RepoMap | None = None
    app_context: AppContext | None = None
    counter: TokenCounter | None = None
    checkpointer: BaseCheckpointSaver | None = None
    diff: str = ""  # sweep mode: the commit's diff, scrubbed
    ref: str = ""
    sandbox_ready: bool = False
    _ensure_sandbox: Callable[[], None] | None = field(default=None, repr=False)
    tool_log: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.counter is None:
            self.counter = make_counter(
                self.config.limits.context.chars_per_token_offline
            )[0]

    def ensure_sandbox(self) -> None:
        """Image + dependency install, once, the first time a test must run."""
        if self.sandbox_ready:
            return
        if self._ensure_sandbox is not None:
            self._ensure_sandbox()
        self.sandbox_ready = True

    def model(self, role: str) -> Runnable:
        if role not in self.models:
            self.models[role] = get_model(role, self.config)
        return self.models[role]

    @classmethod
    def for_run(
        cls,
        config: BugHunterConfig,
        run: Run,
        app: str,
        mode: str,
        app_root: Path | None = None,
        models: dict[str, Runnable] | None = None,
        diff: str = "",
        ref: str = "",
        checkpointer: BaseCheckpointSaver | None = None,
        with_repo_map: bool = True,
    ) -> "GraphDeps":
        assert run.worktree is not None
        worktree = Path(run.worktree)
        app_root = Path(app_root) if app_root else worktree / config.app(app).path
        workspace = Workspace(worktree, config, app, app_root=app_root)
        runner = Runner(config, run.sandbox) if run.sandbox is not None else None
        repo_map = None
        if with_repo_map:
            try:
                repo_map, _stats = build_map(config, app, root=worktree)
            except Exception:  # noqa: BLE001 - the map is help, not a requirement
                repo_map = None
        try:
            app_context = load_app_context(config, app, ref or run.ref, root=worktree)
        except Exception:  # noqa: BLE001
            app_context = None
        counter, _source = make_counter(config.limits.context.chars_per_token_offline)

        def ensure_sandbox() -> None:
            if run.sandbox is not None:
                run.sandbox.ensure_image()
                run.sandbox.install()

        return cls(
            config=config,
            run_id=run.run_id,
            app=app,
            mode=mode,
            worktree=worktree,
            app_root=app_root,
            workspace=workspace,
            models=dict(models or {}),
            scratchpad=Scratchpad(run.scratchpad_path),
            write_artefact=run.write_artefact,
            git=run.git,
            runner=runner,
            repo_map=repo_map,
            app_context=app_context,
            counter=counter,
            checkpointer=checkpointer,
            diff=diff,
            ref=ref or run.ref,
            _ensure_sandbox=ensure_sandbox,
        )
