"""Worker-owned store for the client's working memory.

Salvaged from ``app/roleplay_v2/spec/runtime_state.py`` (design §9.1) and
generalised: v2's store was constructed from a ``ScenarioSpec`` and seeded its
ledger from authored secrets. This one derives its ledgers from the
conversation, so it needs no spec at all — the salvage makes it smaller.

The three guarantees are ported unchanged, because they are the reason the
design chose a store over graph state in the first place:

- all mutation serialises under an ``asyncio.Lock``;
- readers get DEEP-COPIED snapshots, so a reader mid-prompt-assembly can never
  observe a torn write from the off-path updater;
- commits are MONOTONIC on turn index. A late or duplicate update for a turn at
  or before the last committed one is rejected outright, so a slow updater can
  only ever MISS a turn, never rewind the session.

That last guarantee is what replaces the SHA-256 ``revision`` field the design
originally borrowed from QM's ``replaceIfRevision``. Content hashing is the right
tool when writes have no natural order; these writes do — the turn index IS the
order — so hashing would buy nothing and cost a comparison over a whole record.

Worker-owned like ``RollingSummaryStore``: held by the AgentWorker and passed to
graph nodes through the run config, never in ``SimulationState``. The graph is
compiled once at import and shared by every concurrent session in the process,
so the per-session config is the only place per-session identity exists.
"""

from __future__ import annotations

import asyncio
import copy
from typing import Iterable, List, Optional

from app.core.logger import get_logger
from app.core.working_memory.state import (
    ClientWorkingMemory,
    Fact,
    Stance,
    Thread,
    WithheldTopic,
)

logger = get_logger(__name__)


class ClientWorkingMemoryStore:
    """Lock-guarded owner of one session's working memory, monotonic commits."""

    def __init__(self, initial_stance: Stance = "guarded") -> None:
        self._lock = asyncio.Lock()
        self._state = ClientWorkingMemory(stance=initial_stance)
        self._last_committed_turn = -1
        #: Set when an update is in flight, so a second one is not started for
        #: the same turn. Mirrors RollingSummaryStore.in_flight.
        self._task: Optional[asyncio.Task] = None

    @property
    def in_flight(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def last_committed_turn(self) -> int:
        return self._last_committed_turn

    async def snapshot(self) -> ClientWorkingMemory:
        """Deep-copied point-in-time view, safe to read without the lock."""
        async with self._lock:
            return copy.deepcopy(self._state)

    async def begin_turn(self) -> ClientWorkingMemory:
        """Advance the turn counter, then return a snapshot.

        Called once per learner turn BEFORE the reply is generated, so the
        prompt that reads the memory and the update that later writes it agree
        on which turn they are talking about. Without that agreement the
        monotonic check has nothing meaningful to compare.
        """
        async with self._lock:
            self._state.turn_index += 1
            self._state.turns_in_stance += 1
            return copy.deepcopy(self._state)

    async def commit(
        self,
        update_turn_index: int,
        *,
        stance: Optional[Stance] = None,
        affect: Optional[str] = None,
        appraisal: Optional[str] = None,
        register: Optional[str] = None,
        speech_fragments: Optional[Iterable[str]] = None,
        disclosed: Optional[Iterable[Fact]] = None,
        opened_threads: Optional[Iterable[Thread]] = None,
        closed_topics: Iterable[str] = (),
        withheld: Optional[Iterable[WithheldTopic]] = None,
        revealed_topics: Iterable[str] = (),
        salient_backstory: Optional[Iterable[Fact]] = None,
        retrieve_cues: Optional[Iterable[str]] = None,
    ) -> bool:
        """Apply an already-validated update. False when rejected as stale.

        Every argument is Optional and None means "not part of this update" —
        the two update paths write different field sets at different cadences
        (state on a client-side event, recall on the retrieval cadence), and
        neither may blank what the other owns.

        The caller is responsible for having validated the update in code
        first. This method commits; it does not decide. That division is
        roleplay_v2's `_apply` discipline: the LLM proposes, code disposes, and
        a stance transition in particular must be EARNED rather than asserted.
        """
        async with self._lock:
            if update_turn_index <= self._last_committed_turn:
                logger.warning(
                    "[working-memory] rejecting stale commit for turn %d "
                    "(last committed %d)",
                    update_turn_index,
                    self._last_committed_turn,
                )
                return False
            self._last_committed_turn = update_turn_index

            st = self._state
            st.updated_by_turn = update_turn_index

            if stance is not None and stance != st.stance:
                st.stance = stance
                st.turns_in_stance = 0
                st.stance_path.append(stance)

            if affect is not None:
                st.affect = affect
            if appraisal is not None:
                st.appraisal = appraisal
            if register is not None:
                st.register = register
            if speech_fragments is not None:
                st.speech_fragments = list(speech_fragments)

            if disclosed is not None:
                st.disclosed = _fold_facts(st.disclosed, disclosed)

            if opened_threads is not None:
                known = {t.topic for t in st.unresolved}
                st.unresolved.extend(t for t in opened_threads if t.topic not in known)
            for topic in closed_topics:
                for thread in st.unresolved:
                    if thread.topic == topic and thread.is_open:
                        thread.closed_turn = update_turn_index

            if withheld is not None:
                known_topics = {w.topic for w in st.withheld}
                st.withheld.extend(w for w in withheld if w.topic not in known_topics)
            for topic in revealed_topics:
                for item in st.withheld:
                    if item.topic == topic and item.status == "unlocked":
                        item.status = "revealed"

            if salient_backstory is not None:
                st.salient_backstory = list(salient_backstory)
            if retrieve_cues is not None:
                st.retrieve_cues = list(retrieve_cues)

            st.updates_committed += 1
            return True

    def discard(self) -> None:
        """Cancel any in-flight update. Called on session shutdown.

        The record itself needs no teardown — it is an instance attribute of the
        worker, like RollingSummaryStore, and dies with the session rather than
        living in a module-level dict keyed by room. What does need cancelling is
        a detached update still running when the session ends: it would write
        into a store nobody will read and hold a reference to the LLM client past
        teardown.

        Synchronous on purpose, so it can be called from the shutdown path
        alongside the other cleanups without awaiting anything.
        """
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None

    async def mark_miss(self) -> None:
        """Count an update that timed out or failed.

        Deliberately does NOT advance the monotonic counter: a missed turn must
        leave the next update free to commit, and a miss is not a write.
        """
        async with self._lock:
            self._state.updates_missed += 1


def _fold_facts(existing: List[Fact], incoming: Iterable[Fact]) -> List[Fact]:
    """Merge facts by text, rewriting in place rather than appending.

    Reconsolidation, and QM's `foldCapture` contract: a retrieved memory is
    re-stored, possibly altered, so a fact revisited must be REWRITTEN and not
    duplicated beside its earlier form. A `disclosed` list that only appends
    ends up holding three versions of the same fact and no way to choose.
    """
    by_text = {f.text: f for f in existing}
    for fact in incoming:
        prior = by_text.get(fact.text)
        if prior is None:
            by_text[fact.text] = fact
            continue
        # Strengthen rather than replace: the earlier encoding happened.
        prior.encoding_strength = max(prior.encoding_strength, fact.encoding_strength)
        prior.last_recalled_turn = fact.last_recalled_turn or prior.last_recalled_turn
        for stance in fact.stances_seen:
            if stance not in prior.stances_seen:
                prior.stances_seen.append(stance)
    return list(by_text.values())
