"""Worker-owned store for the client's working memory.

Salvaged from the since-removed ``app/roleplay_v2/spec/runtime_state.py``
(design §9.1) and
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
import re
from typing import Iterable, List, Optional, Sequence

from app.core.logger import get_logger
from app.core.working_memory.state import (
    STANCES,
    ClientWorkingMemory,
    Fact,
    Stance,
    Thread,
    WithheldTopic,
)
from app.core.working_memory.text import content_words

logger = get_logger(__name__)


class ClientWorkingMemoryStore:
    """Lock-guarded owner of one session's working memory, monotonic commits."""

    def __init__(
        self,
        initial_stance: Optional[Stance] = None,
        ladder: Optional[Sequence[str]] = None,
    ) -> None:
        # The ladder is the scenario's when it defines states, else the generic
        # five. The opening stance is its FIRST rung — not the literal
        # "guarded", which may not be on this ladder at all.
        _ladder: tuple = tuple(ladder) if ladder else tuple(STANCES)
        self._lock = asyncio.Lock()
        self._state = ClientWorkingMemory(
            stance=initial_stance or _ladder[0], ladder=_ladder
        )
        self._last_committed_turn = -1
        #: Set when an update is in flight, so a second one is not started for
        #: the same turn. Mirrors RollingSummaryStore.in_flight.
        self._task: Optional[asyncio.Task] = None
        #: Per-turn internal-monologue payloads, kept so an admin can revisit a
        #: finished session rather than only watching one live. Bounded: a long
        #: session would otherwise grow this without limit, and the recent turns
        #: are the ones anyone reads. Lives on the store, not on
        #: ClientWorkingMemory — the dataclass is the model's view of the
        #: client, and a UI transcript is not part of what the client has in
        #: mind.
        self.monologue: List[dict] = []
        #: The pool `salient_backstory` is recalled from (see corpus.py).
        #: Immutable for the session and held HERE rather than on the state
        #: record, which is deep-copied on every snapshot — copying an unchanging
        #: pool of up to 120 facts on every turn would be pure waste. Assigned
        #: once at session setup; None until then, and None for a scenario with
        #: no profile text, in which case recall simply has nothing to do.
        self.corpus = None

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
                # Near-duplicate, not exact: the run that produced three
                # phrasings of one disclosure also opened "brother's visits"
                # and "brother's support" as separate threads, so the actor was
                # told it was carrying two unfinished things when it had one.
                for thread in opened_threads:
                    if not any(same_fact(t.topic, thread.topic) for t in st.unresolved):
                        st.unresolved.append(thread)
            # Closing matches the SAME way opening does. It did not, and the
            # asymmetry was silently fatal: opening folded near-duplicates while
            # closing required an exact string, so a thread opened as
            # "brother's visits" could never be closed by "the brother's visits"
            # and stayed open for the rest of the session. Threads then only
            # ever accumulate, `reflecting` becomes permanently unreachable
            # through the Zeigarnik gate, and the actor is told it is still
            # carrying things it has finished.
            for topic in closed_topics:
                for thread in st.unresolved:
                    if thread.is_open and same_fact(thread.topic, topic):
                        thread.closed_turn = update_turn_index

            if withheld is not None:
                for item in withheld:
                    if not any(same_fact(w.topic, item.topic) for w in st.withheld):
                        st.withheld.append(item)
            for topic in revealed_topics:
                for item in st.withheld:
                    if item.status != "revealed" and same_fact(item.topic, topic):
                        item.status = "revealed"

            # A topic the client has now actually SAID is revealed, derived from
            # the disclosure ledger rather than asserted by the model. Nothing
            # passed `revealed_topics`, so this transition was unreachable too —
            # and it needs no new LLM field, because "the client said it" is
            # exactly what `disclosed` already records.
            for item in st.withheld:
                if item.status == "revealed":
                    continue
                if any(same_fact(f.text, item.topic) for f in st.disclosed):
                    item.status = "revealed"
                    logger.info(
                        "[working-memory] withheld topic revealed by " "disclosure: %s",
                        item.topic,
                    )

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

        Took a `score_delta` to roll back until the stance ladder was removed.
        Nothing reads the simulation score here any more — the stance mirrors
        the author's resolved state, so a missed update costs the ledger a turn
        and costs progression nothing.
        """
        async with self._lock:
            self._state.updates_missed += 1


_WORD_RE = re.compile(r"[\w']+", re.UNICODE)

#: Content words below this length carry too little meaning to count as
#: evidence that two facts are the same one.
_MIN_WORD_LEN = 4

#: Jaccard overlap at which two phrasings are treated as the same fact.
#:
#: Jaccard rather than containment, deliberately: containment would fold
#: "feeling overwhelmed lately" into "feeling overwhelmed managing her mother's
#: appointments", because the short one's words all appear in the long one — and
#: those are two different disclosures, one general and one specific. Jaccard
#: penalises the length mismatch and keeps them apart.
#:
#: 0.45, measured rather than guessed. Over a set built from the first offline
#: run's actual output plus adversarial pairs from the same session's material,
#: the phrasings that should fold scored 0.500-1.000 (the three variants of one
#: disclosure at 0.714 and 0.583; "lost the job in March" against "she lost the
#: job back in March, it was hard" at 0.500) and the pairs that must stay apart
#: scored at most 0.154 once the shared-word floor below rejects the one case
#: that reached 0.333 on a single word. 0.45 sits in that gap and errs toward
#: NOT merging, which is the safer error: two entries for one fact is untidy,
#: while merging two real disclosures silently loses one.
_SAME_FACT_JACCARD = 0.45

#: Two shared content words minimum, so a pair of short unrelated facts cannot
#: merge on one incidental token.
_SAME_FACT_MIN_SHARED = 2


def _rung(stance: str, ladder: Sequence[str] = STANCES) -> int:
    """Position on THIS session's ladder; -1 for anything not on it."""
    try:
        return list(ladder).index(stance)
    except ValueError:
        return -1


def same_fact(a: str, b: str) -> bool:
    """Are these two phrasings of the same fact?

    Lexical on purpose. An embedding call per pair would be a network round
    trip inside a lock, and the failure being prevented — an LLM restating what
    it already stored in slightly different words — is overwhelmingly lexical.
    """
    if a == b:
        return True
    wa, wb = content_words(a), content_words(b)
    if not wa or not wb:
        return False
    shared = wa & wb
    if len(shared) < _SAME_FACT_MIN_SHARED:
        return False
    return len(shared) / len(wa | wb) >= _SAME_FACT_JACCARD


def _fold_facts(existing: List[Fact], incoming: Iterable[Fact]) -> List[Fact]:
    """Merge facts by MEANING, rewriting in place rather than appending.

    Reconsolidation, and QM's `foldCapture` contract: a retrieved memory is
    re-stored, possibly altered, so a fact revisited must be REWRITTEN and not
    duplicated beside its earlier form. A `disclosed` list that only appends
    ends up holding three versions of the same fact and no way to choose.

    That docstring described exactly what then happened. Matching on exact text
    is effectively append-only against a model that paraphrases: the first
    offline run ended a five-turn session with three phrasings of one
    disclosure in the ledger, which the actor is then told not to re-introduce
    three separate times. Hence `same_fact`.

    The EARLIER wording wins on a merge. Two reasons, and the second is the
    stronger: the first phrasing is closest to what the client actually said,
    and keeping it makes the rendered ledger byte-stable across turns — this
    block sits in the prompt, so a ledger that re-words itself every turn would
    cost prompt-cache hits on every remaining turn of the session.
    """
    folded: List[Fact] = list(existing)
    for fact in incoming:
        prior = next((f for f in folded if same_fact(f.text, fact.text)), None)
        if prior is None:
            folded.append(fact)
            continue
        # Strengthen rather than replace: the earlier encoding happened.
        prior.encoding_strength = max(prior.encoding_strength, fact.encoding_strength)
        prior.last_recalled_turn = fact.last_recalled_turn or prior.last_recalled_turn
        for stance in fact.stances_seen:
            if stance not in prior.stances_seen:
                prior.stances_seen.append(stance)
    return folded
