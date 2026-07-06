"""RuntimeStateStore tests — snapshots, commits, and monotonicity."""

from app.roleplay_v2.spec.runtime_state import (
    LEDGER_LOCKED,
    LEDGER_REVEALED,
    LEDGER_UNLOCKED,
)


class TestInitialState:
    async def test_initial_snapshot(self, state_store, sample_spec):
        snap = await state_store.snapshot()
        assert snap.current_state_id == sample_spec.state_machine.initial_state_id
        assert snap.turn_index == 0
        assert snap.turns_in_state == 0
        assert all(v == LEDGER_LOCKED for v in snap.ledger.values())
        assert snap.state_path == [sample_spec.state_machine.initial_state_id]
        assert snap.cumulative_score == 0
        assert snap.direction_staleness_turns is None

    async def test_snapshot_is_isolated_copy(self, state_store):
        snap = await state_store.snapshot()
        snap.ledger["secret-parking"] = LEDGER_UNLOCKED
        snap.behavior_hits["beh-validation"] = 99
        fresh = await state_store.snapshot()
        assert fresh.ledger["secret-parking"] == LEDGER_LOCKED
        assert fresh.behavior_hits["beh-validation"] == 0


class TestBeginTurn:
    async def test_begin_turn_advances_counters(self, state_store):
        snap1 = await state_store.begin_turn()
        snap2 = await state_store.begin_turn()
        assert (snap1.turn_index, snap1.turns_in_state) == (1, 1)
        assert (snap2.turn_index, snap2.turns_in_state) == (2, 2)


class TestCommit:
    async def test_commit_applies_verdict(self, state_store):
        await state_store.begin_turn()
        ok = await state_store.commit(
            1,
            next_state_id="state-testing",
            unlock_ids=["secret-parking"],
            observed_behavior_ids=["beh-validation", "beh-open-questions"],
            score_delta=3.0,
            stage_direction="Soften slightly.",
            retrieve_topics=["work"],
            fired_event_ids=["evt-lecture-pushback"],
        )
        assert ok is True
        snap = await state_store.snapshot()
        assert snap.current_state_id == "state-testing"
        assert snap.turns_in_state == 0  # transition resets the counter
        assert snap.state_path == ["state-guarded", "state-testing"]
        assert snap.ledger["secret-parking"] == LEDGER_UNLOCKED
        assert snap.behavior_hits["beh-validation"] == 1
        assert snap.cumulative_score == 3.0
        assert snap.stage_direction == "Soften slightly."
        assert snap.stage_direction_turn == 1
        assert snap.retrieve_topics == ["work"]
        assert snap.fired_events == ["evt-lecture-pushback"]
        assert snap.director_commits == 1

    async def test_commit_monotonic_rejects_older_turn(self, state_store):
        for _ in range(3):
            await state_store.begin_turn()
        assert await state_store.commit(3, score_delta=1.0) is True
        # A late verdict for an earlier turn must be rejected...
        assert await state_store.commit(2, score_delta=100.0) is False
        # ...and so must a duplicate for the same turn.
        assert await state_store.commit(3, score_delta=100.0) is False
        snap = await state_store.snapshot()
        assert snap.cumulative_score == 1.0
        assert snap.director_commits == 1

    async def test_commit_out_of_order_then_newer_accepted(self, state_store):
        for _ in range(4):
            await state_store.begin_turn()
        assert await state_store.commit(2) is True
        assert await state_store.commit(1) is False
        assert await state_store.commit(4) is True
        assert state_store.last_committed_turn == 4

    async def test_direction_staleness(self, state_store):
        await state_store.begin_turn()
        await state_store.commit(1, stage_direction="Test the counselor.")
        await state_store.begin_turn()
        await state_store.begin_turn()
        snap = await state_store.snapshot()
        assert snap.direction_staleness_turns == 2


class TestSideChannels:
    async def test_apply_stage_direction_does_not_block_commits(self, state_store):
        await state_store.begin_turn()
        snap = await state_store.apply_stage_direction(
            "Phone buzzes.", event_id="evt-phone-buzz"
        )
        assert snap.stage_direction == "Phone buzzes."
        assert snap.fired_events == ["evt-phone-buzz"]
        # The time-event injection must not consume the monotonic counter:
        assert await state_store.commit(1, score_delta=1.0) is True

    async def test_mark_revealed_only_from_unlocked(self, state_store):
        await state_store.mark_revealed("secret-parking")  # locked → no-op
        snap = await state_store.snapshot()
        assert snap.ledger["secret-parking"] == LEDGER_LOCKED
        await state_store.begin_turn()
        await state_store.commit(1, unlock_ids=["secret-parking"])
        await state_store.mark_revealed("secret-parking")
        snap = await state_store.snapshot()
        assert snap.ledger["secret-parking"] == LEDGER_REVEALED

    async def test_mark_miss(self, state_store):
        await state_store.mark_miss()
        snap = await state_store.snapshot()
        assert snap.director_misses == 1
