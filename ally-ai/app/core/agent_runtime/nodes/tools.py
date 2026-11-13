"""Tools: run the tool the agent asked for, and add one trace step for it.

Every search streams the same way, with no code of its own: `searching` (with the
input's `query`, when it has one) as it starts, its step, then `found` with the
passages it added. A gateway tool (chunk 3b) emits no status (the bot page has no
copy for one yet), only its step: the tool, `ok` or its error code, and ms. One
that ends the run (`hand_over`) and succeeded sets the run's result, and the graph
ends without another model step.

The run's first search sets the response's `retrieval` block and is the one
logged to the retrieval log, as v1's single search is.
"""

from __future__ import annotations

import time
from typing import Any, Dict, Literal, Optional

from langgraph.graph import END
from langgraph.runtime import get_runtime

from app.core.agent_runtime.gateway import AgentRunContext
from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.tools import Tool, ToolContext, allowed_tools
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

        tool = offered.get(name)
        if tool is None:
            # Unreachable through the step schema, which names only offered tools;
            # kept so a bad step costs one tool call rather than the run.
            logger.warning("Agent asked for a tool it was not offered: %s", name)
            records.append({"tool": name, "refused": True})
            summary = f"{name}: not available"
            added = []
        elif tool.kind == "gateway":
            args = tool.input_model.model_validate(step.get(name) or {})
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
                ),
            )
            records.append(json_safe(result.record))
            summary = result.summary
            added = []
            if tool.ends_run and result.record.get("ok"):
                update = {
                    "result": json_safe(_handover_result(service, state, step, tool))
                }
        else:
            args = tool.input_model.model_validate(step.get(name) or {})
            status("searching", getattr(args, "query", None) or None)
            result = await tool.handler(
                args,
                ToolContext(
                    service=service,
                    bot=state["bot"],
                    limits=state["limits"],
                    passages=passages,
                    language=step.get("language") or "en",
                    log_retrieval=first_search
                    and state["bot"].get("log_retrieval", True),
                ),
            )
            records.append(json_safe(result.record))
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

        return {
            **update,
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


def route_after_tools(state: AgentState) -> Literal["agent", "__end__"]:
    """A tool that ended the run set its result: no further model step or check."""
    return END if state.get("result") else "agent"
