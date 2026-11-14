"""What the agent modules share: the planner's reason as the step's why, the
scope guard on what an agent is sent, the tool guard on what it may call, and
the step record a code agent writes."""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.core.debrief_graph.budget import budget_left
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.model_step import ModelStep
from app.core.debrief_graph.records import iso
from app.core.debrief_graph.registry.manifest import REGISTRY, agent_config

State = Dict[str, Any]


class ToolRefused(Exception):
    """An agent asked for a tool its manifest does not list."""


def planned_why(state: State, agent: str) -> Optional[str]:
    action = (state.get("actions") or {}).get(agent) or {}
    why = action.get("why")
    return why.strip()[:300] if isinstance(why, str) and why.strip() else None


def focus_turns(state: State, agent: str) -> List[int]:
    action = (state.get("actions") or {}).get(agent) or {}
    turns = (action.get("inputs") or {}).get("focus_turns") or []
    return [t for t in turns if isinstance(t, int)][:10]


def scoped(agent: str, blocks: Dict[str, Tuple[str, Any]]) -> Dict[str, Any]:
    """Only the blocks whose scope the manifest's `scopes.reads` lists: code
    passes an agent nothing outside it (spec A2)."""
    reads = set(REGISTRY[agent].reads)
    return {tag: value for tag, (scope, value) in blocks.items() if scope in reads}


async def tool(ctx: Ctx, agent: str, name: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """A gateway tool call on an agent's behalf, refused unless its manifest
    lists the tool (the run token is ally-be's own check of the same list)."""
    if name not in REGISTRY[agent].tools:
        raise ToolRefused(f"{agent} may not call {name}")
    return await ctx.gateway.call(name, body)


def ok(agent: str, answered: bool) -> Tuple[Dict[str, Any], None]:
    return {"agent_ok": {agent: answered}}, None


def registry_step(
    agent: str,
    base: ModelStep,
    recipe_step: Optional[str] = None,
    on_success: Optional[Callable] = None,
    **changes: Any,
) -> ModelStep:
    """A model step as a registry agent: its config from the release, the
    planner's reason as its why, and whether it answered for the dispatcher."""
    original_why = base.why
    done = on_success or base.on_success

    def succeeded(state, ctx, res):
        extra, goto = done(state, ctx, res)
        return {**extra, "agent_ok": {agent: True}}, goto

    def failed(state, ctx):
        # Keep what today's step records on failure (its fallback rung), but
        # always come back to the dispatcher.
        extra, _ = base.on_failure(state, ctx)
        # An error handler's update follows no static edge: route explicitly.
        return {**extra, "agent_ok": {agent: False}}, "dispatch"

    return replace(
        base,
        config=lambda s, c: agent_config(s, c, agent, recipe_step),
        why=lambda s, c: planned_why(s, agent) or original_why(s, c),
        on_success=succeeded,
        on_failure=failed,
        destinations=("dispatch",),
        **changes,
    )


def _stay(*_: Any):
    return {}, None


def findings_summary(res: Dict[str, Any]) -> str:
    found = res.get("findings") or []
    if not found:
        return "nothing worth the debrief"
    kinds: Dict[str, int] = {}
    for f in found:
        kinds[f.get("kind")] = kinds.get(f.get("kind"), 0) + 1
    return f"{len(found)} finding(s): " + ", ".join(
        f"{v} {str(k).replace('_', ' ')}" for k, v in kinds.items()
    )


def prompt_agent(
    agent: str,
    *,
    task: str,
    default_system: str,
    prompt_code: str,
    why: str,
    inputs: Callable[[State, Ctx], List[str]],
    blocks: Callable[[State, Ctx], Dict[str, Tuple[str, Any]]],
    send_transcript: bool = True,
    fetch: Optional[Callable] = None,
) -> ModelStep:
    """A prompt-only agent (spec A2 "configuration-only"): its live prompt, an
    approved model, the blocks its scopes allow, the findings contract."""

    def body(state: State, ctx: Ctx) -> Dict[str, Any]:
        reads = REGISTRY[agent].reads
        return {
            "task": task,
            "default_system": default_system,
            "system_prompt": ctx.prompt(prompt_code),
            "language": ctx.language,
            "transcript": (
                ctx.transcript if send_transcript and "session" in reads else None
            ),
            "blocks": scoped(agent, blocks(state, ctx)),
            "focus_turns": focus_turns(state, agent),
        }

    base = ModelStep(
        step=agent,
        path="agent-" + agent.replace("_", "-"),
        body=body,
        why=lambda s, c: why,
        inputs=inputs,
        on_success=_stay,
        on_failure=_stay,
        summarise=findings_summary,
        fetch=fetch,
        findings=lambda s, c, r: r.get("findings") or [],
        prompt_code=prompt_code,
    )
    return registry_step(agent, base)


def code_record(
    ctx: Ctx,
    state: State,
    agent: str,
    t0: float,
    *,
    why: str,
    inputs: List[str],
    output: str,
    note: Optional[str] = None,
    reasoning: Optional[str] = None,
    status: str = "done",
) -> Dict[str, Any]:
    """A code agent's step record, in the same shape as a model step's."""
    return {
        "step": agent,
        "label": REGISTRY[agent].progress_label,
        "status": status,
        "startedAt": iso(t0),
        "ms": round(ctx.clock() - t0),
        "estimatedUsd": 0.0,
        "note": note,
        "why": planned_why(state, agent) or why,
        "inputs": inputs,
        "reasoning": reasoning,
        "output": output[:300],
        "budgetLeftUsd": budget_left(ctx.ceiling_usd, state.get("estimated", 0.0)),
    }
