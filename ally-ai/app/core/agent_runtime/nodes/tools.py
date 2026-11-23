"""Tools: run the tool the agent asked for, and add one trace step for it.

Every search streams the same way, with no code of its own: `searching` (with the
input's `query`, when it has one) as it starts, its step, then `found` with the
passages it added. A gateway tool (chunk 3b) emits no status (the bot page has no
copy for one yet), only its step: the tool, `ok` or its error code, and ms. One
that ends the run (`hand_over`) and succeeded sets the run's result, and the graph
ends without another model step.

The run's first search sets the response's `retrieval` block, as v1's single
search does. Every search is logged to the retrieval log (chunk 6b): the first, a
later one in the same message, and one a rewrite was sent back to make. Before 6b
only the first was.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Literal, Optional

from langgraph.graph import END
from langgraph.runtime import get_runtime

from app.core.agent_runtime import activity, stages
from app.core.agent_runtime.budget import extend_after_write
from app.core.agent_runtime.gateway import AgentRunContext
from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.tools import Tool, ToolContext, allowed_tools
from app.core.agent_runtime.tools.confirmed import confirmed_texts
from app.core.agent_runtime.trace import Node, status, trace_step
from app.core.knowledge_agent.agent import KnowledgeAgentService, build_result
from app.core.knowledge_agent.schemas import AnswerIntent, DeclineReason
from app.utils.logger import get_logger

logger = get_logger(__name__)


def make_tools_node(service: KnowledgeAgentService) -> Node:
    async def tools(state: AgentState) -> Dict[str, Any]:
        started = time.monotonic()
        step = state["agent_step"]
        name = step["action"]
        offered = {tool.name: tool for tool in allowed_tools(state["bot"])}
        records = list(state.get("tool_calls") or [])
        passages = list(state.get("passages") or [])
        first_search = state.get("retrieval") is None
        update: Dict[str, Any] = {}
        did_list = list(state.get("activity") or [])

        tool = offered.get(name)
        stages.stage(
            "tool_start",
            active=f"tool:{name}",
            tool=name,
            kind=getattr(tool, "kind", "unknown"),
            step=len(records),
        )
        if tool is None:
            # Unreachable through the step schema, which names only offered tools;
            # kept so a bad step costs one tool call rather than the run.
            logger.warning("Agent asked for a tool it was not offered: %s", name)
            records.append({"tool": name, "refused": True})
            summary = f"{name}: not available"
            added = []
        elif tool.kind == "gateway":
            args = tool.input_model.model_validate(step.get(name) or {})
            # The live step the bot page shows (chunk 6b): a kind, the list's name
            # and a record's title, never the tool, an id or the input.
            doing = activity.describe(
                name,
                tool.kind,
                args.model_dump(mode="json", by_alias=True),
                state["bot"],
                passages,
            )
            activity.started(doing)
            result = await tool.handler(
                args,
                ToolContext(
                    service=service,
                    bot=state["bot"],
                    limits=state["limits"],
                    passages=passages,
                    language=step.get("language") or "en",
                    gateway=_gateway(),
                    run_id=state["run_id"],
                    step=len(records),
                    # The person's own words, and the sent message a plain yes
                    # answers (8a); never the model's summary of them.
                    messages=tuple(
                        confirmed_texts(state.get("history"), state["question"])
                    ),
                    today=state["bot"].get("gateway_today") or "",
                    latest=state["question"] or "",
                ),
            )
            if doing:
                written = [p.get("record_id") for p in result.passages or []]
                did = {**doing, "ok": bool(result.record.get("ok"))}
                if result.record.get("list_kind") in ("create", "update") and written:
                    did["record_id"] = written[0]
                did_list.append(did)
            records.append(json_safe(result.record))
            summary = result.summary
            if result.record.get("ok") and result.record.get("list_kind") in (
                "create",
                "update",
            ):
                # Booked or changed: the reply that says so gets more time (8a).
                extend_after_write(state.get("started_at"))
            # A list tool's records (chunk 6) join the run's passages, numbered
            # after them, citable; they are not searches.
            added = json_safe(result.passages)
            asked = result.record.get("questions")
            if result.record.get("error") == "needs_confirmation" and asked:
                # The gateway asks before it writes (chunk H1): its question is the
                # reply, and the run ends here, with no more model calls.
                language = (step.get("language") or "en").strip()
                question = asked.get("hi") if language.startswith("hi") else None
                update = {
                    "result": json_safe(
                        _asked_result(
                            service, state, step, question or asked.get("en") or ""
                        )
                    )
                }
            elif tool.name == "hand_over" and result.record.get("ok"):
                # Q4 G1 (Round 7 R1): the hand-over never replaces the answer. The run
                # goes on, so the reply answers what it can; the result says
                # `handover`, and ally-be adds its hand-over line after the reply.
                update = {"handed_over": True}
            elif tool.ends_run and result.record.get("ok"):
                update = {
                    "result": json_safe(_handover_result(service, state, step, tool))
                }
        else:
            args = tool.input_model.model_validate(step.get(name) or {})
            status("searching", getattr(args, "query", None) or None)
            searching = activity.describe(name, tool.kind, {}, state["bot"], passages)
            activity.started(searching)
            result = await tool.handler(
                args,
                ToolContext(
                    service=service,
                    bot=state["bot"],
                    limits=state["limits"],
                    passages=passages,
                    language=step.get("language") or "en",
                    # Every search, not only the first (chunk 6b, 3a's open item).
                    log_retrieval=state["bot"].get("log_retrieval", True),
                    # Q4 C14: searched as written beside the English query.
                    latest=state.get("question") or "",
                ),
            )
            records.append(json_safe(result.record))
            if searching:
                did_list.append({**searching, "ok": True})
            summary = result.summary
            added = json_safe(result.passages)
            titles = list(
                dict.fromkeys(
                    p.get("document_title") for p in added if p.get("document_title")
                )
            )[:3]
            status(
                "found",
                (
                    (f"{len(added)} passage" + ("" if len(added) == 1 else "s"))
                    if added
                    else "nothing new"
                ),
                titles or None,
            )
            if result.retrieval is not None and first_search:
                update = {
                    "retrieval": json_safe(result.retrieval),
                    "hits": json_safe(result.hits),
                    "search_gate": result.gate,
                }

        last = records[-1] if records else {}
        stages.stage(
            "tool_end",
            active="between_nodes",
            tool=name,
            dur_ms=int((time.monotonic() - started) * 1000),
            ok=bool(last.get("ok", not last.get("refused"))),
            error=last.get("error") or "-",
            list_kind=last.get("list_kind") or "-",
            passages=len(added),
        )
        return {
            **update,
            **({"activity": json_safe(did_list)} if did_list else {}),
            "tool_calls": records,
            "passages": passages + added,
            "trace": [trace_step("tool", started, summary)],
        }

    return tools


def _gateway() -> Optional[Any]:
    """The run's gateway client, from LangGraph's runtime context (never state)."""
    try:
        context = get_runtime(AgentRunContext).context
    except RuntimeError:  # called outside a graph run
        return None
    return getattr(context, "gateway", None)


def _handover_result(
    service: KnowledgeAgentService,
    state: AgentState,
    step: Dict[str, Any],
    tool: Tool,
) -> Dict[str, Any]:
    """The run's result after `hand_over`: no answer and no citations, and
    `handover: true`, so ally-be sends its hand-over message."""
    language = (step.get("language") or state.get("language") or "en").strip()
    retrieval = state.get("retrieval") or service.retrieval_meta(
        state["limits"],
        [],
        language=language,
        translated=None,
        translation_degraded=False,
    )
    result: Dict[str, Any] = dict(
        build_result(
            intent=AnswerIntent.DECLINE,
            answer="",
            language=language,
            confidence=0.0,
            citations=[],
            decline_reason=DeclineReason.NONE,
            retrieval={**retrieval, "passages_used": len(state.get("passages") or [])},
            meta=state.get("agent_meta") or {},
        )
    )
    result["turn_type"] = state.get("turn_type") or "question"
    result["handover"] = True
    return result


def _asked_result(
    service: KnowledgeAgentService,
    state: AgentState,
    step: Dict[str, Any],
    question: str,
) -> Dict[str, Any]:
    """The run's result when the gateway asked for a yes (chunk H1): its question,
    as a clarifying reply, no citations."""
    language = (step.get("language") or state.get("language") or "en").strip()
    retrieval = state.get("retrieval") or service.retrieval_meta(
        state["limits"],
        [],
        language=language,
        translated=None,
        translation_degraded=False,
    )
    result: Dict[str, Any] = dict(
        build_result(
            intent=AnswerIntent.CLARIFY,
            answer=question,
            language=language,
            confidence=1.0,
            citations=[],
            decline_reason=DeclineReason.NONE,
            retrieval={**retrieval, "passages_used": len(state.get("passages") or [])},
            meta=state.get("agent_meta") or {},
        )
    )
    result["turn_type"] = "question"
    return result


def route_after_tools(state: AgentState) -> Literal["agent", "__end__"]:
    """A tool that ended the run set its result: no further model step or check."""
    return END if state.get("result") else "agent"
