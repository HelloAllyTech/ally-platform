"""The PM agent in the Debrief console's conversation (V2_AUTONOMY C1-C3).

The same Deep Agent harness as the weekly run (`agent.build_pm_deep_agent`): the
same memory (`/memories/`, one store namespace, so what a person tells it here is
there for the weekly run and the reverse), the same read-only skills, the
investigator and reviewer subagents, and `PmRunGuard` (model order, the turn's
dollar budget, `llm_usage`, our own step records). It gets the conversation's
tools, not the weekly run's.

The thread is a LangGraph thread in the Postgres checkpointer: ally-be names it
(`thread_id`, one per console thread) and sends only the person's new message;
each turn continues from the checkpoint. ally-be's `debrief_pm_messages` stays the
record the console reads.

Approving or turning down a change, and retrying a change that always asks a
person, pause the turn (LangGraph human-in-the-loop, `INTERRUPT_ON`): the turn
returns the pending decision (tool, args, the plan in plain words) and ally-be
keeps it. When the same person's next message is a clear yes and they hold the
permission, ally-be resumes with approve, signing the gateway token for them;
anything else resumes with reject (with their words as the reason) and the agent
answers what they said. Never traced to LangSmith, as for every PM agent run.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from langchain.agents.middleware import InterruptOnConfig, ToolCallRequest
from langchain_core.messages import AIMessage, HumanMessage, ToolCall
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.store.base import BaseStore
from langgraph.types import Command
from langsmith.run_helpers import tracing_context

from app.core.debrief_graph.gateway import Gateway, HttpGateway
from app.core.pm_agent.agent import build_pm_deep_agent, seed_memory, seed_skills
from app.core.pm_agent.ledger import RunLedger
from app.core.pm_agent.middleware import _text
from app.core.pm_agent.models import build_models
from app.core.pm_agent.schemas import PmConversationRequest
from app.core.pm_agent.tools import CONVERSATION_TOOLS, READ_TOOLS, make_tools
from app.prompts.resolver import load_template
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: The instructions' Skills Store prompt (`ally_ai_debrief_pm_conversation_system`).
PROMPT_PATH = "debrief/pm_conversation_system"
#: The console's one shared thread.
THREAD_PREFIX = "debrief-pm-conversation"
#: A turn is short: model passes and tool calls together before the loop is cut.
RECURSION_LIMIT = 80
TOOL_TIMEOUT_S = 60.0
#: The tools a conversation may be given when ally-be lists none.
DEFAULT_TOOLS = tuple(
    dict.fromkeys(
        (
            *READ_TOOLS,
            "idea_propose",
            "release_draft",
            "ladder_start_quick_test",
            *CONVERSATION_TOOLS,
        )
    )
)
#: The decisions a person can make on a paused action.
DECISIONS = ["approve", "reject"]

BUDGET_REPLY = (
    "I stopped before finishing because this conversation's budget is spent. "
    "Ask again later, or raise the PM agent's budget in Settings."
)
FAILED_REPLY = "I couldn't answer just now. Please try again in a minute."
ASK_YES = "Shall I go ahead? Reply yes to confirm."
LOST_PLAN = (
    "(Nothing is waiting for a yes any more, so nothing was done; ask again if "
    "you still want it.)"
)


@dataclass(frozen=True)
class ConversationContext:
    """Run-scoped context the human-in-the-loop `when` predicate reads."""

    #: Changes whose retry always asks a person (ally-be's always-ask list).
    always_ask_idea_ids: frozenset = field(default_factory=frozenset)


def plan_words(tool_call: ToolCall, *_: Any) -> str:
    """The plan in plain words: the model's own `plan` when it gave one."""
    args = tool_call.get("args") or {}
    plan = str(args.get("plan") or "").strip()
    if plan:
        return plan[:600]
    verb = {
        "change_approve": "Approve",
        "change_turn_down": "Turn down",
        "change_retry": "Try again",
    }.get(tool_call.get("name", ""), "Carry out")
    langs = args.get("languages")
    return f"{verb} the change {args.get('idea_id')}" + (
        f" for {', '.join(langs)}." if langs else "."
    )


def _always_asks(request: ToolCallRequest) -> bool:
    ctx = request.runtime.context
    ids = getattr(ctx, "always_ask_idea_ids", None) or ()
    return str((request.tool_call.get("args") or {}).get("idea_id")) in ids


#: What pauses for the person's yes. Only approve or reject: never edited.
INTERRUPT_ON: Dict[str, InterruptOnConfig] = {
    "change_approve": {"allowed_decisions": DECISIONS, "description": plan_words},
    "change_turn_down": {"allowed_decisions": DECISIONS, "description": plan_words},
    "change_retry": {
        "allowed_decisions": DECISIONS,
        "description": plan_words,
        "when": _always_asks,
    },
}


def context_block(req: PmConversationRequest) -> str:
    if not req.about:
        return ""
    return (
        "The person is looking at:\n"
        + json.dumps(req.about, ensure_ascii=False, default=str)[:12_000]
    )


def person_message(req: PmConversationRequest, note: str = "") -> HumanMessage:
    """The person's new message, with what they are looking at."""
    context = context_block(req)
    return HumanMessage(
        content=f"{req.author or 'A person'}: {req.message}"
        + (f"\n{note}" if note else "")
        + (f"\n\n---\n{context}" if context else "")
    )


def pending_decision(interrupts: Any) -> Optional[Dict[str, Any]]:
    """The human-in-the-loop interrupt the thread is paused on, for ally-be."""
    for it in interrupts or ():
        value = getattr(it, "value", None)
        if not isinstance(value, dict) or "action_requests" not in value:
            continue
        return {
            "interrupt_id": it.id,
            "actions": [
                {
                    "tool": a.get("name"),
                    "args": a.get("args") or {},
                    "plan": a.get("description") or "",
                }
                for a in value["action_requests"]
            ],
        }
    return None


def _reply_for_pause(message: Optional[AIMessage], pending: Dict[str, Any]) -> str:
    """The agent's message before the pause states the plan; when the model wrote
    none, the plan itself and the question."""
    text = _text(message).strip()
    if text:
        return text
    plans = " ".join(a["plan"] for a in pending["actions"] if a["plan"])
    return f"{plans}\n\n{ASK_YES}".strip()


async def run_conversation(
    req: PmConversationRequest,
    *,
    store: BaseStore,
    checkpointer: BaseCheckpointSaver,
    default_model: str,
    models_factory: Callable[..., Dict[str, Any]] = build_models,
    gateway: Optional[Gateway] = None,
) -> Dict[str, Any]:
    primary = req.model or default_model
    ledger = RunLedger(run_id=req.turn_id, budget_usd=req.budget_usd, prices=req.prices)
    gw = gateway or HttpGateway(req.gateway_url, req.agent_token, TOOL_TIMEOUT_S)

    def result(
        status: str,
        reply: Optional[str],
        error: Optional[str] = None,
        pending: Optional[Dict[str, Any]] = None,
    ):
        return {
            "status": status,
            "reply": reply,
            "pending": pending,
            "thread_id": req.thread_id,
            "tool_texts": ledger.tool_texts[:400],
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
        agent = build_pm_deep_agent(
            ledger=ledger,
            tools=make_tools(gw, ledger, allowed),
            models=models,
            primary=primary,
            backup=req.backup_model,
            system_prompt=load_template(PROMPT_PATH, prompts=req.prompts),
            store=store,
            checkpointer=checkpointer,
            gateway=gw,
            name="debrief_pm_conversation",
            label="conversation",
            interrupt_on=INTERRUPT_ON,
            context_schema=ConversationContext,
            prompts=req.prompts,
        )
        config = {
            "configurable": {"thread_id": req.thread_id},
            "recursion_limit": RECURSION_LIMIT,
            "run_name": "debrief_pm_conversation",
        }
        context = ConversationContext(frozenset(req.always_ask_idea_ids))
        await seed_memory(store)
        await seed_skills(store, req.prompts)
        paused = pending_decision((await agent.aget_state(config)).interrupts)
        if req.resume and paused and paused["interrupt_id"] == req.resume.interrupt_id:
            # The person's answer to the paused action(s): one decision for each.
            decision: Dict[str, Any] = {"type": req.resume.decision}
            if req.resume.decision == "reject":
                reason = req.resume.message or req.message
                context_text = context_block(req)
                decision["message"] = reason + (
                    f"\n\n---\n{context_text}" if context_text else ""
                )
            graph_input: Any = Command(
                resume={
                    paused["interrupt_id"]: {
                        "decisions": [dict(decision) for _ in paused["actions"]]
                    }
                }
            )
        else:
            # A new message. A pause ally-be no longer holds is left behind: the
            # harness marks its tool call cancelled (PatchToolCallsMiddleware).
            note = LOST_PLAN if req.resume else ""
            graph_input = {"messages": [person_message(req, note)]}
        with tracing_context(enabled=False):
            await agent.ainvoke(graph_input, config, context=context)
        snapshot = await agent.aget_state(config)
        messages = snapshot.values.get("messages", [])
        last = next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)
        if ledger.stopped_for_budget:
            return result("budget_spent", BUDGET_REPLY)
        pending = pending_decision(snapshot.interrupts)
        if pending:
            return result("finished", _reply_for_pause(last, pending), pending=pending)
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
