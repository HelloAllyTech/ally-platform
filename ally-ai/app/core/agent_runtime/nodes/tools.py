"""Tools: run the tool the agent asked for, and add one trace step for it.

The run's first search sets the response's `retrieval` block and is the one
logged to the retrieval log, as v1's single search is.
"""

from __future__ import annotations

import time
from typing import Any, Dict

from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.tools import ToolContext, allowed_tools
from app.core.agent_runtime.trace import Node, trace_step
from app.core.knowledge_agent.agent import KnowledgeAgentService
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
        else:
            args = tool.input_model.model_validate(step.get(name) or {})
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
