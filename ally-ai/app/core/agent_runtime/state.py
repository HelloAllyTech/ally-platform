"""What one agent run carries from node to node, and what the checkpointer stores.

Everything here must stay JSON-safe (strings, numbers, lists, dicts): no clients,
no enums, no UUID objects. The checkpointer stores it, and later chunks read it
back to explain a reply.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Dict, List, Optional, TypedDict


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


class AgentState(TypedDict, total=False):
    # --- input
    run_id: str
    chatbot_id: Optional[str]
    conversation_id: str  # also the checkpointer thread_id
    question: str
    history: List[Dict[str, str]]
    # documents, persona, answer mode, prompts (with the bot's model override),
    # thresholds, audience: everything `/knowledge-agent/answer` takes besides the
    # question and history.
    bot: Dict[str, Any]

    # --- working
    limits: Dict[str, Any]
    search_text: str
    language: str
    translated_query: Optional[str]
    translation_degraded: bool
    hits: List[Dict[str, Any]]
    retrieval_latency_ms: int
    retrieval: Dict[str, Any]
    gate_reason: Optional[str]  # a DeclineReason value, or None to answer
    passages: List[Dict[str, Any]]
    answer_raw: Optional[Dict[str, Any]]  # the model's structured output
    answer_meta: Optional[Dict[str, Any]]

    # --- working: conversational agent (`features.agent`)
    turn_type: Optional[str]  # smalltalk | about_bot | question | unclear
    standalone_query: Optional[str]
    # The decline reason the up-front search would have given in parity mode;
    # None when it cleared the threshold or did not run.
    prefetch_gate: Optional[str]
    agent_step: Optional[Dict[str, Any]]  # the latest structured step
    agent_meta: Optional[Dict[str, Any]]
    agent_calls: int
    tool_calls: List[Dict[str, Any]]  # one record per tool call (tools/base.py)
    tool_passages: int  # passages added by tools

    # --- output: the `/knowledge-agent/answer` response, field for field
    result: Optional[Dict[str, Any]]
    trace: Annotated[List[Dict[str, Any]], add_trace]


#: Working and output keys, cleared at the start of every run so nothing from the
#: previous run in the same thread can leak into this one.
RUN_SCOPED_KEYS = (
    "limits",
    "search_text",
    "language",
    "translated_query",
    "translation_degraded",
    "hits",
    "retrieval_latency_ms",
    "retrieval",
    "gate_reason",
    "passages",
    "answer_raw",
    "answer_meta",
    "turn_type",
    "standalone_query",
    "prefetch_gate",
    "agent_step",
    "agent_meta",
    "agent_calls",
    "tool_calls",
    "tool_passages",
    "result",
)


def json_safe(value: Any) -> Any:
    """Plain JSON types only: str-enums become their value, UUIDs become strings."""
    return json.loads(json.dumps(value, default=str))
