"""One PM agent run (thread id = ally-be's agent run id).

A thread that stopped part-way (the process died) continues from its last
checkpoint when ally-be calls again with the same id; a finished one answers its
stored result. Never traced to LangSmith (spec D6): the trace is our own step
records, returned for ally-be to store.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from deepagents.backends.utils import create_file_data
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.store.base import BaseStore
from langsmith.run_helpers import tracing_context

from app.core.debrief_graph.gateway import Gateway, HttpGateway
from app.core.pm_agent.agent import build_pm_agent
from app.core.pm_agent.ledger import RunLedger
from app.core.pm_agent.middleware import _text
from app.core.pm_agent.models import build_models
from app.core.pm_agent.prompt import DEFAULT_SYSTEM_PROMPT, render_inputs
from app.core.pm_agent.schemas import PmAgentRunRequest
from app.core.pm_agent.store import MEMORY_NAMESPACE
from app.core.pm_agent.tools import ALL_TOOLS, make_tools
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: Model passes and tool calls, main agent and subagents together, before the
#: loop is cut (each pass is two or three supersteps).
RECURSION_LIMIT = 300
#: Each gateway tool must answer within this; the quick test only starts there.
TOOL_TIMEOUT_S = 60.0


MEMORY_SEED = """\
# PM agent memory

Nothing recorded yet. Keep here: what you tried and why, what happened to it, open
hypotheses. Rewrite rather than append forever.
"""


async def _seed_memory(store: BaseStore) -> None:
    """The memory file exists from the first run, so reading it never fails."""
    if await store.aget(MEMORY_NAMESPACE, "/AGENTS.md") is None:
        await store.aput(MEMORY_NAMESPACE, "/AGENTS.md", create_file_data(MEMORY_SEED))


async def run_pm_agent(
    req: PmAgentRunRequest,
    *,
    store: BaseStore,
    checkpointer: Optional[BaseCheckpointSaver],
    default_model: str,
    models_factory: Callable[..., Dict[str, Any]] = build_models,
    gateway: Optional[Gateway] = None,
) -> Dict[str, Any]:
    primary = req.model or default_model
    ledger = RunLedger(
        run_id=req.agent_run_id, budget_usd=req.budget_usd, prices=req.prices
    )
    gw = gateway or HttpGateway(req.gateway_url, req.agent_token, TOOL_TIMEOUT_S)

    def result(status: str, report: Optional[str], todos=None, error=None):
        return {
            "status": status,
            "report": report,
            "idea_ids": ledger.idea_ids,
            "steps": ledger.steps,
            "todos": todos or [],
            "estimated_cost_usd": round(ledger.spent_usd, 4),
            "model": ledger.models_used[0] if ledger.models_used else None,
            "refusals": ledger.refusals,
            "error": error,
        }

    try:
        models = models_factory(primary, req.backup_model, req.prices)
        if not models:
            return result(
                "failed", None, error="no priced model this environment can run"
            )
        if ledger.exhausted:
            return result("budget_spent", None)
        allowed = (
            [t for t in req.tools if t in ALL_TOOLS] if req.tools else list(ALL_TOOLS)
        )
        agent = build_pm_agent(
            ledger=ledger,
            tools=make_tools(gw, ledger, allowed),
            models=models,
            primary=primary,
            backup=req.backup_model,
            system_prompt=req.system_prompt or DEFAULT_SYSTEM_PROMPT,
            store=store,
            checkpointer=checkpointer,
        )
        config = {
            "configurable": {"thread_id": f"pm-agent:{req.agent_run_id}"},
            "recursion_limit": RECURSION_LIMIT,
            "run_name": "debrief_pm_agent",
        }
        await _seed_memory(store)
        snapshot = await agent.aget_state(config) if checkpointer else None
        started = bool(snapshot and snapshot.values)
        graph_input = (
            None
            if started
            else {
                "messages": [
                    HumanMessage(content=render_inputs(req.review, req.inputs))
                ]
            }
        )
        with tracing_context(enabled=False):
            state = await agent.ainvoke(graph_input, config)
        last = next(
            (
                m
                for m in reversed(state.get("messages", []))
                if isinstance(m, AIMessage)
            ),
            None,
        )
        return result(
            "budget_spent" if ledger.stopped_for_budget else "finished",
            _text(last).strip() or None,
            todos=state.get("todos"),
        )
    except Exception as e:  # noqa: BLE001 - reported to ally-be as a failed run
        logger.error("PM agent run %s failed: %s", req.agent_run_id, type(e).__name__)
        return result("failed", None, error=f"{type(e).__name__}: {e}"[:300])
    finally:
        if gateway is None:
            try:
                await gw.aclose()
            except Exception:  # noqa: BLE001
                pass
