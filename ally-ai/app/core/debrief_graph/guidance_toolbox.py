"""The guidance toolbox: real LangChain tools over ally-be's guidance gateway
tools, and a reusable LangGraph tool-loop subgraph around them.

Any Debrief model step may be given the toolbox (``guidanceTools`` setting:
step name -> enabled gateway tool names). Today the ``guidance_agent`` node
uses it, and the Writer and Reviser can, behind their own entries.

- Tools (``StructuredTool`` with typed ``args_schema``): ``search_guidance``
  -> gateway ``guidance_search`` ``{topics:[{situation}], per_moment:2, step}``;
  ``get_guidance`` -> gateway ``guidance_fetch`` ``{codes:[<=5], step}``. The
  index (gateway ``guidance_index`` ``{step}``) is read once, before the loop,
  and shown to the model in its prompt.
- The loop (``build_tool_loop``): a ``StateGraph`` with ``add_messages``
  messages state and a call counter. ``model`` node (``bind_tools``,
  ``RetryPolicy``) -> conditional edge -> prebuilt ``ToolNode``
  (``handle_tool_errors=True``) -> ``tally`` -> back to ``model``. The cap, the
  deadline and the spend limit are enforced in the routing; ``recursion_limit``
  is only a backstop. It is compiled with the default checkpointer argument, so
  it inherits the parent graph's when invoked inside a parent node with the
  parent's config.

Guidance never stops a debrief: every failure is recorded and returns what was
found so far. LangChain's chat model is used (not ``generate_structured``)
because the structured-output helper cannot return tool calls; the model is the
one the step names, with no substitute.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Annotated, Any, Callable, Dict, List, Optional, Sequence

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import RetryPolicy
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from app.core.debrief.render import NONE, render
from app.core.debrief.steps import DEFAULT_GUIDANCE_AGENT_SYSTEM, GUIDANCE_AGENT_CODE
from app.core.debrief_graph.budget import cost_usd, estimate_step_cost_usd
from app.core.debrief_graph.constants import STEP_TIMEOUT_S, Step
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: The gateway tools a step may be given (the `guidanceTools` setting).
ALL_TOOLS = ("guidance_index", "guidance_search", "guidance_fetch")
#: The steps that may have tools (ally-be validates the same list).
TOOL_STEPS = (Step.GUIDANCE_AGENT, "writer", "reviser")
MAX_CODES_PER_FETCH = 5
MAX_PASSAGES_ADDED = 6
PER_MOMENT = 2
MAX_MOMENTS = 5
INDEX_LINES = 200
NO_MODEL = "no model set in this release"
LIMIT_TEXT = "Call limit reached; do not call tools again."


# --- the tools --------------------------------------------------------------------


class SearchGuidanceArgs(BaseModel):
    situation: str = Field(
        description=(
            "The situation in your own words: what was going on and the skill "
            "involved. Never quote anyone."
        )
    )


class GetGuidanceArgs(BaseModel):
    codes: List[str] = Field(
        description=f"Codes from the guidance index (at most {MAX_CODES_PER_FETCH})."
    )


def passage_of(p: Dict[str, Any]) -> Dict[str, str]:
    """A gateway passage in the shape the Writer reads: {title, text}."""
    citation = p.get("citation")
    title = p.get("title") or (
        citation.get("title") if isinstance(citation, dict) else citation
    )
    return {"title": str(title or p.get("code") or ""), "text": p.get("text") or ""}


@dataclass
class GuidanceCalls:
    """What one tool-using step has done: the calls, the passages it merged,
    and the limits. The tools write here; the loop reads `used`."""

    step: str
    gateway: Any
    enabled: Sequence[str]
    max_calls: int
    clock: Callable[[], float]
    seen_ids: List[str] = field(default_factory=list)
    known_titles: set = field(default_factory=set)
    calls: List[Dict[str, Any]] = field(default_factory=list)
    added: List[Dict[str, str]] = field(default_factory=list)
    citations: List[Dict[str, str]] = field(default_factory=list)
    added_ids: List[str] = field(default_factory=list)
    used: int = 0  # tool calls the model made (the index read is not one)

    async def gateway_call(self, tool: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return await self.gateway.call(tool, {**body, "step": self.step})

    def record(self, **fields: Any) -> Dict[str, Any]:
        rec = {"step": self.step, **fields, "order": len(self.calls) + 1}
        self.calls.append(rec)
        return rec

    def via(self, tool: str) -> str:
        """How a passage reached the Writer (workspace.guidanceGiven)."""
        if self.step in ("writer", "reviser"):
            return self.step
        return "agent_fetch" if tool == "guidance_fetch" else "agent_search"

    def merge(self, rows: List[Dict[str, Any]], tool: str = "guidance_search") -> int:
        new = 0
        for p in rows:
            pid = str(p.get("id") or p.get("code"))
            passage = {
                **passage_of(p),
                "code": str(p.get("code") or ""),
                "via": self.via(tool),
            }
            if (
                pid in self.seen_ids
                or pid in self.added_ids
                or passage["title"] in self.known_titles
                or len(self.added) >= MAX_PASSAGES_ADDED
            ):
                continue
            self.added_ids.append(pid)
            self.added.append(passage)
            self.citations.append(
                {"code": str(p.get("code") or ""), "title": passage["title"]}
            )
            new += 1
        return new

    async def run(self, tool: str, body: Dict[str, Any], args: Any) -> str:
        """One gateway call: counted, timed, recorded, merged, never raising."""
        if self.used >= self.max_calls:
            return LIMIT_TEXT
        self.used += 1
        t0 = self.clock()
        found: Dict[str, Any] = {}
        try:
            found = await self.gateway_call(tool, body)
        except Exception as e:  # noqa: BLE001 - a 403/5xx is a tool error
            logger.warning("[debrief-guidance] %s failed: %s", tool, e)
            found = {"unavailable": True, "passages": []}
        rows = _rows(found)
        new = self.merge(rows, tool)
        self.record(
            tool=tool,
            args=args,
            codes_returned=[str(p.get("code") or p.get("id")) for p in rows],
            ms=round(self.clock() - t0),
            ok=not (found.get("unavailable") or found.get("disabled")),
        )
        text = _tool_text(found, rows)
        if rows and not new:
            text += "\n(Already with the writer, or the limit was reached.)"
        return text


def for_writer(passages: Any) -> List[Dict[str, Any]]:
    """What the model reads of a passage: title and text only (the code and
    `via` stay in state for the run record)."""
    return [
        {"title": p.get("title"), "text": p.get("text")}
        for p in passages or []
        if isinstance(p, dict)
    ]


def guidance_record(
    passages: Sequence[Dict[str, Any]], timings: Dict[str, Any]
) -> Dict[str, Any]:
    """`workspace.guidanceMode`, `guidanceGiven` and `guidanceTimings` from the
    passages handed to the Writer so far (deduped by code, first via kept)."""
    vias = [p.get("via") for p in passages if isinstance(p, dict)]
    from_lookup = "lookup" in vias
    from_agent = any(v and v != "lookup" for v in vias)
    mode = (
        "both"
        if from_lookup and from_agent
        else "lookup" if from_lookup else "agent" if from_agent else "none"
    )
    given: List[Dict[str, Any]] = []
    for p in passages:
        code = (p or {}).get("code")
        if code and all(g["code"] != code for g in given):
            given.append({"code": code, "via": p.get("via")})
    return {
        "guidanceMode": mode,
        "guidanceGiven": given,
        "guidanceTimings": {
            "lookupMs": timings.get("lookupMs"),
            "agentMs": timings.get("agentMs"),
        },
    }


def _rows(found: Dict[str, Any]) -> List[Dict[str, Any]]:
    if found.get("no_confident_match") or found.get("disabled"):
        return []
    rows = found.get("passages")
    if rows is None:
        rows = found.get("entries")
    return [p for p in rows or [] if isinstance(p, dict)]


def _tool_text(found: Dict[str, Any], rows: List[Dict[str, Any]]) -> str:
    if found.get("disabled"):
        return "This tool is disabled; do not call it again."
    if found.get("unavailable"):
        return "Guidance could not be reached."
    if not rows:
        return "No matching guidance."
    return "\n".join(
        f"{p.get('code') or p.get('id')} | {passage_of(p)['title']} | "
        f"{passage_of(p)['text'][:300]}"
        for p in rows
    )


def make_tools(box: GuidanceCalls) -> List[StructuredTool]:
    """The LangChain tools this step may call (its enabled ones)."""

    async def search_guidance(situation: str) -> str:
        query = str(situation or "").strip()[:500]
        return await box.run(
            "guidance_search",
            {"topics": [{"situation": query}], "per_moment": PER_MOMENT},
            query,
        )

    async def get_guidance(codes: List[str]) -> str:
        wanted = list(dict.fromkeys(str(c) for c in codes or []))[
            :MAX_CODES_PER_FETCH
        ]
        return await box.run("guidance_fetch", {"codes": wanted}, wanted)

    tools: List[StructuredTool] = []
    if "guidance_search" in box.enabled:
        tools.append(
            StructuredTool.from_function(
                coroutine=search_guidance,
                name="search_guidance",
                description=(
                    "Find guidance entries for a situation, described in your own "
                    "words. Use when the index has nothing that fits."
                ),
                args_schema=SearchGuidanceArgs,
            )
        )
    if "guidance_fetch" in box.enabled:
        tools.append(
            StructuredTool.from_function(
                coroutine=get_guidance,
                name="get_guidance",
                description=(
                    f"Fetch guidance entries by code from the index (at most "
                    f"{MAX_CODES_PER_FETCH} codes)."
                ),
                args_schema=GetGuidanceArgs,
            )
        )
    return tools


# --- the reusable tool loop -----------------------------------------------------------


class LoopState(TypedDict):
    messages: Annotated[List[AnyMessage], add_messages]
    calls: int
    spent: float


def build_tool_loop(
    *,
    model: BaseChatModel,
    tools: List[StructuredTool],
    max_calls: int,
    calls_used: Callable[[], int],
    keep_going: Callable[[float], bool],
    price: Callable[[Dict[str, Any]], float],
) -> CompiledStateGraph:
    """The tool-loop subgraph. `keep_going(spent)` is the deadline and spend
    check; `calls_used()` is how many tool calls have run (the tools count
    them); `price(usage_metadata)` is a pass's cost in USD."""
    bound = model.bind_tools(tools)

    async def call_model(state: LoopState) -> Dict[str, Any]:
        ai = await bound.ainvoke(state["messages"])
        usage = getattr(ai, "usage_metadata", None) or {}
        return {"messages": [ai], "spent": state.get("spent", 0.0) + price(usage)}

    def tally(state: LoopState) -> Dict[str, Any]:
        return {"calls": calls_used()}

    def open_(state: LoopState) -> bool:
        return state.get("calls", 0) < max_calls and keep_going(state.get("spent", 0.0))

    def after_model(state: LoopState) -> str:
        last = state["messages"][-1]
        wants = bool(getattr(last, "tool_calls", None))
        return "tools" if wants and open_(state) else END

    def after_tally(state: LoopState) -> str:
        return "model" if open_(state) else END

    g = StateGraph(LoopState)
    g.add_node(
        "model",
        call_model,
        retry_policy=RetryPolicy(max_attempts=2, initial_interval=0.0, jitter=False),
    )
    g.add_node("tools", ToolNode(tools, handle_tool_errors=True))
    g.add_node("tally", tally)
    g.add_edge(START, "model")
    g.add_conditional_edges("model", after_model, ["tools", END])
    g.add_edge("tools", "tally")
    g.add_conditional_edges("tally", after_tally, ["model", END])
    # No checkpointer argument: inherits the parent's when used as a subgraph.
    return g.compile()


def build_chat_model(model: str) -> BaseChatModel:
    """The chat model a step names, as a LangChain model (tests replace this)."""
    from app.core.config import settings
    from app.core.llm.dispatch import (
        PROVIDER_ANTHROPIC,
        PROVIDER_OPENAI,
        infer_provider_from_model,
        is_gemini_3_or_later,
    )

    provider = infer_provider_from_model(model)
    if provider == PROVIDER_OPENAI:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=model, api_key=settings.OPENAI.API_KEY)
    if provider == PROVIDER_ANTHROPIC:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=model, api_key=settings.ANTHROPIC.API_KEY, max_tokens=1024
        )
    from langchain_google_genai import ChatGoogleGenerativeAI

    kwargs: Dict[str, Any] = {}
    if not is_gemini_3_or_later(model):
        kwargs["thinking_budget"] = 0
    return ChatGoogleGenerativeAI(
        model=model, google_api_key=settings.GEMINI.API_KEY, **kwargs
    )


# --- settings and inputs -----------------------------------------------------------


def enabled_tools(ctx: Ctx, step: str) -> List[str]:
    """The gateway tools `guidanceTools[step]` enables. Absent setting = the
    `guidance_agent` has all three, other steps none."""
    cfg = ctx.setting("guidanceTools")
    if not isinstance(cfg, dict):
        return list(ALL_TOOLS) if step == Step.GUIDANCE_AGENT else []
    raw = cfg.get(step)
    return [t for t in ALL_TOOLS if t in (raw if isinstance(raw, list) else [])]


def agent_model(ctx: Ctx, state: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """The guidance agent's model, from the release only: the bundle's
    `models.guidanceAgent`, else the recipe step named `guidance_agent`, else
    the orchestrator's agents entry; None when the release names none (never a
    hardcoded default: the org's provider allowlist is applied to release
    models). With no state, any recipe's step counts."""
    models = ctx.bundle.get("models")
    named = models.get("guidanceAgent") if isinstance(models, dict) else None
    if isinstance(named, dict):
        named = named.get("model")
    if named:
        return str(named)
    recipes = (
        [ctx.recipe(state["recipe_key"])]
        if state
        else list((ctx.bundle.get("recipes") or {}).values())
    )
    recipe: Dict[str, Any] = {}
    for r in recipes:
        step_ = next(
            (s for s in r.get("steps") or [] if s.get("step") == Step.GUIDANCE_AGENT),
            None,
        )
        if step_ and step_.get("model"):
            recipe = step_
            break
    entry = next(
        (
            e
            for e in (ctx.bundle.get("orchestrator") or {}).get("agents") or []
            if isinstance(e, dict) and e.get("id") == Step.GUIDANCE_AGENT
        ),
        {},
    )
    found = recipe.get("model") or entry.get("model")
    return str(found) if found else None


def phase_wanted(ctx: Ctx, step: str) -> bool:
    """A cap above 0 and at least one search or fetch tool for this step."""
    return int(ctx.setting("guidanceAgentMaxCalls", 0) or 0) > 0 and any(
        t in ("guidance_search", "guidance_fetch") for t in enabled_tools(ctx, step)
    )


def render_index(index: Dict[str, Any]) -> str:
    entries = [e for e in index.get("entries") or [] if isinstance(e, dict)]
    if not entries:
        return NONE
    lines = []
    for e in entries[:INDEX_LINES]:
        level = e.get("level")
        levels = "/".join(level) if isinstance(level, list) and level else "all"
        lines.append(
            f"{e.get('code')} | {e.get('kind')} | {levels} | {e.get('title')}"
            + (f" - {e.get('hint')}" if e.get("hint") else "")
        )
    return "\n".join(lines)


def moments_of(evidence: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        m
        for m in (evidence.get("pivotal_moments") or [])[:MAX_MOMENTS]
        if isinstance(m, dict) and m.get("summary")
    ]


def render_moments(moments: List[Dict[str, Any]]) -> str:
    return (
        "\n".join(f"- turn {m.get('turn_index')}: {m['summary']}" for m in moments)
        or NONE
    )


def render_skills(evidence: Dict[str, Any]) -> str:
    skills: List[str] = []
    for b in evidence.get("behaviours") or []:
        s = (b or {}).get("skill")
        if (
            isinstance(s, str)
            and s.strip()
            and (b or {}).get("opportunity") is not False
            and s.strip() not in skills
        ):
            skills.append(s.strip())
    return "\n".join(f"- {s}" for s in skills[:8]) or NONE


def render_baseline(passages: List[Dict[str, Any]]) -> str:
    return "\n".join(f"- {p.get('title')}" for p in passages) or NONE


def last_text(messages: List[Any]) -> Optional[str]:
    for m in reversed(messages):
        if isinstance(m, AIMessage) and not m.tool_calls:
            content = m.content
            text = (
                content
                if isinstance(content, str)
                else " ".join(
                    str(c.get("text") if isinstance(c, dict) else c)
                    for c in content or []
                    if not isinstance(c, dict) or c.get("type", "text") == "text"
                )
            )
            return text.strip()[:2000] or None
    return None


# --- one tool-using phase ------------------------------------------------------------


@dataclass
class PhaseResult:
    """What a tool-using step did; the caller turns it into state and records."""

    step: str
    status: str  # done | failed | skipped
    note: str
    model: Optional[str]
    est: float
    moments: int
    tools: List[str]
    system: str
    calls: List[Dict[str, Any]]
    added: List[Dict[str, str]]
    citations: List[Dict[str, str]]
    added_ids: List[str]
    index_version: Any
    reasoning: Optional[str]
    error: Optional[str]
    ms: int
    t0: float
    max_calls: int

    @property
    def tool_calls(self) -> List[Dict[str, Any]]:
        return [c for c in self.calls if c["tool"] != "guidance_index"]


async def run_phase(
    state: Dict[str, Any],
    ctx: Ctx,
    config: Optional[RunnableConfig],
    step: str,
    model_name: Optional[str] = None,
) -> Optional[PhaseResult]:
    """The tool phase for `step`: None when it is off (no cap, no enabled
    tool) or nothing to look at; otherwise a PhaseResult (status `skipped`
    with a note when time or budget does not allow it)."""
    max_calls = int(ctx.setting("guidanceAgentMaxCalls", 0) or 0)
    tools_on = enabled_tools(ctx, step)
    can_call = [t for t in tools_on if t in ("guidance_search", "guidance_fetch")]
    if max_calls <= 0 or not can_call:
        return None
    evidence = state.get("evidence") or {}
    moments = moments_of(evidence)
    if not moments:
        return None
    estimated = state.get("estimated", 0.0)
    t0 = ctx.clock()

    def result(status: str, note: str, **kw: Any) -> PhaseResult:
        base: Dict[str, Any] = dict(
            step=step,
            status=status,
            note=note,
            model=model_name,
            est=0.0,
            moments=len(moments),
            tools=tools_on,
            system="",
            calls=[],
            added=[],
            citations=[],
            added_ids=[],
            index_version=None,
            reasoning=None,
            error=None,
            ms=round(ctx.clock() - t0),
            t0=t0,
            max_calls=max_calls,
        )
        base.update(kw)
        return PhaseResult(**base)

    if not model_name:
        return result("skipped", NO_MODEL)
    if ctx.time_left_ms(state.get("has_risk_cue", False)) < (
        ctx.setting("deadlineMs", 150_000) / 2
    ):
        return result("skipped", "deadline")

    baseline: List[Dict[str, str]] = list(state.get("passages") or [])
    box = GuidanceCalls(
        step=step,
        gateway=ctx.gateway,
        enabled=can_call,
        max_calls=max_calls,
        clock=ctx.clock,
        seen_ids=list(((state.get("workspace") or {}).get("passages")) or []),
        known_titles={p.get("title") for p in baseline},
    )
    index: Dict[str, Any] = {}
    if "guidance_index" in tools_on:
        t_idx = ctx.clock()
        try:
            index = await box.gateway_call("guidance_index", {})
        except Exception:  # noqa: BLE001 - guidance never stops a debrief
            index = {"unavailable": True, "entries": []}
        box.record(
            tool="guidance_index",
            args=None,
            codes_returned=[
                str(e.get("code")) for e in index.get("entries") or [] if e
            ],
            ms=round(ctx.clock() - t_idx),
            ok=not (index.get("unavailable") or index.get("disabled")),
        )
    values = {
        "guidance_index": render_index(index),
        "moments": render_moments(moments),
        "skills": render_skills(evidence),
        "baseline_passages": render_baseline(baseline),
        "learner_level": ctx.sess("learner_level") or "unknown",
        "max_calls": max_calls,
    }
    try:
        system = render(
            GUIDANCE_AGENT_CODE,
            ctx.prompt(GUIDANCE_AGENT_CODE) or DEFAULT_GUIDANCE_AGENT_SYSTEM,
            values,
            required=("guidance_index", "moments"),
        )
    except Exception as e:  # noqa: BLE001 - a bad live text skips the phase
        logger.error("[debrief-guidance] %s", e)
        return result(
            "failed", str(e)[:300], calls=box.calls, index_version=index.get("version")
        )
    one_pass = estimate_step_cost_usd(
        Step.GUIDANCE_AGENT, model_name, len(system) + 400, ctx.prices
    )
    est = one_pass * (max_calls + 1)
    if estimated + est > ctx.ceiling_usd:
        return result("skipped", "budget", calls=box.calls, system=system)

    def keep_going(spent: float) -> bool:
        return (
            ctx.time_left_ms(state.get("has_risk_cue", False))
            >= ctx.setting("deadlineMs", 150_000) / 4
            and spent <= est
        )

    def price(usage: Dict[str, Any]) -> float:
        c = cost_usd(
            model_name,
            int(usage.get("input_tokens") or 0),
            int(usage.get("output_tokens") or 0),
            ctx.prices,
        )
        return c if c != float("inf") else 0.0

    reasoning: Optional[str] = None
    error: Optional[str] = None
    try:
        loop = build_tool_loop(
            model=build_chat_model(model_name),
            tools=make_tools(box),
            max_calls=max_calls,
            calls_used=lambda: box.used,
            keep_going=keep_going,
            price=price,
        )
        run_config: Dict[str, Any] = {
            **(config or {}),
            # Only a backstop: the routing enforces the cap.
            "recursion_limit": 2 * max_calls + 8,
        }
        final = await asyncio.wait_for(
            loop.ainvoke(
                {
                    "messages": [
                        SystemMessage(content=system),
                        HumanMessage(
                            content=(
                                "Find the guidance the writer should read for "
                                "these moments, or answer without a tool call if "
                                "none would change the coaching."
                            )
                        ),
                    ],
                    "calls": 0,
                    "spent": 0.0,
                },
                run_config,
            ),
            timeout=STEP_TIMEOUT_S["guidance-agent"],
        )
        reasoning = last_text(final["messages"])
    except asyncio.TimeoutError:
        error = "timed out"
    except Exception as e:  # noqa: BLE001 - guidance never stops a debrief
        logger.warning("[debrief-guidance] %s failed: %s", step, e)
        error = f"{type(e).__name__}: {e}"[:300]

    n_calls = len([c for c in box.calls if c["tool"] != "guidance_index"])
    note = f"{n_calls} call(s), {len(box.added)} passage(s) added"
    return result(
        "failed" if error and not n_calls else "done",
        f"{note} ({error})" if error else note,
        est=est,
        system=system,
        calls=box.calls,
        added=box.added,
        citations=box.citations,
        added_ids=box.added_ids,
        index_version=index.get("version"),
        reasoning=reasoning,
        error=error,
    )


def phase_update(
    state: Dict[str, Any], ctx: Ctx, res: PhaseResult, label: str = ""
) -> Dict[str, Any]:
    """The state update for a phase: step record, log, merged passages, the
    reservation and `workspace.guidanceCalls` (appended across steps)."""
    from app.core.debrief_graph.agent_logs import code_log
    from app.core.debrief_graph.budget import budget_left
    from app.core.debrief_graph.records import iso, skipped

    estimated = state.get("estimated", 0.0)
    if res.status == "skipped":
        rec = skipped(
            ctx, estimated, {"step": Step.GUIDANCE_AGENT, "label": label}, res.note
        )
        rec["calledBy"] = res.step
        return {"steps": [rec]}
    kept = ": " + "; ".join(p["title"] for p in res.added[:3]) if res.added else ""
    record = {
        "step": Step.GUIDANCE_AGENT,
        "calledBy": res.step,
        "label": label,
        "status": res.status,
        "startedAt": iso(res.t0),
        "ms": res.ms,
        "model": res.model,
        "estimatedUsd": round(res.est, 4),
        "note": res.note,
        "why": (
            "Decides which practice guidance to read for the "
            f"{res.moments} pivotal moment(s), from the guidance index."
            + (
                ""
                if res.step == Step.GUIDANCE_AGENT
                else f" Called by the {res.step}."
            )
        ),
        "inputs": [
            "the guidance index",
            "each moment’s summary in the Analyst’s words (never the learner’s)",
            "the skills they concern and the learner’s level",
            "the passages already found",
        ],
        "reasoning": res.reasoning,
        "output": f"{res.note}{kept}",
        "citations": res.citations,
        "budgetLeftUsd": budget_left(ctx.ceiling_usd, estimated + res.est),
    }
    prior = list(((state.get("workspace") or {}).get("guidanceCalls")) or [])
    offset = len(prior)
    calls = [{**c, "order": offset + c["order"]} for c in res.calls]
    workspace: Dict[str, Any] = {
        "guidanceCalls": prior + calls,
        "guidanceIndexVersion": res.index_version
        or (state.get("workspace") or {}).get("guidanceIndexVersion"),
    }
    timings = dict(((state.get("workspace") or {}).get("guidanceTimings")) or {})
    if res.step == Step.GUIDANCE_AGENT:
        timings["agentMs"] = res.ms
    workspace.update(
        guidance_record(list(state.get("passages") or []) + res.added, timings)
    )
    update: Dict[str, Any] = {
        "steps": [record],
        "estimated": estimated + res.est,
        "workspace": workspace,
        "logs": [
            code_log(
                ctx,
                Step.GUIDANCE_AGENT,
                res.t0,
                input={
                    "calledBy": res.step,
                    "system": res.system,
                    "maxCalls": res.max_calls,
                    "tools": res.tools,
                    "model": res.model,
                },
                output={
                    "calls": calls,
                    "passages": [
                        {**p, **c} for p, c in zip(res.added, res.citations)
                    ],
                    "reasoning": res.reasoning,
                },
                error=res.error,
            )
        ],
    }
    if res.added:
        update["passages"] = list(state.get("passages") or []) + res.added
        seen = list(((state.get("workspace") or {}).get("passages")) or [])
        workspace["passages"] = seen + res.added_ids
    return update


__all__ = [
    "ALL_TOOLS",
    "TOOL_STEPS",
    "GuidanceCalls",
    "for_writer",
    "guidance_record",
    "PhaseResult",
    "build_chat_model",
    "build_tool_loop",
    "enabled_tools",
    "make_tools",
    "phase_update",
    "run_phase",
]
