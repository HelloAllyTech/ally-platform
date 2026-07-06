"""Mutable per-session runtime state for roleplay v2.

The Actor reads (snapshots of) this state every turn to compile its turn card;
the Director writes to it asynchronously when a verdict lands. Because the
Director runs off the voice critical path, verdicts can arrive late or out of
order — the store therefore:

- serializes all mutation under an ``asyncio.Lock``;
- hands out deep-copied snapshots so readers never see a torn write;
- enforces MONOTONIC commits: a verdict for a turn older than (or equal to)
  the last committed turn is rejected outright — a slow Director can only
  ever *miss* a turn, never rewind the session.
"""

from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from app.core.logger import get_logger
from app.roleplay_v2.spec.models import ScenarioSpec

logger = get_logger(__name__)

# Disclosure-ledger item statuses.
LEDGER_LOCKED = "locked"
LEDGER_UNLOCKED = "unlocked"
LEDGER_REVEALED = "revealed"


@dataclass
class RuntimeSessionState:
    """Snapshot-able runtime state of one roleplay session."""

    current_state_id: str
    turn_index: int = 0
    turns_in_state: int = 0
    # Latest stage direction (from a Director verdict or an engineered event)
    # and the turn it was issued for — the Actor uses the delta between this
    # and the current turn as the direction_staleness_turns metric.
    stage_direction: Optional[str] = None
    stage_direction_turn: Optional[int] = None
    # secret_id -> 'locked' | 'unlocked' | 'revealed'
    ledger: Dict[str, str] = field(default_factory=dict)
    # behavior_id -> observation count across the session
    behavior_hits: Dict[str, int] = field(default_factory=dict)
    cumulative_score: float = 0.0
    fired_events: List[str] = field(default_factory=list)
    # Persona-bible topics the Director nominated for next-turn retrieval.
    retrieve_topics: List[str] = field(default_factory=list)
    # Director health counters.
    director_commits: int = 0
    director_misses: int = 0
    # Ordered list of visited states (starts with the initial state).
    state_path: List[str] = field(default_factory=list)

    @property
    def direction_staleness_turns(self) -> Optional[int]:
        """Turns elapsed since the active stage direction was issued."""
        if self.stage_direction is None or self.stage_direction_turn is None:
            return None
        return max(0, self.turn_index - self.stage_direction_turn)


class RuntimeStateStore:
    """Lock-guarded owner of RuntimeSessionState with monotonic commits."""

    def __init__(self, spec: ScenarioSpec):
        self._spec = spec
        self._lock = asyncio.Lock()
        initial_id = spec.state_machine.initial_state_id
        self._state = RuntimeSessionState(
            current_state_id=initial_id,
            ledger={s.id: LEDGER_LOCKED for s in spec.disclosure_ledger.secrets},
            behavior_hits={b.id: 0 for b in spec.rubric.behaviors},
            state_path=[initial_id],
        )
        # Highest turn_index a Director verdict has been committed for.
        self._last_committed_turn = -1

    @property
    def spec(self) -> ScenarioSpec:
        return self._spec

    @property
    def last_committed_turn(self) -> int:
        return self._last_committed_turn

    async def snapshot(self) -> RuntimeSessionState:
        """Deep-copied point-in-time view (safe to read without the lock)."""
        async with self._lock:
            return copy.deepcopy(self._state)

    async def begin_turn(self) -> RuntimeSessionState:
        """Advance the turn counter for a new trainee turn; returns a snapshot.

        Called exactly once per trainee turn, BEFORE the Actor generates, so
        the turn card and the Director verdict agree on the turn index.
        """
        async with self._lock:
            self._state.turn_index += 1
            self._state.turns_in_state += 1
            return copy.deepcopy(self._state)

    async def commit(
        self,
        verdict_turn_index: int,
        *,
        next_state_id: Optional[str] = None,
        unlock_ids: Iterable[str] = (),
        observed_behavior_ids: Iterable[str] = (),
        score_delta: float = 0.0,
        stage_direction: Optional[str] = None,
        retrieve_topics: Optional[Iterable[str]] = None,
        fired_event_ids: Iterable[str] = (),
    ) -> bool:
        """Apply a validated Director verdict. Returns False when stale.

        MONOTONIC: rejects any commit whose ``verdict_turn_index`` is not
        strictly newer than the last committed turn — a late verdict for an
        already-superseded turn (or a duplicate for the same turn) must never
        rewind or double-apply state.
        """
        async with self._lock:
            if verdict_turn_index <= self._last_committed_turn:
                logger.warning(
                    "[roleplay_v2] Rejecting stale director commit for turn %d "
                    "(last committed turn %d)",
                    verdict_turn_index,
                    self._last_committed_turn,
                )
                return False
            self._last_committed_turn = verdict_turn_index

            st = self._state
            for behavior_id in observed_behavior_ids:
                if behavior_id in st.behavior_hits:
                    st.behavior_hits[behavior_id] += 1
            st.cumulative_score += score_delta

            if next_state_id and next_state_id != st.current_state_id:
                st.current_state_id = next_state_id
                st.turns_in_state = 0
                st.state_path.append(next_state_id)

            for secret_id in unlock_ids:
                if st.ledger.get(secret_id) == LEDGER_LOCKED:
                    st.ledger[secret_id] = LEDGER_UNLOCKED

            if stage_direction:
                st.stage_direction = stage_direction
                st.stage_direction_turn = verdict_turn_index

            if retrieve_topics is not None:
                st.retrieve_topics = list(retrieve_topics)

            for event_id in fired_event_ids:
                if event_id not in st.fired_events:
                    st.fired_events.append(event_id)

            st.director_commits += 1
            return True

    async def apply_stage_direction(
        self, direction: str, *, event_id: Optional[str] = None
    ) -> RuntimeSessionState:
        """Inject a stage direction outside the verdict path (time events).

        Deliberately does NOT touch the monotonic commit counter: a
        time-triggered engineered event firing mid-turn must not block the
        pending Director verdict for the same turn.
        """
        async with self._lock:
            st = self._state
            st.stage_direction = direction
            st.stage_direction_turn = st.turn_index
            if event_id and event_id not in st.fired_events:
                st.fired_events.append(event_id)
            return copy.deepcopy(st)

    async def mark_revealed(self, secret_id: str) -> None:
        """Record that an unlocked secret's content actually left the actor."""
        async with self._lock:
            if self._state.ledger.get(secret_id) == LEDGER_UNLOCKED:
                self._state.ledger[secret_id] = LEDGER_REVEALED

    async def mark_miss(self) -> None:
        """Count a Director timeout/failure (the turn goes undirected)."""
        async with self._lock:
            self._state.director_misses += 1
