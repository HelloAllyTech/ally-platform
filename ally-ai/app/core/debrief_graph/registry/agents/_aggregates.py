"""What the two aggregate agents share: one `query_aggregates` call (a fixed,
parameterised query over ally-be's redacted views, groups of five or more
learners only) turned into findings with no quotes and no numbers."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from langgraph.runtime import Runtime

from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.findings import agent_findings
from app.core.debrief_graph.registry.agents._common import code_record, tool


def session_skills(state: Dict[str, Any]) -> Dict[str, str]:
    """Skill (lower-cased) → this session's observation, where there was a chance."""
    out: Dict[str, str] = {}
    for b in (state.get("evidence") or {}).get("behaviours") or []:
        if isinstance(b, dict) and b.get("opportunity") is not False and b.get("skill"):
            out[str(b["skill"]).strip().lower()] = b.get("observation") or ""
    return out


async def run_aggregate(
    state: Dict[str, Any],
    runtime: Runtime[Ctx],
    *,
    agent: str,
    query: str,
    params: Dict[str, Any],
    why: str,
    to_findings: Callable[[List[Dict[str, Any]], Dict[str, str]], List[Dict[str, Any]]],
) -> Dict[str, Any]:
    ctx = runtime.context
    t0 = ctx.clock()
    skills = session_skills(state)
    answer = await tool(
        ctx, agent, "query_aggregates", {"query": query, "params": params}
    )
    rows: List[Dict[str, Any]] = answer.get("rows") or []
    found = to_findings(rows, skills)
    refused: Optional[str] = answer.get("refused")
    record = code_record(
        ctx,
        state,
        agent,
        t0,
        why=why,
        inputs=[f"the aggregate query {query} (groups of 5 or more learners)"],
        output=(
            f"refused: {refused}"
            if refused
            else f"{len(rows)} group(s) of 5 or more, {len(found)} finding(s)"
        ),
        note=query,
    )
    return {
        "steps": [record],
        # Aggregates never carry another learner's words.
        "findings": {agent: agent_findings(agent, found, ctx, no_quotes=True)},
        "agent_ok": {agent: not refused},
    }
