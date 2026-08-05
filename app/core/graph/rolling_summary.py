"""Rolling conversation summary (episodic memory) helpers.

Maintains a compact, incrementally-updated account of the conversation so
generate_response can send [system prompt + summary + verbatim tail] instead
of the full history, and so a final summary can be shipped to Core at session
end as case-level memory. See ROLLING_SUMMARY_* in app/core/config.py.
"""

import asyncio
from typing import List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from app.core.logger import get_logger
from app.llms.base import BaseLLMClient
from app.prompts.resolver import load_template

logger = get_logger(__name__)

_FALLBACK_TEMPLATE_PATH = "system/rolling_summary"


class RollingSummaryStore:
    """In-process holder for the session's rolling summary (episodic memory).

    Owned by the AgentWorker (like SessionClock / ScoreKeeper) and shared with
    the graph nodes via the run config. Deliberately kept OUT of LangGraph
    state, for two reasons learned the hard way in the first live A/B run:

    1. Latency: compaction runs as a DETACHED asyncio task, so the graph run
       — and therefore the next turn's reply — never waits on the summarizer
       LLM call. A state-based compactor extended the graph run by 5-8s and
       showed up directly in the next turn's voice-to-voice latency.
    2. Shutdown robustness: ending a session mid-turn cancels the in-flight
       graph run and can leave the thread's only checkpoint partial (the
       PruningCheckpointer keeps a single checkpoint), making state unreadable
       at finalize. The in-process store always has the last good summary.
    """

    def __init__(self) -> None:
        self.summary: Optional[str] = None
        # How many leading messages of the conversation the summary covers.
        self.covered_count: int = 0
        # Total messages seen when the last compaction was scheduled.
        self.total_count: int = 0
        self._task: Optional[asyncio.Task] = None

    @property
    def in_flight(self) -> bool:
        return self._task is not None and not self._task.done()


class RollingSummaryResponse(BaseModel):
    """Structured output for the summarizer call."""

    summary: str


def summary_boundary_index(messages: List[BaseMessage], tail_dialogues: int) -> int:
    """Index up to which messages may be folded into the rolling summary.

    The last ``tail_dialogues`` learner turns (and everything after the
    earliest kept turn) stay verbatim — same anchoring rule as
    ``_trim_history_to_last_dialogues``. Returns 0 (nothing summarizable)
    while the conversation is shorter than the tail.
    """
    if tail_dialogues <= 0:
        return len(messages)
    human_indices = [i for i, m in enumerate(messages) if isinstance(m, HumanMessage)]
    if len(human_indices) <= tail_dialogues:
        return 0
    return human_indices[-tail_dialogues]


def count_learner_turns(messages: List[BaseMessage]) -> int:
    """Number of learner (HumanMessage) turns in the slice."""
    return sum(1 for m in messages if isinstance(m, HumanMessage))


def _format_turns(messages: List[BaseMessage]) -> str:
    """Render message objects as a readable script (same role mapping as
    generate_chat_summary: the agent IS the client, the learner is the
    counselor)."""
    lines = []
    for msg in messages:
        if isinstance(msg, HumanMessage):
            role_label = "COUNSELLOR"
        elif isinstance(msg, AIMessage):
            role_label = "YOU"
        else:
            continue
        content = getattr(msg, "content", str(msg))
        if content:
            lines.append(f"{role_label}: {content}")
    return "\n".join(lines)


async def update_rolling_summary(
    previous_summary: Optional[str],
    new_messages: List[BaseMessage],
    llm_client: BaseLLMClient,
    prompt_data=None,
) -> Optional[str]:
    """Merge ``new_messages`` into ``previous_summary`` with one LLM call.

    Returns the updated summary text, or None when there is nothing to
    summarize. Raises on LLM failure — callers decide the fallback (keep the
    previous summary and retry on a later turn).
    """
    turns_text = _format_turns(new_messages)
    if not turns_text.strip():
        return previous_summary

    system_text = load_template(_FALLBACK_TEMPLATE_PATH, prompt_data)
    if not system_text:
        logger.warning("[ROLLING_SUMMARY] summarizer template resolved empty; skipping")
        return previous_summary

    user_text = (
        "Current summary (empty if this is the first update):\n"
        f"{(previous_summary or '').strip() or '(none)'}\n\n"
        "New conversation turns to fold in:\n"
        f"{turns_text}"
    )

    response = await llm_client.llm_instance.with_structured_output(
        RollingSummaryResponse
    ).ainvoke(
        [
            SystemMessage(content=system_text),
            HumanMessage(content=user_text),
        ]
    )
    summary = (response.summary or "").strip()
    return summary or previous_summary
