"""One reply's read-only inputs and its trace, handed to the agent as LangGraph
runtime context. Nothing is checkpointed: a reply is one request, and the
thread lives in ally-be's `scenario_session_chat_messages`."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple

from app.core.ask_ally.schemas import ReplyModel


def _now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


@dataclass
class ReplyRun:
    run_id: str
    session_id: str
    chat_id: str
    tenant_id: Optional[str]
    reply: ReplyModel
    prices: Dict[str, Dict[str, float]]
    #: A `debrief_graph.gateway.Gateway`. Typed Any: LangChain builds a schema
    #: from the tools' `ToolRuntime[ReplyRun]`, and cannot check a Protocol.
    gateway: Any
    #: Every piece of reply text sent to the learner, in order.
    streamed: List[str] = field(default_factory=list)
    #: Where the current model pass's text starts in `streamed`.
    pass_start: int = 0
    #: What each successful tool returned, so ally-be's quote check accepts
    #: quotes from it.
    tool_texts: List[str] = field(default_factory=list)
    #: Per tool call id: (one-line summary of what came back, guidance topic).
    found: Dict[str, Tuple[str, Optional[str]]] = field(default_factory=dict)
    #: Per tool call id: why it failed.
    errors: Dict[str, str] = field(default_factory=dict)
    # --- the trace ally-be keeps on the run (`workspace.replyTraces`) ---------
    at: str = field(default_factory=_now_iso)
    turns: int = 0
    cost_usd: float = 0.0
    last_turn_cost: float = 0.0
    tools: List[Dict[str, Any]] = field(default_factory=list)
    stopped_by: Optional[Literal["max_turns", "budget"]] = None

    @property
    def text(self) -> str:
        return "".join(self.streamed)

    @property
    def pass_has_text(self) -> bool:
        return len(self.streamed) > self.pass_start

    def trace(self) -> Dict[str, Any]:
        """The shape the Debrief Console reads (`DebriefReplyTrace`). Never the
        learner's message: tool records carry a guidance topic at most."""
        out: Dict[str, Any] = {
            "at": self.at,
            "model": self.reply.model,
            "turns": self.turns,
            "costUsd": round(self.cost_usd, 6),
            "tools": self.tools,
        }
        if self.stopped_by:
            out["stoppedBy"] = self.stopped_by
        return out
