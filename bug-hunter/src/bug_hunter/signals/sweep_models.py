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
from bug_hunter.signals.commit_sweep import LensFinding

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


class ModelSweep:
    """Lens runner and falsifier for one app batch (implements both interfaces)."""

    def __init__(self, deps: GraphDeps, diff: str):
        self.deps = deps
        self.budget = Budget()
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

    def run(self, lens: str, app: str, commits: list[str]) -> list[LensFinding]:
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
