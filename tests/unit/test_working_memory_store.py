"""The working-memory store's three guarantees.

Salvaged from roleplay_v2's RuntimeStateStore (design §9.1). These tests exist
because the guarantees are the reason the design chose a worker-owned store over
LangGraph state, and all three fail silently when broken: a torn read produces a
plausible prompt, and a stale commit produces a plausible client.

The store is deliberately spec-free. v2's version was constructed from a
ScenarioSpec and seeded its ledger from authored secrets; this one derives its
ledgers from the conversation, which is what made the salvage a simplification.
"""

import asyncio

import pytest

from app.core.working_memory import (
    ClientWorkingMemory,
    ClientWorkingMemoryStore,
    Fact,
    Thread,
    WithheldTopic,
)


@pytest.fixture
def store():
    return ClientWorkingMemoryStore()


# ---------------------------------------------------------------------------
# Monotonic commits — the guarantee that replaces the SHA-256 revision field
# ---------------------------------------------------------------------------


async def test_a_stale_update_is_rejected_not_applied(store):
    # The off-path updater and the live turn race by design. A late update for
    # a superseded turn must not rewind the session — v2's phrasing: a slow
    # updater can only ever MISS a turn.
    await store.begin_turn()
    await store.begin_turn()
    assert await store.commit(2, stance="opening") is True

    assert await store.commit(1, stance="guarded") is False
    assert (await store.snapshot()).stance == "opening"


async def test_a_duplicate_update_for_the_same_turn_is_rejected(store):
    # Not just older — equal too. A retried update must not double-apply, or
    # `updates_committed` and any counted field drift.
    await store.begin_turn()
    assert await store.commit(1, stance="testing") is True
    assert await store.commit(1, stance="disclosing") is False

    snap = await store.snapshot()
    assert snap.stance == "testing"
    assert snap.updates_committed == 1


async def test_a_miss_does_not_block_the_next_commit(store):
    # A miss is not a write. If it advanced the counter, one timeout would
    # silently discard the following turn's update too.
    await store.begin_turn()
    await store.mark_miss()
    await store.begin_turn()

    assert await store.commit(2, stance="opening") is True
    snap = await store.snapshot()
    assert snap.updates_missed == 1
    assert snap.updates_committed == 1


# ---------------------------------------------------------------------------
# Snapshot isolation
# ---------------------------------------------------------------------------


async def test_a_snapshot_cannot_be_mutated_through(store):
    # Prompt assembly reads a snapshot while the updater may be writing. A
    # shallow copy would let a caller's edit reach the live record, or a live
    # write reach a half-rendered prompt.
    await store.begin_turn()
    await store.commit(
        1, speech_fragments=["I don't know"], disclosed=[Fact("job gone")]
    )

    snap = await store.snapshot()
    snap.speech_fragments.append("injected")
    snap.disclosed[0].text = "rewritten"
    snap.stance = "reflecting"

    live = await store.snapshot()
    assert live.speech_fragments == ["I don't know"]
    assert live.disclosed[0].text == "job gone"
    assert live.stance == "guarded"


async def test_concurrent_commits_do_not_interleave(store):
    # The lock is what makes "one of them wins cleanly" true rather than
    # "both half-applied".
    for _ in range(5):
        await store.begin_turn()

    results = await asyncio.gather(
        store.commit(3, stance="testing"),
        store.commit(4, stance="opening"),
        store.commit(2, stance="guarded"),
    )

    assert sum(1 for r in results if r) >= 1
    snap = await store.snapshot()
    # Whatever order they arrived in, the committed turn is the highest that won.
    assert snap.updated_by_turn == store.last_committed_turn


# ---------------------------------------------------------------------------
# Partial updates — the two paths write different fields at different cadences
# ---------------------------------------------------------------------------


async def test_omitted_fields_are_untouched_not_blanked(store):
    # State updates fire on a client-side event; recall refreshes on the
    # retrieval cadence. Neither may blank what the other owns, so None means
    # "not part of this update" rather than "clear it".
    await store.begin_turn()
    await store.commit(1, register="clipped, trails off", speech_fragments=["I guess"])
    await store.begin_turn()
    await store.commit(2, salient_backstory=[Fact("brother in Chennai")])

    snap = await store.snapshot()
    assert snap.register == "clipped, trails off"
    assert snap.speech_fragments == ["I guess"]
    assert [f.text for f in snap.salient_backstory] == ["brother in Chennai"]


async def test_a_stance_change_resets_time_in_stance_and_records_the_path(store):
    # stance_path is phase_diversity's input: the spacing effect counts DISTINCT
    # phases a fact surfaced in, not raw recurrences.
    await store.begin_turn()
    await store.begin_turn()
    await store.commit(2, stance="testing")
    await store.begin_turn()

    snap = await store.snapshot()
    assert snap.stance_path == ["guarded", "testing"]
    assert snap.turns_in_stance == 1


async def test_restating_the_same_stance_does_not_re_enter_it(store):
    await store.begin_turn()
    await store.commit(1, stance="guarded")
    snap = await store.snapshot()
    assert snap.stance_path == ["guarded"]


# ---------------------------------------------------------------------------
# Facts fold rather than accumulate — reconsolidation / foldCapture
# ---------------------------------------------------------------------------


async def test_a_revisited_fact_is_rewritten_not_duplicated(store):
    await store.begin_turn()
    await store.commit(1, disclosed=[Fact("lost the job", encoding_strength=1.0)])
    await store.begin_turn()
    await store.commit(
        2,
        disclosed=[
            Fact("lost the job", encoding_strength=2.5, stances_seen=["testing"])
        ],
    )

    snap = await store.snapshot()
    assert len(snap.disclosed) == 1
    assert snap.disclosed[0].encoding_strength == 2.5
    assert snap.disclosed[0].stances_seen == ["testing"]


async def test_an_earlier_encoding_is_never_weakened(store):
    # The earlier encoding happened. A later mention that was shallower does not
    # unmake a fact disclosed with feeling.
    await store.begin_turn()
    await store.commit(1, disclosed=[Fact("father drinks", encoding_strength=3.0)])
    await store.begin_turn()
    await store.commit(2, disclosed=[Fact("father drinks", encoding_strength=1.0)])

    snap = await store.snapshot()
    assert snap.disclosed[0].encoding_strength == 3.0


# ---------------------------------------------------------------------------
# Threads and the closure block
# ---------------------------------------------------------------------------


async def test_an_open_thread_blocks_proposing_closure(store):
    # The structural answer to "Thank you for today!" at turn 14 — the claim is
    # made false rather than discouraged.
    await store.begin_turn()
    await store.commit(1, opened_threads=[Thread("the argument with mum")])

    snap = await store.snapshot()
    assert snap.may_propose_closure is False
    assert [t.topic for t in snap.open_threads] == ["the argument with mum"]


async def test_closing_the_thread_releases_the_block(store):
    await store.begin_turn()
    await store.commit(1, opened_threads=[Thread("the argument with mum")])
    await store.begin_turn()
    await store.commit(2, closed_topics=["the argument with mum"])

    snap = await store.snapshot()
    assert snap.may_propose_closure is True
    assert snap.unresolved[0].closed_turn == 2


async def test_re_opening_a_known_thread_does_not_duplicate_it(store):
    await store.begin_turn()
    await store.commit(1, opened_threads=[Thread("money")])
    await store.begin_turn()
    await store.commit(2, opened_threads=[Thread("money")])

    assert len((await store.snapshot()).unresolved) == 1


# ---------------------------------------------------------------------------
# Withheld ledger — roleplay_v2's contract
# ---------------------------------------------------------------------------


async def test_a_withheld_topic_starts_locked(store):
    await store.begin_turn()
    await store.commit(
        1, withheld=[WithheldTopic("the diagnosis", "change the subject")]
    )

    item = (await store.snapshot()).withheld[0]
    assert item.status == "locked"
    assert item.deflection == "change the subject"


async def test_only_an_unlocked_topic_can_become_revealed(store):
    # Three states, not two. "May now discuss" and "has discussed" are different
    # facts, and revealing something still locked would skip the gate entirely.
    await store.begin_turn()
    await store.commit(1, withheld=[WithheldTopic("the diagnosis", "deflect")])
    await store.begin_turn()
    await store.commit(2, revealed_topics=["the diagnosis"])

    assert (await store.snapshot()).withheld[0].status == "locked"


# ---------------------------------------------------------------------------
# Staleness — §5.1's observability ask
# ---------------------------------------------------------------------------


async def test_staleness_grows_when_updates_stop_landing(store):
    # Without this a reader cannot tell a current memory from one whose updater
    # has been failing silently.
    await store.begin_turn()
    # Turn 0: begin_turn pre-increments from -1, so the first turn is 0 and an
    # update for it commits under 0. Committing under 1 here would be an update
    # for a turn that has not opened yet.
    await store.commit(0, stance="testing")
    assert (await store.snapshot()).staleness_turns == 0

    await store.begin_turn()
    await store.begin_turn()
    assert (await store.snapshot()).staleness_turns == 2


async def test_staleness_before_any_commit_is_the_turn_count(store):
    await store.begin_turn()
    await store.begin_turn()
    assert (await store.snapshot()).staleness_turns == 2


def test_a_fresh_record_seeds_its_own_stance_path():
    assert ClientWorkingMemory().stance_path == ["guarded"]


# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------


async def test_discard_cancels_an_in_flight_update(store):
    # A detached update still running at session end would write into a store
    # nobody will read, and hold a reference to the LLM client past teardown.
    started = asyncio.Event()

    async def slow_update():
        started.set()
        await asyncio.sleep(30)

    store._task = asyncio.create_task(slow_update())
    await started.wait()
    assert store.in_flight is True

    store.discard()
    await asyncio.sleep(0)
    assert store.in_flight is False


def test_discard_is_safe_when_nothing_is_running():
    # Shutdown runs on every session, including ones where no update ever
    # started, so this has to be a no-op rather than an AttributeError.
    ClientWorkingMemoryStore().discard()


async def test_discard_does_not_wipe_the_record(store):
    # The record dies with the worker instance; discard is about the task. If it
    # cleared state too, a shutdown racing finalize would lose the session's
    # memory before it could be written out.
    await store.begin_turn()
    await store.commit(1, stance="opening")
    store.discard()

    assert (await store.snapshot()).stance == "opening"
