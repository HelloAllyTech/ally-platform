"""Trainer-authored memory locks: which Knowledge Sources the client can draw on.

A scenario's Knowledge Sources are the client's memories. A trainer can set
``unlocksFromStateId`` on one, naming the scenario state from which the client
may talk about it. Until the session reaches that state the memory is LOCKED:
its content never reaches the actor — not through retrieval, not through the
prompt — and only its title may be shown, as a topic the client is not ready to
discuss. Unset means always available, which is how every source behaved before
this existed.

**The states are the only controller.** Unlocking is a lookup against the state
the score resolves to, never an LLM judgement. Working memory already paid for a
second controller once (design doc §0.1); this adds none.

**Unlocks are sticky for the session (a high-water mark).** Once the session has
reached a state, every memory unlocked by it stays unlocked even if the score
later falls back. The client may already have said it, the conversation history
carries what they said, and a prompt that then told them "you have not shared
this" would contradict their own words. A high-water mark needs no detection of
whether it was actually said, so it cannot miss a paraphrase. It also makes the
unlocked set monotonic, which is what lets retrieval's reused context stay
correct between refreshes: a set that only grows can never leave locked content
in a cached string.

**Fail closed.** A lock naming a state that does not exist, or a lock on a
scenario with no states, keeps the memory locked and logs it. ally-be rejects
both on save, so reaching here means stale data, and a leaked secret is worse
than an unused one.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.logger import get_logger

logger = get_logger(__name__)

UNLOCK_FIELD = "unlocksFromStateId"


def _ladder(states: Optional[Sequence[Dict[str, Any]]]) -> List[str]:
    """State ids in ladder order — ascending ``scoreLower``, as the resolver
    reads them. ally-be pre-sorts; re-sorting keeps direct callers honest."""
    if not states:
        return []
    ordered = sorted(
        (s for s in states if isinstance(s, dict) and s.get("id")),
        key=lambda s: (
            s.get("scoreLower") if s.get("scoreLower") is not None else float("-inf")
        ),
    )
    return [str(s["id"]) for s in ordered]


def _lock_state_id(source: Dict[str, Any]) -> Optional[str]:
    value = source.get(UNLOCK_FIELD)
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def has_locks(knowledge_sources: Optional[Sequence[Any]]) -> bool:
    return any(
        isinstance(s, dict) and _lock_state_id(s) for s in (knowledge_sources or [])
    )


class KnowledgeUnlockTracker:
    """Per-session high-water mark over the scenario's state ladder.

    Worker-owned and off-checkpoint for the same reason as
    ``RetrievedContextStore``'s countdown: a barge-in can discard a checkpoint,
    and an unlock the client may already have acted on must not be undone.
    """

    def __init__(self) -> None:
        self.highest_rung = -1

    def observe(
        self, states: Optional[Sequence[Dict[str, Any]]], active_state: Any
    ) -> bool:
        """Record the state this turn resolved to. Returns True when the
        high-water mark rose (so newly unlocked memories exist)."""
        if not isinstance(active_state, dict) or not active_state.get("id"):
            return False
        ladder = _ladder(states)
        try:
            rung = ladder.index(str(active_state["id"]))
        except ValueError:
            return False
        if rung > self.highest_rung:
            self.highest_rung = rung
            return True
        return False


def partition_sources(
    knowledge_sources: Optional[Sequence[Any]],
    states: Optional[Sequence[Dict[str, Any]]],
    highest_rung: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Split sources into (unlocked, locked) for a session at ``highest_rung``.

    ``highest_rung`` is an index into the ladder (-1 = no state reached yet,
    which keeps every locked source locked).
    """
    unlocked: List[Dict[str, Any]] = []
    locked: List[Dict[str, Any]] = []
    ladder = _ladder(states)
    for source in knowledge_sources or []:
        if not isinstance(source, dict):
            continue
        lock_id = _lock_state_id(source)
        if lock_id is None:
            unlocked.append(source)
            continue
        if lock_id not in ladder:
            logger.warning(
                "[MEMORY_LOCK] source %r names unknown state %r; keeping it locked",
                source.get("title"),
                lock_id,
            )
            locked.append(source)
            continue
        if ladder.index(lock_id) <= highest_rung:
            unlocked.append(source)
        else:
            locked.append(source)
    return unlocked, locked


def locked_topics(locked: Sequence[Dict[str, Any]]) -> List[str]:
    """Titles of locked sources — the only part of a locked memory the actor
    may see. Content is never read here."""
    topics: List[str] = []
    for source in locked:
        title = str(source.get("title") or "").strip()
        if title:
            topics.append(title)
    return topics


def resolve_for_turn(
    knowledge_sources: Optional[Sequence[Any]],
    states: Optional[Sequence[Dict[str, Any]]],
    active_state: Any,
    tracker: Optional[KnowledgeUnlockTracker],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], bool]:
    """Observe this turn's state and partition the sources.

    Returns (unlocked, locked, newly_unlocked). Without a tracker (report
    graph, tests) the partition uses this turn's state alone.
    """
    if tracker is not None:
        rose = tracker.observe(states, active_state)
        rung = tracker.highest_rung
    else:
        rose = False
        rung = -1
        if isinstance(active_state, dict) and active_state.get("id"):
            ladder = _ladder(states)
            if str(active_state["id"]) in ladder:
                rung = ladder.index(str(active_state["id"]))
    unlocked, locked = partition_sources(knowledge_sources, states, rung)
    newly_unlocked = False
    if rose and has_locks(knowledge_sources):
        newly_unlocked = True
        logger.info(
            "[MEMORY_LOCK] reached rung %d; unlocked=%d locked=%d",
            rung,
            len(unlocked),
            len(locked),
        )
    return unlocked, locked, newly_unlocked
