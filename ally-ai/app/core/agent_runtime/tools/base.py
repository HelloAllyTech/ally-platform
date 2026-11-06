"""What a tool is: one small module per tool, registered in `tools/__init__.py`.

A tool's handler gets its validated input and a `ToolContext`, and returns a
`ToolResult`. It never touches graph state directly, so a new tool is a new module
and a registry line, with no change to the graph.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Protocol,
    Sequence,
    Tuple,
    Type,
)

from pydantic import BaseModel

from app.core.agent_runtime.state import BotConfig
from app.core.knowledge_agent.schemas import DeclineReason

Risk = Literal["low", "medium", "high"]


class KnowledgeSearch(Protocol):
    """The KnowledgeAgentService steps a search tool uses. A Protocol, so this module
    imports without the knowledge agent and its clients."""

    async def retrieve(
        self,
        search_text: str,
        audience: Any,
        *,
        limits: Dict[str, Any],
        document_ids: Optional[List[str]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]: ...

    def retrieval_meta(
        self,
        limits: Dict[str, Any],
        hits: Sequence[Dict[str, Any]],
        *,
        language: str,
        translated: Optional[str],
        translation_degraded: bool,
    ) -> Dict[str, Any]: ...

    def gate(
        self,
        hits: Sequence[Dict[str, Any]],
        *,
        decline_similarity: float,
        general: bool,
        translation_degraded: bool,
    ) -> Optional[DeclineReason]: ...

    def select(
        self,
        hits: List[Dict[str, Any]],
        *,
        search_text: str,
        limits: Dict[str, Any],
        latency_ms: int,
        language: str,
        retrieval: Dict[str, Any],
        log_retrieval: bool = True,
    ) -> List[Dict[str, Any]]: ...

    def report_gate_decline(
        self,
        reason: DeclineReason,
        *,
        search_text: str,
        hits: List[Dict[str, Any]],
        limits: Dict[str, Any],
        latency_ms: int,
        language: str,
    ) -> None: ...


@dataclass(frozen=True)
class ToolContext:
    """What a handler may read: the bot's settings and the run's passages so far."""

    #: The KnowledgeAgentService (retrieval, selection).
    service: KnowledgeSearch
    bot: BotConfig
    limits: Dict[str, Any]
    #: Every passage already offered to the model, in prompt order.
    passages: List[Dict[str, Any]]
    #: The language the agent says the latest message is in.
    language: str = "en"
    #: True for the run's first search only (and only when the bot logs
    #: retrieval), so each message is logged once, as in v1.
    log_retrieval: bool = False


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
    #: A search tool's `retrieval` block. The run's first search sets the
    #: response's block, so it reads like v1's.
    retrieval: Optional[Dict[str, Any]] = None
    #: A search tool's hits, best first, before selection (debug output only).
    hits: List[Dict[str, Any]] = field(default_factory=list)
    #: A search tool's gate verdict (a DeclineReason value, or None when it found
    #: something relevant). A decline with nothing found reports it as its reason.
    gate: Optional[str] = None


@dataclass(frozen=True)
class Tool:
    name: str
    #: Shown to the model.
    description: str
    #: The input schema; every field needs a default (see agent_runtime/schemas.py).
    input_model: Type[BaseModel]
    risk: Risk
    handler: Callable[[BaseModel, ToolContext], Awaitable[ToolResult]]
