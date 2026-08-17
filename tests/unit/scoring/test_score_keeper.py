"""
Tests for ScoreKeeper business logic.

Covers:
- Score accumulation from events and behavior instructions independently
- get_total_score() returns the combined total
- Thread-safety (concurrent adds across both buckets)
- detect_behaviors node wires behavior scores into ScoreKeeper
- send_final_score_to_core uses ScoreKeeper.get_total_score() as sole source
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import HumanMessage

from app.core.config import settings
from app.core.graph.nodes import detect_behaviors
from app.core.graph.state import SimulationState
from app.core.scenario.simulation_instructions import SimulationBehaviorCategory
from app.core.scoring.score_keeper import ScoreKeeper

# ---------------------------------------------------------------------------
# ScoreKeeper unit tests
# ---------------------------------------------------------------------------


class TestScoreKeeperAccumulation:
    @pytest.mark.asyncio
    async def test_starts_at_zero(self):
        sk = ScoreKeeper()
        assert sk.event_score == 0
        assert sk.behavior_score == 0
        assert sk.get_total_score() == 0

    @pytest.mark.asyncio
    async def test_event_and_behavior_scores_are_tracked_independently(self):
        sk = ScoreKeeper()
        await sk.add_event_score(10)
        await sk.add_behavior_score(5)
        assert sk.event_score == 10
        assert sk.behavior_score == 5
        assert sk.get_total_score() == 15

    @pytest.mark.asyncio
    async def test_get_total_score_sums_both_buckets(self):
        sk = ScoreKeeper()
        await sk.add_event_score(7)
        await sk.add_behavior_score(3)
        assert sk.get_total_score() == 10

    @pytest.mark.asyncio
    async def test_negative_behavior_score_reduces_total(self):
        """SHOULD_NOT_DO behaviors carry negative scores."""
        sk = ScoreKeeper()
        await sk.add_event_score(10)
        await sk.add_behavior_score(-4)
        assert sk.get_total_score() == 6

    @pytest.mark.asyncio
    async def test_concurrent_adds_are_thread_safe(self):
        """50 event + 50 behavior concurrent adds must all be reflected."""
        sk = ScoreKeeper()
        await asyncio.gather(
            *[sk.add_event_score(1) for _ in range(50)],
            *[sk.add_behavior_score(1) for _ in range(50)],
        )
        assert sk.event_score == 50
        assert sk.behavior_score == 50
        assert sk.get_total_score() == 100


# ---------------------------------------------------------------------------
# detect_behaviors node integration with ScoreKeeper
# ---------------------------------------------------------------------------


def _make_state() -> SimulationState:
    return SimulationState(
        messages=[HumanMessage(content="Hello")],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )


def _make_behavior_instruction(bi_id: str, score: int):
    bi = MagicMock()
    bi.behavior_instruction_id = bi_id
    bi.score = score
    bi.category = SimulationBehaviorCategory.SHOULD_DO
    bi.detect = AsyncMock(return_value=True)
    return bi


class TestDetectBehaviorsScoreKeeperIntegration:
    """Exercises detect_behaviors' synchronous ScoreKeeper wiring directly —
    that logic is unchanged, but BEHAVIORS_DEFER_DETECTION (default True as
    of 2026-08-17) now gates it behind a background task instead, so these
    tests opt into the synchronous path explicitly rather than testing the
    default."""

    @pytest.fixture(autouse=True)
    def _sync_behavior_detection(self, monkeypatch):
        monkeypatch.setattr(settings, "BEHAVIORS_DEFER_DETECTION", False)

    @pytest.mark.asyncio
    async def test_detected_behaviors_are_added_to_score_keeper(self):
        """ScoreKeeper must accumulate scores for every detected behavior."""
        bi1 = _make_behavior_instruction("bi_1", score=5)
        bi2 = _make_behavior_instruction("bi_2", score=3)

        scenario = MagicMock()
        scenario.behavior_instructions = [bi1, bi2]

        score_keeper = ScoreKeeper()
        config = {"configurable": {"scenario": scenario, "score_keeper": score_keeper}}

        await detect_behaviors(_make_state(), config=config)

        assert score_keeper.get_total_score() == 8

    @pytest.mark.asyncio
    async def test_undetected_behaviors_do_not_affect_score_keeper(self):
        """Behaviors that return False from detect() must not add to the score."""
        bi_detected = _make_behavior_instruction("bi_yes", score=5)
        bi_not_detected = MagicMock()
        bi_not_detected.behavior_instruction_id = "bi_no"
        bi_not_detected.score = 10
        bi_not_detected.category = SimulationBehaviorCategory.SHOULD_DO
        bi_not_detected.detect = AsyncMock(return_value=False)

        scenario = MagicMock()
        scenario.behavior_instructions = [bi_detected, bi_not_detected]

        score_keeper = ScoreKeeper()
        config = {"configurable": {"scenario": scenario, "score_keeper": score_keeper}}

        await detect_behaviors(_make_state(), config=config)

        assert score_keeper.get_total_score() == 5

    @pytest.mark.asyncio
    async def test_no_score_keeper_in_config_does_not_raise(self):
        """detect_behaviors must work normally when no ScoreKeeper is in config."""
        bi = _make_behavior_instruction("bi_1", score=5)
        scenario = MagicMock()
        scenario.behavior_instructions = [bi]

        config = {"configurable": {"scenario": scenario}}  # no score_keeper

        result = await detect_behaviors(_make_state(), config=config)

        assert len(result["behavior_feedback_data"]) == 1

    @pytest.mark.asyncio
    async def test_scores_accumulate_across_multiple_turns(self):
        """ScoreKeeper must accumulate across successive detect_behaviors calls."""
        bi = _make_behavior_instruction("bi_1", score=4)
        scenario = MagicMock()
        scenario.behavior_instructions = [bi]

        score_keeper = ScoreKeeper()
        config = {"configurable": {"scenario": scenario, "score_keeper": score_keeper}}

        await detect_behaviors(_make_state(), config=config)
        await detect_behaviors(_make_state(), config=config)

        assert score_keeper.get_total_score() == 8


# ---------------------------------------------------------------------------
# send_final_score_to_core includes ScoreKeeper total
# ---------------------------------------------------------------------------


class TestFinalScoreIsScoreKeeperTotal:
    @pytest.mark.asyncio
    async def test_final_score_is_sum_of_event_and_behavior_buckets(self):
        """ScoreKeeper.get_total_score() is the definitive final score."""
        score_keeper = ScoreKeeper()
        await score_keeper.add_event_score(10)
        await score_keeper.add_behavior_score(7)

        with patch(
            "app.core.queue.utils.send_message_to_queue", new_callable=AsyncMock
        ) as mock_send:
            from app.core.queue.utils import finalize_session

            await finalize_session(
                room_id="room-1",
                thread_id="room-1",
                score_keeper=score_keeper,
            )

        sent_payload = mock_send.call_args[0][0]
        assert '"totalScore":17' in sent_payload

    @pytest.mark.asyncio
    async def test_negative_behavior_score_reduces_final_total(self):
        """Negative behavior scores (SHOULD_NOT_DO) must reduce the final total."""
        score_keeper = ScoreKeeper()
        await score_keeper.add_event_score(10)
        await score_keeper.add_behavior_score(-4)

        with patch(
            "app.core.queue.utils.send_message_to_queue", new_callable=AsyncMock
        ) as mock_send:
            from app.core.queue.utils import finalize_session

            await finalize_session(
                room_id="room-1",
                thread_id="room-1",
                score_keeper=score_keeper,
            )

        sent_payload = mock_send.call_args[0][0]
        assert '"totalScore":6' in sent_payload

    @pytest.mark.asyncio
    async def test_fallback_to_graph_state_when_no_score_keeper(self):
        """When ScoreKeeper is absent, fall back to graph state (returns 0 in tests)."""
        with patch(
            "app.core.queue.utils.send_message_to_queue", new_callable=AsyncMock
        ) as mock_send:
            with patch(
                "app.core.queue.utils.get_current_score_from_graph", return_value=42
            ):
                from app.core.queue.utils import finalize_session

                await finalize_session(
                    room_id="room-1",
                    thread_id="room-1",
                )

        sent_payload = mock_send.call_args[0][0]
        assert '"totalScore":42' in sent_payload


class TestDetectBehaviorsOptionalFields:
    """Tests verifying detect_behaviors handles None/empty behavior_instructions."""

    @pytest.mark.asyncio
    async def test_none_behavior_instructions_returns_empty_feedback(self):
        """detect_behaviors returns [] when behavior_instructions is None."""
        scenario = MagicMock()
        scenario.behavior_instructions = None

        config = {"configurable": {"scenario": scenario}}

        result = await detect_behaviors(_make_state(), config=config)

        assert result["behavior_feedback_data"] == []

    @pytest.mark.asyncio
    async def test_empty_behavior_instructions_returns_empty_feedback(self):
        """detect_behaviors returns [] when behavior_instructions is []."""
        scenario = MagicMock()
        scenario.behavior_instructions = []

        config = {"configurable": {"scenario": scenario}}

        result = await detect_behaviors(_make_state(), config=config)

        assert result["behavior_feedback_data"] == []

    @pytest.mark.asyncio
    async def test_none_behavior_instructions_does_not_update_score_keeper(self):
        """Score keeper stays at 0 when behavior_instructions is None."""
        scenario = MagicMock()
        scenario.behavior_instructions = None

        score_keeper = ScoreKeeper()
        config = {"configurable": {"scenario": scenario, "score_keeper": score_keeper}}

        await detect_behaviors(_make_state(), config=config)

        assert score_keeper.get_total_score() == 0
