"""The Stage Director: one paragraph of the client's thoughts, written after each reply.

Replaces the client working memory's updater for prompts that use
``{thoughts}``. Where the updater returned structured fields that code
validated, merged into ledgers and rendered into seven sections, the director
returns plain text and code passes it to the main prompt as written. Nothing
between the two edits, filters or rejects it: the way to improve the output is
the director's prompt (``ally_ai_learn_system_stage_director``), judged by the
scores, not code.

Timing is the updater's: detached, after the reply has streamed, with the same
budget, and the previous thought kept on a miss. So the thought a reply reads
was written before the learner's newest words. The main prompt says the
learner's latest words win, and each thought is stamped with how many turns old
it is so that lag can be measured.

Two numbers are logged, never acted on: whether a thought copies five or more
words from the client's own replies, and whether it nearly repeats the previous
thought. They feed the scores the prompt is iterated against.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.core.logger import get_logger

logger = get_logger(__name__)

TEMPLATE_PATH = "system/stage_director"

#: Shown to the main prompt before the first thought exists.
NO_THOUGHT_YET = "Nothing yet: the conversation has only just started."
#: Shown to the director before it has written anything.
NO_PREVIOUS_THOUGHT = "(none yet)"
NO_TURNS = "(no turns yet)"
NO_SUMMARY = "(nothing older than the turns below)"
NO_BEHAVIOURS = "(none noticed)"

_COPY_RUN = 5
_NEAR_REPEAT = 0.8


class StageDirectorStore:
    """One session's latest thought. Worker-owned, like the other stores."""

    def __init__(self) -> None:
        self.thought: str = ""
        #: Learner turn the current thought was written after; -1 = none yet.
        self.written_after_turn: int = -1
        #: Learner turns opened so far (0-based index of the latest).
        self.turn_index: int = -1
        self.thoughts_written = 0
        self.thoughts_missed = 0
        #: The main prompt's variables from the latest turn, so the director can
        #: be offered every variable the main prompt has.
        self.prompt_kwargs: Dict[str, Any] = {}
        self._task: Optional[asyncio.Task] = None

    @property
    def in_flight(self) -> bool:
        return self._task is not None and not self._task.done()

    def begin_turn(self) -> int:
        self.turn_index += 1
        return self.turn_index

    def turns_old(self) -> Optional[int]:
        """How many learner turns ago the current thought was written."""
        if self.written_after_turn < 0:
            return None
        return max(0, self.turn_index - self.written_after_turn)

    def thought_for_prompt(self) -> str:
        return self.thought.strip() or NO_THOUGHT_YET

    def discard(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None


def format_turns(messages: List[BaseMessage]) -> str:
    lines = []
    for msg in messages:
        if isinstance(msg, HumanMessage):
            label = "COUNSELLOR"
        elif isinstance(msg, AIMessage):
            label = "CLIENT"
        else:
            continue
        text = str(getattr(msg, "content", "") or "").strip()
        if text:
            lines.append(f"{label}: {text}")
    return "\n".join(lines)


def _words(text: str) -> List[str]:
    return [w for w in "".join(c.lower() if c.isalnum() else " " for c in text).split()]


def copies_client_words(thought: str, messages: List[BaseMessage]) -> bool:
    """True when the thought shares a run of five or more words with a reply."""
    words = _words(thought)
    if len(words) < _COPY_RUN:
        return False
    runs = {tuple(words[i : i + _COPY_RUN]) for i in range(len(words) - _COPY_RUN + 1)}
    for msg in messages:
        if not isinstance(msg, AIMessage):
            continue
        reply = _words(str(getattr(msg, "content", "") or ""))
        for i in range(len(reply) - _COPY_RUN + 1):
            if tuple(reply[i : i + _COPY_RUN]) in runs:
                return True
    return False


def near_repeat(thought: str, previous: str) -> bool:
    """True when most of the thought's words were in the previous one."""
    a, b = set(_words(thought)), set(_words(previous))
    if not a or not b:
        return False
    return len(a & b) / max(len(a), len(b)) >= _NEAR_REPEAT


def _state_ladder(prompt_data: Any) -> str:
    rows = []
    for i, st in enumerate(getattr(prompt_data, "states", None) or []):
        if not isinstance(st, dict):
            continue
        name = str(st.get("name") or "").strip()
        if not name:
            continue
        guidance = str(st.get("guidelines") or "").strip()
        rows.append(f"  {i + 1}. {name}" + (f": {guidance}" if guidance else ""))
    return "\n".join(rows) or "(this scenario has no stages)"


def _emit_usage(raw: Any, llm_client: Any, room_id: Optional[str]) -> None:
    """Best-effort usage emission. Never raises."""
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
            task=LLMTask.STAGE_DIRECTOR.value,
            usage=usage,
        )
    except Exception:  # noqa: BLE001 - usage must never break the director
        logger.debug("[stage-director] usage emission failed", exc_info=True)


async def write_thought(
    *,
    store: StageDirectorStore,
    prompt_data: Any,
    messages: List[BaseMessage],
    llm_client: Any,
    current_state: Optional[str],
    rolling_summary: Optional[str],
    learner_behaviours: List[str],
    room_id: Optional[str] = None,
) -> str:
    """One call to the director. Returns the paragraph, stripped."""
    from app.prompts.resolver import load_and_format

    language_label = (
        getattr(prompt_data, "language_label", None) or ""
    ).strip() or "the language of the conversation"
    # Every variable the main prompt had this turn, then the director's own.
    kwargs: Dict[str, Any] = dict(store.prompt_kwargs)
    kwargs.update(
        language_label=kwargs.get("language_label") or language_label,
        recent_turns=format_turns(messages) or NO_TURNS,
        previous_thought=store.thought.strip() or NO_PREVIOUS_THOUGHT,
        state_ladder=_state_ladder(prompt_data),
        current_state=current_state or "(no stage resolved)",
        rolling_summary=(rolling_summary or "").strip() or NO_SUMMARY,
        learner_behaviours=", ".join(learner_behaviours) or NO_BEHAVIOURS,
    )
    kwargs.pop("thoughts", None)
    system_text = load_and_format(TEMPLATE_PATH, prompt_data, **kwargs)
    if not system_text:
        raise ValueError("stage director template resolved empty")
    raw = await llm_client.llm_instance.ainvoke(
        [
            SystemMessage(content=system_text),
            HumanMessage(
                content=(
                    "Write the client's thoughts now, in "
                    f"{kwargs['language_label']}."
                )
            ),
        ]
    )
    _emit_usage(raw, llm_client, room_id)
    text = raw.content if isinstance(raw.content, str) else str(raw.content or "")
    return " ".join(text.split()).strip().strip('"').strip()


def _payload(
    *,
    store: StageDirectorStore,
    turn_index: int,
    messages: List[BaseMessage],
    missed: bool,
    score: Optional[int],
    current_state: Optional[str],
    prompt_data: Any,
    behaviours: List[str],
) -> Dict[str, Any]:
    from app.core.working_memory.monologue import (
        MONOLOGUE_TYPE,
        _behaviour_labels,
        _last_exchange,
    )

    ladder = [
        str(st.get("name") or "").strip()
        for st in (getattr(prompt_data, "states", None) or [])
        if isinstance(st, dict) and str(st.get("name") or "").strip()
    ]
    return {
        "type": MONOLOGUE_TYPE,
        "mode": "stage_director",
        "turn": turn_index,
        **_last_exchange(messages),
        "thought": store.thought,
        "thoughtTurnsOld": 0 if not missed else store.turns_old(),
        "stanceTo": current_state,
        "arc": ladder,
        "score": score,
        "events": _behaviour_labels(prompt_data, behaviours),
        "missed": bool(missed),
        "updatesMissed": store.thoughts_missed,
    }


def schedule_thought(
    store: StageDirectorStore,
    *,
    prompt_data: Any,
    messages: List[BaseMessage],
    llm_client: Any,
    timeout: float,
    current_state: Optional[str] = None,
    rolling_summary: Optional[str] = None,
    learner_behaviours: Optional[List[str]] = None,
    behaviour_ids: Optional[List[str]] = None,
    score: Optional[int] = None,
    room: Any = None,
    record_store: Any = None,
) -> bool:
    """Write the next thought as a DETACHED task. False when one is in flight.

    ``record_store`` holds the session's monologue list (the working-memory
    store's), so each thought rides the existing end-of-session record and the
    admin session view without new wiring.
    """
    if store.in_flight:
        logger.debug("[stage-director] thought already in flight; skipping")
        return False

    turn_index = store.turn_index
    room_id = getattr(room, "name", None)

    async def _run() -> None:
        from app.core.working_memory import monologue

        previous = store.thought
        missed = False
        try:
            thought = await asyncio.wait_for(
                write_thought(
                    store=store,
                    prompt_data=prompt_data,
                    messages=messages,
                    llm_client=llm_client,
                    current_state=current_state,
                    rolling_summary=rolling_summary,
                    learner_behaviours=learner_behaviours or [],
                    room_id=room_id,
                ),
                timeout=timeout,
            )
            if not thought:
                raise ValueError("empty thought")
            store.thought = thought
            store.written_after_turn = turn_index
            store.thoughts_written += 1
            logger.info(
                "[stage-director] thought turn=%d chars=%d copies_client=%s "
                "near_repeat=%s",
                turn_index,
                len(thought),
                copies_client_words(thought, messages),
                near_repeat(thought, previous),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a miss keeps the last thought
            missed = True
            store.thoughts_missed += 1
            logger.warning(
                "[stage-director] thought for turn %d missed (%s); keeping the "
                "previous one",
                turn_index,
                type(exc).__name__ if isinstance(exc, asyncio.TimeoutError) else exc,
            )
        try:
            await monologue.publish_and_record(
                room,
                record_store,
                _payload(
                    store=store,
                    turn_index=turn_index,
                    messages=messages,
                    missed=missed,
                    score=score,
                    current_state=current_state,
                    prompt_data=prompt_data,
                    behaviours=behaviour_ids or [],
                ),
            )
        except Exception:  # noqa: BLE001 - observability must not break a turn
            logger.debug("[stage-director] monologue publish failed", exc_info=True)

    store._task = asyncio.create_task(_run())
    return True
