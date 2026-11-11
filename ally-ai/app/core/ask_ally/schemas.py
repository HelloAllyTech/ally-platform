"""`POST /api/v1/ask-ally/replies`: what ally-be sends (CONTRACT.md §5)."""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

#: v9 FR-43 / NFR-2: one reply costs at most this, across its passes.
REPLY_BUDGET_USD = 0.05
#: v9 FR-43: model passes per reply, tool passes included; the last never calls a tool.
REPLY_MAX_TURNS = 4


class ReplyModel(BaseModel):
    """The release bundle's `reply` (ally-be `DebriefReplyConfig`)."""

    provider: Literal["gemini", "openai", "anthropic"]
    model: str
    maxTokens: int = Field(900, gt=0, le=1000)
    budgetUsd: Optional[float] = Field(None, gt=0)
    maxTurns: Optional[int] = Field(None, ge=1, le=REPLY_MAX_TURNS)

    @property
    def budget(self) -> float:
        return min(self.budgetUsd or REPLY_BUDGET_USD, REPLY_BUDGET_USD)

    @property
    def max_turns(self) -> int:
        return self.maxTurns or REPLY_MAX_TURNS


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskAllyRequest(BaseModel):
    run_id: str
    scenario_session_id: str
    chat_id: str
    tenant_id: Optional[str] = None
    reply: ReplyModel
    #: Per-model prices; the reply's model must be priced or it never runs.
    prices: Dict[str, Dict[str, float]] = Field(default_factory=dict)
    #: The whole system prompt as ally-be built it: the live reply prompt, the
    #: debrief, the transcript, the organisation's wording and the length rule.
    system: str
    #: The thread's last turns, oldest first, without the new message.
    history: List[ChatTurn] = Field(default_factory=list)
    message: str
    run_token: str
    gateway_url: str
