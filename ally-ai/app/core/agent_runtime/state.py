"""What one agent run carries from node to node, and what the checkpointer stores.

Everything here must stay JSON-safe (strings, numbers, lists, dicts): no clients,
no enums, no UUID objects. The checkpointer stores it, and later chunks read it
back to explain a reply.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Dict, List, Optional, TypedDict

from app.core.agent_runtime.schemas import TurnType
from app.core.knowledge_agent.schemas import AnswerMode


def add_trace(
    left: Optional[List[Dict[str, Any]]], right: Optional[List[Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    """Append trace steps; None resets.

    A thread keeps its state between runs, so a plain `operator.add` would carry the
    previous run's steps into this one. Each run starts by sending None.
    """
    if right is None:
        return []
    return (left or []) + right


class BotConfig(TypedDict, total=False):
    """The bot a run answers for: everything `/knowledge-agent/answer` takes besides
    the question and history, plus the agent's own inputs. Built from the request by
    `AgentRunRequest.to_bot()`."""

    prompts: Optional[Dict[str, Any]]  # with the bot's model override
    limits: Dict[str, Any]  # retrieval thresholds; None = the settings default
    max_answer_chars: int
    translate_query: bool
    document_ids: Optional[List[str]]  # [] searches nothing; None searches all
    persona: Optional[Dict[str, Any]]
    answer_mode: AnswerMode
    channel: Optional[str]
    audience: Dict[str, Any]
    log_retrieval: bool
    # --- conversational agent
    knowledge_topics: List[str]
    decline_text: Optional[str]
    # --- tool gateway (chunk 3b): the names ally-be offers, never its URL or token
    gateway_tools: List[str]
    # --- list tools (chunk 6): their definitions, and the names left out by the cap
    gateway_definitions: List[Dict[str, Any]]
    gateway_omitted: List[str]
    gateway_today: str


class RunInput(TypedDict, total=False):
    # --- input
    run_id: str
    chatbot_id: Optional[str]
    conversation_id: str  # also the checkpointer thread_id
    question: str
    history: List[Dict[str, str]]
    bot: BotConfig


class RunWorking(TypedDict, total=False):
    """Working and output keys, cleared at the start of every run (see
    RUN_SCOPED_KEYS)."""

    # --- working
    limits: Dict[str, Any]
    language: str
    hits: List[Dict[str, Any]]  # the run's first search, best first
    retrieval: Dict[str, Any]
    passages: List[Dict[str, Any]]
    turn_type: Optional[TurnType]
    # The gate verdict on the run's first search (a DeclineReason value); None when
    # it found something relevant or no search ran.
    search_gate: Optional[str]
    agent_step: Optional[Dict[str, Any]]  # the latest structured step
    agent_meta: Optional[Dict[str, Any]]
    agent_calls: int
    tool_calls: List[Dict[str, Any]]  # one record per tool call (tools/base.py)
    # Why check sent the last draft back (None: not sent back), and how many
    # times it has; see nodes/agent_check.py.
    feedback: Optional[str]
    feedback_text: Optional[str]  # what the rewrite is told (check.py)
    revisions: int
    started_at: Optional[float]  # wall clock at the run's first agent step
    # The first draft as it would have gone out, when it was sent back for something
    # that still let it go out (agent_check.py).
    fallback_result: Optional[Dict[str, Any]]

    # --- output: the `/knowledge-agent/answer` response, field for field
    result: Optional[Dict[str, Any]]


class AgentState(RunInput, RunWorking, total=False):
    trace: Annotated[List[Dict[str, Any]], add_trace]


#: Cleared at the start of every run so nothing from the previous run in the same
#: thread can leak into this one. Derived, so a new working key is cleared too.
RUN_SCOPED_KEYS = tuple(RunWorking.__annotations__)


def json_safe(value: Any) -> Any:
    """Plain JSON types only: str-enums become their value, UUIDs become strings."""
    return json.loads(json.dumps(value, default=str))
