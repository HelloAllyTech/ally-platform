"""The tool registry. Add a tool by adding a module and a line here."""

from __future__ import annotations

from typing import Any, Dict, List

from app.core.agent_runtime.tools import search_knowledge
from app.core.agent_runtime.tools.base import Tool, ToolContext, ToolResult

REGISTRY: Dict[str, Tool] = {tool.name: tool for tool in (search_knowledge.TOOL,)}


def allowed_tools(bot: Dict[str, Any]) -> List[Tool]:
    """The tools this bot's agent may call.

    Every registered tool, for a bot with the agent on. A per-bot allow-list comes
    with the ally-be tool gateway (chunk 3b).
    """
    if not (bot.get("features") or {}).get("agent"):
        return []
    return list(REGISTRY.values())


__all__ = ["REGISTRY", "Tool", "ToolContext", "ToolResult", "allowed_tools"]
