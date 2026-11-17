"""The `guidance_agent` node: agentic RAG between guidance_lookup and the
Writer (both graph paths). A thin node over the guidance toolbox
(guidance_toolbox.py): it runs only when the release sets
`guidanceAgentMaxCalls` > 0, its recipe lists the step, and
`guidanceTools[guidance_agent]` enables a tool. Never stops a debrief."""

from __future__ import annotations

from typing import Any, Dict

from langchain_core.runnables import RunnableConfig
from langgraph.runtime import Runtime

from app.core.debrief_graph import guidance_toolbox as toolbox
from app.core.debrief_graph.constants import Step
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.state import DebriefState as State

STEP = Step.GUIDANCE_AGENT


async def guidance_agent(
    state: State, runtime: Runtime[Ctx], config: RunnableConfig
) -> Dict[str, Any]:
    ctx = runtime.context
    # Gated by settings only (cap > 0 and a search/fetch tool for this step, in
    # run_phase); no recipe step or release agent entry is needed.
    step_cfg = ctx.step_of(state["recipe_key"], STEP) or {}
    if state.get("guidance_agent_ran") or not toolbox.phase_wanted(ctx, STEP):
        return {}
    if (
        state.get("orchestrated")
        and STEP in (state.get("offered") or [])
        and not state.get("guidance_agent_selected")
    ):
        # The release lists it and the planner was offered it: it runs only if
        # the planner selected it (the registry agent's marker); a skip is
        # honoured. Not listed by the release: it runs, as on the fixed path.
        return {}
    res = await toolbox.run_phase(
        state, ctx, config, STEP, toolbox.agent_model(ctx, state)
    )  # no model in the release: a skipped record, never a default
    if res is None:
        return {}
    return {
        **toolbox.phase_update(
            state, ctx, res, step_cfg.get("label") or "Choosing guidance"
        ),
        "guidance_agent_ran": True,
    }
