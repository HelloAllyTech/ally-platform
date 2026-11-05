"""Tools: run the tool the agent asked for, and add one trace step for it."""

from __future__ import annotations

import time
from typing import Any, Dict

from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.tools import ToolContext, allowed_tools
from app.core.agent_runtime.trace import Node
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
                ),
            )
            records.append(json_safe(result.record))
            summary = result.summary
            added = json_safe(result.passages)

        ms = int((time.monotonic() - started) * 1000)
        return {
            "tool_calls": records,
            "passages": passages + added,
            "tool_passages": (state.get("tool_passages") or 0) + len(added),
            "trace": [{"node": "tool", "ms": ms, "summary": summary}],
        }

    return tools
