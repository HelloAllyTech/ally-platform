"""The memory block for prompts that use ``{memories}`` (Stage Director prompts).

Memories replace Knowledge Sources and their retrieval for these prompts. There
is no picking: every memory the session has unlocked is in the prompt on every
turn, so nothing arrives a turn or two late and a core fact can never be
missing on the turn a learner asks about it. A memory assigned to states stays
out until the session first reaches one of them (sticky); only its TITLE is
shown before then, with a rule to deflect rather than invent.

The fixed sentences live here rather than in the prompt body because they are
the contract that makes hard gating safe: a prompt edit that dropped the
"never make something up" line would bring back the invented-answer bug.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.graph.knowledge_locks import (
    KnowledgeUnlockTracker,
    locked_topics,
    partition_sources,
)

AVAILABLE_HEADING = (
    "Things from your own life. Answer from these when asked. "
    "Don't bring them up just to fill a reply."
)
NO_MEMORIES = "Nothing beyond your role and backstory."


def _locked_rule(titles: Sequence[str]) -> str:
    return (
        "Things you aren't ready to talk about yet: "
        + "; ".join(titles)
        + ". If they ask, deflect, say you'd rather not get into it, or give as "
        "little as possible. Never make something up about it."
    )


def session_memories(prompt_data: Any) -> List[Dict[str, Any]]:
    """The memories this session runs on.

    ``memories`` when the scenario has them. Otherwise its Knowledge Sources,
    as they are (locks included): a scenario switched to a Stage Director prompt
    before its memories were mapped keeps every fact it had, rather than
    starting with none.
    """
    memories = getattr(prompt_data, "memories", None)
    if isinstance(memories, list) and memories:
        return [m for m in memories if isinstance(m, dict)]
    sources = getattr(prompt_data, "knowledge_sources", None)
    if isinstance(sources, list):
        return [s for s in sources if isinstance(s, dict)]
    return []


def memory_state_ids(memory: Dict[str, Any]) -> Optional[List[str]]:
    """The states an author picked for a memory, or None if they picked none
    this way. An empty list means available from the start."""
    ids = memory.get("unlocksInStateIds")
    if not isinstance(ids, list):
        return None
    return [str(i).strip() for i in ids if str(i or "").strip()]


def partition_for_turn(
    prompt_data: Any,
    active_state: Any,
    tracker: Optional[KnowledgeUnlockTracker],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(unlocked, locked) memories for this turn, observing the state.

    A memory with ``unlocksInStateIds`` unlocks once the session has been in
    ANY of those states (the author picks each one; nothing is implied about
    the states above or below). A memory with only the older single
    ``unlocksFromStateId`` keeps that field's meaning: that state or any above
    it. Both are sticky: the client may already have shared it, so it never
    goes back to being something they aren't ready to talk about.
    """
    states = getattr(prompt_data, "states", None)
    tracker = tracker or KnowledgeUnlockTracker()
    tracker.observe(states, active_state)
    unlocked: List[Dict[str, Any]] = []
    locked: List[Dict[str, Any]] = []
    legacy: List[Dict[str, Any]] = []
    memories = session_memories(prompt_data)
    for memory in memories:
        ids = memory_state_ids(memory)
        if ids is None:
            legacy.append(memory)
        elif not ids or tracker.visited.intersection(ids):
            unlocked.append(memory)
        else:
            locked.append(memory)
    if legacy:
        old_unlocked, old_locked = partition_sources(
            legacy, states, tracker.highest_rung
        )
        unlocked += old_unlocked
        locked += old_locked
    # Keep the author's order across both kinds.
    order = {id(m): i for i, m in enumerate(memories)}
    unlocked.sort(key=lambda m: order.get(id(m), 0))
    locked.sort(key=lambda m: order.get(id(m), 0))
    return unlocked, locked


def render_memory_block(
    unlocked: Sequence[Dict[str, Any]], locked: Sequence[Dict[str, Any]]
) -> str:
    """The text that fills ``{memories}``."""
    lines: List[str] = []
    for memory in unlocked:
        title = str(memory.get("title") or "").strip()
        content = str(memory.get("content") or "").strip()
        if title and content:
            lines.append(f"- {title}: {content}")
        elif content or title:
            lines.append(f"- {content or title}")
    parts = [AVAILABLE_HEADING, "\n".join(lines) if lines else NO_MEMORIES]
    titles = locked_topics(locked)
    if titles:
        parts.append(_locked_rule(titles))
    return "\n".join(parts)
