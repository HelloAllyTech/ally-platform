"""The model-backed commit sweep (chunk 08): five lens passes on gpt-5-mini and a
falsifier on Gemini 2.5 Pro (a different family, with read tools).

Both run over one app's batch of commits in a worktree at the batch's last commit,
through a ``GraphDeps`` built for that worktree (read tools, repo map, app context,
token counter). Every call is charged to a ``Budget`` so the daily job can record the
real cost in the ledger.
"""

from __future__ import annotations

import time
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from bug_hunter.context.tokens import truncate_to_tokens
from bug_hunter.graph.budget import charge
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.llm import call_structured
from bug_hunter.graph.loop import LoopState, ToolLoop, initial_messages, run_loop
from bug_hunter.graph.prompts import load_prompt
from bug_hunter.graph.state import CATEGORIES, Budget
from bug_hunter.graph.tools import outline_first_read_tools
from bug_hunter.safety.phi import scrub_code
from bug_hunter.signals.commit_sweep import LensFinding, StopSweep

DIFF_MAX_TOKENS = 6000
NEIGHBOURHOOD_MAX_TOKENS = 4000
FALSIFIER_MAX_TURNS = 10


class LensItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    category: str = Field(description=f"One of: {', '.join(CATEGORIES)}")
    severity: Literal["critical", "high", "medium", "low"]
    files: list[str]
    evidence: list[str] = Field(description="`path:line — observation` items")
    hypothesis: str
    confidence: Literal["medium", "low"]
    safety: bool = Field(
        default=False,
        description="True only for a change that weakens crisis detection, "
        "guardrails or safety escalation",
    )


class LensAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    findings: list[LensItem] = Field(default_factory=list, max_length=3)


class SubmitVerdict(BaseModel):
    """Finish: your verdict on the finding."""

    model_config = ConfigDict(extra="forbid")

    verdict: Literal["survives", "refuted"]
    confidence: Literal["medium", "low"]
    reason: str = Field(description="What you checked, with path:line")


def _noop(**_: Any) -> str:
    return "ok"


def sweep_deps(config, app: str, worktree, sha: str, diff: str, artefacts_dir):
    """``GraphDeps`` over a sparse checkout: read tools, repo map, app context. No run,
    no sandbox (the sweep only reads code)."""
    from pathlib import Path

    from bug_hunter.context.app_context import load_app_context
    from bug_hunter.context.repo_map import build_map
    from bug_hunter.context.scratchpad import Scratchpad
    from bug_hunter.context.tokens import make_counter
    from bug_hunter.tools.fs import Workspace

    worktree = Path(worktree)
    artefacts_dir = Path(artefacts_dir)
    artefacts_dir.mkdir(parents=True, exist_ok=True)
    app_root = worktree / config.app(app).path

    def write_artefact(name: str, content: str) -> Path:
        path = artefacts_dir / name
        path.write_text(content, encoding="utf-8")
        return path

    try:
        repo_map, _ = build_map(config, app, root=worktree, commit=sha)
    except Exception:  # noqa: BLE001 - help, not a requirement
        repo_map = None
    try:
        app_context = load_app_context(config, app, sha, root=worktree)
    except Exception:  # noqa: BLE001
        app_context = None
    return GraphDeps(
        config=config,
        run_id=f"sweep-{app}-{sha[:10]}",
        app=app,
        mode="sweep",
        worktree=worktree,
        app_root=app_root,
        workspace=Workspace(worktree, config, app, app_root=app_root),
        models={},
        scratchpad=Scratchpad(artefacts_dir / f"scratchpad-{app}.md"),
        write_artefact=write_artefact,
        repo_map=repo_map,
        app_context=app_context,
        counter=make_counter(config.limits.context.chars_per_token_offline)[0],
        diff=diff,
        ref=sha,
    )


class ModelSweep:
    """Lens runner and falsifier for one app batch (implements both interfaces)."""

    def __init__(
        self,
        deps: GraphDeps,
        diff: str,
        spent_before: float = 0.0,
        max_cost_usd: float | None = None,
    ):
        self.deps = deps
        self.budget = Budget()
        self.spent_before = spent_before
        self.max_cost_usd = max_cost_usd
        self.diff = truncate_to_tokens(scrub_code(diff), DIFF_MAX_TOKENS, deps.counter)
        nb = ""
        if deps.repo_map is not None:
            try:
                nb = deps.repo_map.neighbourhood(diff, max_items=25).render(max_edges=8)
            except Exception:  # noqa: BLE001 - help, not a requirement
                nb = ""
        self.neighbourhood = (
            f"## Diff\n\n```diff\n{self.diff}\n```\n\n## Call-graph neighbourhood\n\n"
            + (
                truncate_to_tokens(nb, NEIGHBOURHOOD_MAX_TOKENS, deps.counter)
                or "(none)"
            )
        )
        self.context = deps.app_context.render() if deps.app_context else ""

    # --- LensRunner -------------------------------------------------------------

    def _cap(self, what: str) -> None:
        if self.max_cost_usd is None:
            return
        total = self.spent_before + self.budget.cost_usd
        if total >= self.max_cost_usd:
            raise StopSweep(
                f"cost cap ${self.max_cost_usd:.2f} reached (${total:.2f}) "
                f"before {what}"
            )

    def run(self, lens: str, app: str, commits: list[str]) -> list[LensFinding]:
        self._cap(f"lens {lens}")
        prompt = load_prompt(self.deps.config, f"lens_{lens}")
        system = prompt.render(
            context=self.context, app=app, neighbourhood=self.neighbourhood
        )
        started = time.monotonic()
        answer, raws, _secs = call_structured(
            self.deps.model("lens"),
            LensAnswer,
            [
                SystemMessage(content=system),
                HumanMessage(content="Report this lens's findings, or an empty list."),
            ],
        )
        self._charge(f"lens_{lens}", "lens", raws, time.monotonic() - started)
        return [
            LensFinding(
                lens=lens,
                title=i.title,
                category=i.category if i.category in CATEGORIES else "other",
                severity=i.severity,
                files=i.files,
                evidence=i.evidence,
                hypothesis=i.hypothesis,
                confidence=i.confidence,
                safety=i.safety,
            )
            for i in answer.findings[:3]
        ]

    # --- Falsifier --------------------------------------------------------------

    def check(self, app: str, finding: LensFinding) -> tuple[str, str, str]:
        self._cap(f"falsifying '{finding.title[:60]}'")
        deps = self.deps
        prompt = load_prompt(deps.config, "falsifier")
        rendered = (
            f"{finding.title}\nlens: {finding.lens} · category: {finding.category} · "
            f"severity: {finding.severity} · confidence: {finding.confidence}\n"
            f"files: {', '.join(finding.files)}\nevidence:\n- "
            + "\n- ".join(finding.evidence)
            + f"\nhypothesis: {finding.hypothesis}"
        )
        tools = [
            t
            for t in outline_first_read_tools(deps)
            if t.name in ("read_file", "grep", "glob", "list_dir")
        ]
        loop = ToolLoop(
            config=deps.config,
            node="falsifier",
            model=deps.model("falsifier"),
            spec=deps.config.model_for("falsifier"),
            tools=tools,
            finish_tools=[
                StructuredTool.from_function(
                    func=_noop,
                    name="submit_verdict",
                    description=SubmitVerdict.__doc__ or "",
                    args_schema=SubmitVerdict,
                )
            ],
            scratchpad=deps.scratchpad,
            counter=deps.counter,
            max_turns=FALSIFIER_MAX_TURNS,
        )
        initial: LoopState = {
            "messages": initial_messages(
                prompt.render(context=self.context, app=app, finding=rendered),
                "Try to prove the finding wrong with the code, then finish with "
                "submit_verdict.",
            ),
            "turns": 0,
            "result": None,
            "loop_stop": None,
            "budget_used": Budget(),
            "started_at": "",
            "app": app,
            "node": "falsifier",
        }
        out = run_loop(loop.build(), initial, None, None, max_turns=FALSIFIER_MAX_TURNS)
        used: Budget = out["budget_used"]
        self.budget = self.budget.model_copy(
            update={
                "input_tokens": self.budget.input_tokens + used.input_tokens,
                "cached_input_tokens": self.budget.cached_input_tokens
                + used.cached_input_tokens,
                "output_tokens": self.budget.output_tokens + used.output_tokens,
                "cost_usd": self.budget.cost_usd + used.cost_usd,
            }
        )
        result = out.get("result")
        if not result or result["tool"] != "submit_verdict":
            # no verdict: the finding is not trusted (it never becomes a run)
            return "refuted", "low", out.get("loop_stop") or "no verdict"
        a = result["args"]
        return a["verdict"], a["confidence"], a["reason"][:600]

    def _charge(self, node: str, role: str, raws, secs: float) -> None:
        spec = self.deps.config.model_for(role)
        for raw in raws:
            self.budget = charge(
                self.deps.config, self.budget, node, spec, raw, secs / max(1, len(raws))
            )
