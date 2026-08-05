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
        # Machine-usable form of the summary (RollingSummaryStructured dump).
        # The prompt uses the rendered text; session_memory ships BOTH so
        # downstream consumers (case previousMemory, future Tracks reads,
        # admin review, judges) never have to re-parse prose.
        self.structured: Optional[dict] = None
        # How many leading messages of the conversation the summary covers.
        self.covered_count: int = 0
        # Total messages seen when the last compaction was scheduled.
        self.total_count: int = 0
        self._task: Optional[asyncio.Task] = None

    @property
    def in_flight(self) -> bool:
        return self._task is not None and not self._task.done()


class RollingSummaryStructured(BaseModel):
    """Structured output for the summarizer call.

    Some session state is too important to trust to prose — disclosures and
    commitments must survive compaction verbatim-ish and be machine-checkable
    (the CompactionDetails lesson: extract critical state mechanically, don't
    hope the summary prose mentions it). The prompt receives the rendered
    text; the structure travels alongside it into session_memory.
    """

    situation: str = ""
    disclosures: List[str] = []
    counsellor_actions: List[str] = []
    emotional_arc: str = ""
    unresolved: List[str] = []


_SECTION_LABELS = [
    ("situation", "Situation"),
    ("disclosures", "You disclosed"),
    ("counsellor_actions", "Counsellor did"),
    ("emotional_arc", "Emotional arc"),
    ("unresolved", "Unresolved"),
]


def render_structured_summary(structured: RollingSummaryStructured) -> str:
    """Render the structure as the labeled-sections text the persona prompt
    (and the case previousMemory sentence) consume. Empty sections are
    omitted so short sessions don't carry dangling headers."""
    lines: List[str] = []
    for field, label in _SECTION_LABELS:
        value = getattr(structured, field)
        if isinstance(value, list):
            items = [str(v).strip() for v in value if v and str(v).strip()]
            if items:
                lines.append(f"{label}:")
                lines.extend(f"- {item}" for item in items)
        else:
            text = (value or "").strip()
            if text:
                lines.append(f"{label}: {text}")
    return "\n".join(lines).strip()


def message_chars(messages: List[BaseMessage]) -> int:
    """Total content characters in the slice (cheap token proxy)."""
    return sum(len(str(getattr(m, "content", "") or "")) for m in messages)


# The tail never shrinks below this many learner turns, no matter how large
# they are — conversational coherence needs a minimum verbatim exchange.
_MIN_TAIL_DIALOGUES = 2


def summary_boundary_index(
    messages: List[BaseMessage],
    tail_dialogues: int,
    tail_max_chars: int = 0,
) -> int:
    """Index up to which messages may be folded into the rolling summary.

    The last ``tail_dialogues`` learner turns (and everything after the
    earliest kept turn) stay verbatim — same anchoring rule as
    ``_trim_history_to_last_dialogues``. Returns 0 (nothing summarizable)
    while the conversation is shorter than the tail.

    ``tail_max_chars`` adds a size bound: turns are not equal-sized, so when
    the turn-counted tail exceeds the char budget it shrinks to fewer learner
    turns (never below ``_MIN_TAIL_DIALOGUES``), keeping the verbatim window
    flat across languages/verbosity.
    """
    if tail_dialogues <= 0:
        return len(messages)
    human_indices = [i for i, m in enumerate(messages) if isinstance(m, HumanMessage)]
    if len(human_indices) <= tail_dialogues:
        return 0
    keep = tail_dialogues
    if tail_max_chars > 0:
        while (
            keep > _MIN_TAIL_DIALOGUES
            and message_chars(messages[human_indices[-keep] :]) > tail_max_chars
        ):
            keep -= 1
    return human_indices[-keep]


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


def _emit_summarizer_usage(raw, llm_client, room_id: Optional[str]) -> None:
    """Best-effort token-usage emission for the cost-by-task dashboard.

    Without this, compaction cost was invisible: only agent_turn was ever
    emitted, so the memory feature's spend could not be measured against its
    benefit. Never raises."""
    try:
        from app.core.llm_usage.emitter import emit_llm_usage
        from app.core.llm_usage.extract import extract_usage_from_aimessage
        from app.core.llm_usage.tasks import LLMTask

        usage = extract_usage_from_aimessage(raw)
        if not usage:
            return
        if room_id is None:
            from app.core.graph.instrumentation import get_room_id

            room_id = get_room_id()
        llm_instance = llm_client.llm_instance
        emit_llm_usage(
            room_id=room_id,
            provider=getattr(llm_client, "provider", None),
            model=(
                getattr(llm_instance, "model_name", None)
                or getattr(llm_instance, "model", None)
            ),
            task=LLMTask.ROLLING_SUMMARY.value,
            usage=usage,
        )
    except Exception:  # noqa: BLE001 - usage must never break compaction
        pass


async def update_rolling_summary(
    previous_summary: Optional[str],
    new_messages: List[BaseMessage],
    llm_client: BaseLLMClient,
    prompt_data=None,
    room_id: Optional[str] = None,
) -> tuple[Optional[str], Optional[dict]]:
    """Merge ``new_messages`` into ``previous_summary`` with one LLM call.

    Returns ``(rendered_text, structured_dict)`` — the rendered labeled-
    sections text for prompt injection, and the machine-usable structure for
    session_memory. Returns ``(previous_summary, None)`` when there is
    nothing to summarize. Raises on LLM failure — callers decide the fallback
    (keep the previous summary and retry on a later trigger).
    """
    turns_text = _format_turns(new_messages)
    if not turns_text.strip():
        return previous_summary, None

    system_text = load_template(_FALLBACK_TEMPLATE_PATH, prompt_data)
    if not system_text:
        logger.warning("[ROLLING_SUMMARY] summarizer template resolved empty; skipping")
        return previous_summary, None

    user_text = (
        "Current summary (empty if this is the first update):\n"
        f"{(previous_summary or '').strip() or '(none)'}\n\n"
        "New conversation turns to fold in:\n"
        f"{turns_text}"
    )

    # include_raw: with_structured_output alone returns only the parsed model,
    # which carries no usage metadata — the raw AIMessage is needed to report
    # the summarizer's token spend (task=rolling_summary).
    result = await llm_client.llm_instance.with_structured_output(
        RollingSummaryStructured, include_raw=True
    ).ainvoke(
        [
            SystemMessage(content=system_text),
            HumanMessage(content=user_text),
        ]
    )
    if isinstance(result, dict):
        response = result.get("parsed")
        _emit_summarizer_usage(result.get("raw"), llm_client, room_id)
        if response is None:
            raise ValueError(
                f"summarizer structured-output parse failed: "
                f"{result.get('parsing_error')}"
            )
    else:
        # Defensive: some providers/wrappers may ignore include_raw.
        response = result
    rendered = render_structured_summary(response)
    if not rendered:
        return previous_summary, None
    return rendered, response.model_dump()


def schedule_compaction(
    store: RollingSummaryStore,
    *,
    previous_summary: Optional[str],
    delta: List[BaseMessage],
    boundary: int,
    total_count: int,
    llm_client: BaseLLMClient,
    prompt_data=None,
    timeout: float,
    reason: str = "cadence",
    room_id: Optional[str] = None,
) -> bool:
    """Fire the summarizer as a DETACHED task writing into ``store``.

    Shared by the per-turn compact_history node (reason="cadence", the
    primary mechanism) and the opportunistic pause hook (reason="pause").
    Returns False without scheduling when a compaction is already in flight.
    On any failure the previous summary is kept — compaction simply retries
    on a later trigger.
    """
    if store.in_flight:
        logger.debug("[ROLLING_SUMMARY] compaction already in flight; skipping")
        return False

    already_covered = max(0, store.covered_count)

    async def _compact_in_background() -> None:
        from datetime import datetime, timezone

        _start = datetime.now(timezone.utc)
        try:
            summary, structured = await asyncio.wait_for(
                update_rolling_summary(
                    previous_summary=previous_summary,
                    new_messages=delta,
                    llm_client=llm_client,
                    prompt_data=prompt_data,
                    room_id=room_id,
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "[ROLLING_SUMMARY] compaction timed out after %ss; keeping "
                "previous summary (covers %d/%d messages)",
                timeout,
                already_covered,
                total_count,
            )
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "[ROLLING_SUMMARY] compaction failed; keeping previous summary"
            )
            return
        if not summary:
            return
        store.summary = summary
        if structured is not None:
            store.structured = structured
        store.covered_count = boundary
        store.total_count = total_count
        _ms = int((datetime.now(timezone.utc) - _start).total_seconds() * 1000)
        logger.info(
            "[ROLLING_SUMMARY] compacted messages %d..%d (total %d); "
            "summary_chars=%d duration_ms=%d reason=%s (off-turn)",
            already_covered,
            boundary,
            total_count,
            len(summary),
            _ms,
            reason,
        )

    store._task = asyncio.create_task(_compact_in_background())
    return True


def maybe_compact_on_pause(
    thread_id: str,
    store: Optional[RollingSummaryStore],
    llm_client: Optional[BaseLLMClient],
    prompt_data=None,
) -> bool:
    """Opportunistic compaction when the learner pauses — free time, nobody
    is waiting on a reply, so no cadence gate: anything beyond the tail is
    folded. Purely ADDITIVE to the per-turn cadence compaction (the primary
    mechanism, which never depends on the learner pausing). Best-effort: any
    failure just means the cadence path catches up on the next turn.
    """
    from app.core.config import settings

    if not (
        settings.ROLLING_SUMMARY_ENABLED and settings.ROLLING_SUMMARY_COMPACT_ON_PAUSE
    ):
        return False
    if store is None or llm_client is None or store.in_flight:
        return False

    try:
        from app.core.graph import agent_graph

        state = agent_graph.get_state({"configurable": {"thread_id": thread_id}})
        values = state.values if state and state.values else {}
        messages = values.get("messages") or []
    except Exception:
        logger.debug("[ROLLING_SUMMARY] pause compaction: graph state unreadable")
        return False

    boundary = summary_boundary_index(
        messages,
        settings.ROLLING_SUMMARY_TAIL_DIALOGUES,
        settings.ROLLING_SUMMARY_TAIL_MAX_CHARS,
    )
    covered = max(0, store.covered_count)
    if boundary <= covered:
        return False
    delta = messages[covered:boundary]
    if count_learner_turns(delta) < 1:
        return False
    scheduled = schedule_compaction(
        store,
        previous_summary=store.summary,
        delta=delta,
        boundary=boundary,
        total_count=len(messages),
        llm_client=llm_client,
        prompt_data=prompt_data,
        timeout=settings.ROLLING_SUMMARY_TIMEOUT,
        reason="pause",
        room_id=thread_id,
    )
    if scheduled:
        logger.info(
            "[ROLLING_SUMMARY] pause compaction scheduled (%d..%d of %d messages)",
            covered,
            boundary,
            len(messages),
        )
    return scheduled
