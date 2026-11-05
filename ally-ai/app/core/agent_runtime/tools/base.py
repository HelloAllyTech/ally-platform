"""What a tool is: one small module per tool, registered in `tools/__init__.py`.

A tool's handler gets its validated input and a `ToolContext`, and returns a
`ToolResult`. It never touches graph state directly, so a new tool is a new module
and a registry line, with no change to the graph.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Literal, Type

from pydantic import BaseModel

Risk = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class ToolContext:
    """What a handler may read: the bot's settings and the run's passages so far."""

    #: The KnowledgeAgentService (retrieval, selection). Typed loosely so this
    #: module imports without the knowledge agent.
    service: Any
    bot: Dict[str, Any]
    limits: Dict[str, Any]
    #: Every passage already offered to the model, in prompt order.
    passages: List[Dict[str, Any]]


@dataclass(frozen=True)
class ToolResult:
    #: New passages, appended after the existing ones, so their numbers continue
    #: the run's numbering.
    passages: List[Dict[str, Any]] = field(default_factory=list)
    #: One line for the trace: counts and scores only, never text.
    summary: str = ""
    #: JSON-safe record kept in the run's state; the prompt shows it back to the
    #: model as "searches already made".
    record: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Tool:
    name: str
    #: Shown to the model.
    description: str
    #: The input schema; every field needs a default (see agent_runtime/schemas.py).
    input_model: Type[BaseModel]
    risk: Risk
    handler: Callable[[BaseModel, ToolContext], Awaitable[ToolResult]]
