"""The PM agent in the Debrief console's conversation (V2_AUTONOMY C1-C3).

One person's message, answered: a LangChain `create_agent` loop over the PM agent's
gateway tools (read, propose, and the conversation's own change actions), with the
same run guard as the weekly run (`PmRunGuard`: model order with the circuit
breaker and backup, the dollar budget, `llm_usage` as `debrief_improver`, our own
step records). The thread lives in ally-be and arrives in the request, so there is
no checkpointer; LangSmith tracing is off, as for every PM agent run.

ally-be keeps every rule: an approval or a turn-down only ever answers
`awaiting_yes` until the person's next message is a yes and the agent calls
`confirm_plan`; the actions it took are read back from ally-be's own record of the
turn, not from what the model says.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langsmith.run_helpers import tracing_context

from app.core.debrief_graph.gateway import Gateway, HttpGateway
from app.core.pm_agent.ledger import RunLedger
from app.core.pm_agent.middleware import PmRunGuard, _text
from app.core.pm_agent.models import build_models
from app.core.pm_agent.schemas import PmConversationRequest
from app.core.pm_agent.tools import (
    CONVERSATION_TOOLS,
    READ_TOOLS,
    make_tools,
)
from app.prompts.resolver import load_template
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: The instructions' Skills Store prompt (`ally_ai_debrief_pm_conversation_system`).
PROMPT_PATH = "debrief/pm_conversation_system"
#: A turn is short: model passes and tool calls together before the loop is cut.
RECURSION_LIMIT = 40
TOOL_TIMEOUT_S = 60.0
#: The tools a conversation may be given when ally-be lists none.
DEFAULT_TOOLS = (
    *READ_TOOLS,
    "idea_propose",
    "release_draft",
    "ladder_start_quick_test",
    *CONVERSATION_TOOLS,
)

BUDGET_REPLY = (
    "I stopped before finishing because this conversation's budget is spent. "
    "Ask again later, or raise the PM agent's budget in Settings."
)
FAILED_REPLY = "I couldn't answer just now. Please try again in a minute."


def _context_block(req: PmConversationRequest) -> str:
    parts: List[str] = []
    if req.about:
        parts.append(
            "The person is looking at:\n"
            + json.dumps(req.about, ensure_ascii=False, default=str)[:12_000]
        )
    if req.pending_plan:
        parts.append(
            "Plan waiting for their yes (confirm it only if this message is a clear "
            "yes to it):\n" + json.dumps(req.pending_plan, ensure_ascii=False)
        )
    return "\n\n".join(parts)


def build_messages(req: PmConversationRequest) -> List[BaseMessage]:
    """The thread as chat turns, then the person's message with its context."""
    out: List[BaseMessage] = []
    for m in req.history:
        if m.who == "agent":
            action = (
                f"\n[action: {m.action.get('label')} ({m.action.get('status')})]"
                if m.action
                else ""
            )
            out.append(AIMessage(content=m.text + action))
        else:
            out.append(HumanMessage(content=f"{m.author or 'A person'}: {m.text}"))
    context = _context_block(req)
    out.append(
        HumanMessage(
            content=f"{req.author or 'A person'}: {req.message}"
            + (f"\n\n---\n{context}" if context else "")
        )
    )
    return out


async def run_conversation(
    req: PmConversationRequest,
    *,
    default_model: str,
    models_factory: Callable[..., Dict[str, Any]] = build_models,
    gateway: Optional[Gateway] = None,
) -> Dict[str, Any]:
    primary = req.model or default_model
    ledger = RunLedger(run_id=req.turn_id, budget_usd=req.budget_usd, prices=req.prices)
    gw = gateway or HttpGateway(req.gateway_url, req.agent_token, TOOL_TIMEOUT_S)

    def result(status: str, reply: Optional[str], error: Optional[str] = None):
        return {
            "status": status,
            "reply": reply,
            "steps": ledger.steps,
            "estimated_cost_usd": round(ledger.spent_usd, 4),
            "model": ledger.models_used[0] if ledger.models_used else None,
            "refusals": ledger.refusals,
            "error": error,
        }

    try:
        models = models_factory(primary, req.backup_model, req.prices)
        if not models:
            return result(
                "failed", FAILED_REPLY, "no priced model this environment can run"
            )
        if ledger.exhausted:
            return result("budget_spent", BUDGET_REPLY)
        wanted = req.tools or list(DEFAULT_TOOLS)
        allowed = [t for t in wanted if t in DEFAULT_TOOLS]
        first = next(m for m in (primary, req.backup_model, *models) if m in models)
        agent = create_agent(
            model=models[first],
            tools=make_tools(gw, ledger, allowed),
            system_prompt=load_template(PROMPT_PATH, prompts=req.prompts),
            middleware=[
                PmRunGuard(ledger, models, primary, req.backup_model, "conversation")
            ],
            name="debrief_pm_conversation",
        )
        with tracing_context(enabled=False):
            state = await agent.ainvoke(
                {"messages": build_messages(req)},
                {
                    "recursion_limit": RECURSION_LIMIT,
                    "run_name": "debrief_pm_conversation",
                },
            )
        if ledger.stopped_for_budget:
            return result("budget_spent", BUDGET_REPLY)
        last = next(
            (
                m
                for m in reversed(state.get("messages", []))
                if isinstance(m, AIMessage)
            ),
            None,
        )
        reply = _text(last).strip()
        return result("finished", reply or FAILED_REPLY)
    except Exception as e:  # noqa: BLE001 - reported to ally-be as a failed turn
        logger.error(
            "PM conversation turn %s failed: %s", req.turn_id, type(e).__name__
        )
        return result("failed", FAILED_REPLY, f"{type(e).__name__}: {e}"[:300])
    finally:
        if gateway is None:
            try:
                await gw.aclose()
            except Exception:  # noqa: BLE001
                pass
