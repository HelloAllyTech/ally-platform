"""The tool registry. Add a tool by adding a module and a line here."""

from __future__ import annotations

from typing import Dict, List

from app.core.agent_runtime.state import BotConfig
from app.core.agent_runtime.tools import hand_over, search_knowledge
from app.core.agent_runtime.tools.base import Tool, ToolContext, ToolResult

REGISTRY: Dict[str, Tool] = {
    tool.name: tool for tool in (search_knowledge.TOOL, hand_over.TOOL)
}


def search_tools(bot: BotConfig) -> List[Tool]:
    """The search tools: every bot's, as before chunk 3b."""
    return [tool for tool in REGISTRY.values() if tool.kind == "search"]


def gateway_tools(bot: BotConfig) -> List[Tool]:
    """The gateway tools this run may call: each one ally-be's request names
    (`gateway_tools`, present only with a gateway) and this registry has."""
    named = bot.get("gateway_tools") or []
    return [
        tool
        for tool in REGISTRY.values()
        if tool.kind == "gateway" and tool.name in named
    ]


def allowed_tools(bot: BotConfig) -> List[Tool]:
    """The tools this bot's agent may call: the search tools, plus the gateway
    tools its request named. Without a gateway, exactly the search tools."""
    return search_tools(bot) + gateway_tools(bot)


__all__ = [
    "REGISTRY",
    "Tool",
    "ToolContext",
    "ToolResult",
    "allowed_tools",
    "gateway_tools",
    "search_tools",
]
