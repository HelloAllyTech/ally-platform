"""The tool registry. Add a tool by adding a module and a line here."""

from __future__ import annotations

from typing import Dict, List

from app.core.agent_runtime.state import BotConfig
from app.core.agent_runtime.tools import hand_over, search_knowledge
from app.core.agent_runtime.tools.base import Tool, ToolContext, ToolResult
from app.core.agent_runtime.tools.lists import list_tools

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
    built_in = [
        tool
        for tool in REGISTRY.values()
        if tool.kind == "gateway" and tool.name in named
    ]
    # The list tools (chunk 6), built from their definitions; only those the
    # token names.
    generated = [
        tool
        for tool in list_tools(bot.get("gateway_definitions"))
        if tool.name in named and tool.name not in REGISTRY
    ]
    return built_in + generated


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
