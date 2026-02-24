"""
Tests for ScoreKeeper business logic.

Covers:
- Score accumulation from behavior instructions
- Thread-safety (concurrent adds)
- Correct total reported to send_final_score_to_core
- detect_behaviors node wires scores into ScoreKeeper
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import HumanMessage

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
        assert sk.behavior_score == 0
        assert sk.get_total_score() == 0

    @pytest.mark.asyncio
    async def test_accumulates_positive_scores(self):
        sk = ScoreKeeper()
        await sk.add_behavior_score(5)
        await sk.add_behavior_score(3)
        assert sk.behavior_score == 8
        assert sk.get_total_score() == 8

    @pytest.mark.asyncio
    async def test_accumulates_negative_scores(self):
        """Negative scores (SHOULD_NOT_DO behaviors) must reduce the total."""
        sk = ScoreKeeper()
        await sk.add_behavior_score(10)
        await sk.add_behavior_score(-4)
        assert sk.get_total_score() == 6

    @pytest.mark.asyncio
    async def test_mixed_sign_scores_sum_correctly(self):
        sk = ScoreKeeper()
        await sk.add_behavior_score(7)
        await sk.add_behavior_score(-7)
        assert sk.get_total_score() == 0

    @pytest.mark.asyncio
    async def test_concurrent_adds_are_thread_safe(self):
        """All concurrent score additions must be reflected in the final total."""
        sk = ScoreKeeper()
        # 100 concurrent coroutines each adding 1
        await asyncio.gather(*[sk.add_behavior_score(1) for _ in range(100)])
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


class TestFinalScoreIncludesScoreKeeper:
    @pytest.mark.asyncio
    async def test_final_score_sums_event_and_behavior_scores(self):
        """send_final_score_to_core must add event score + ScoreKeeper total."""
        event_orchestrator = MagicMock()
        event_orchestrator.live_score = 10

        score_keeper = ScoreKeeper()
        await score_keeper.add_behavior_score(7)

        with patch(
            "app.core.queue.utils.send_message_to_queue", new_callable=AsyncMock
        ) as mock_send:
            from app.core.queue.utils import send_final_score_to_core

            await send_final_score_to_core(
                room_id="room-1",
                thread_id="room-1",
                event_orchestrator=event_orchestrator,
                score_keeper=score_keeper,
            )

        sent_payload = mock_send.call_args[0][0]
        assert '"totalScore":17' in sent_payload

    @pytest.mark.asyncio
    async def test_final_score_without_score_keeper_uses_event_score_only(self):
        """Omitting ScoreKeeper must not break final score (backward compat)."""
        event_orchestrator = MagicMock()
        event_orchestrator.live_score = 10

        with patch(
            "app.core.queue.utils.send_message_to_queue", new_callable=AsyncMock
        ) as mock_send:
            from app.core.queue.utils import send_final_score_to_core

            await send_final_score_to_core(
                room_id="room-1",
                thread_id="room-1",
                event_orchestrator=event_orchestrator,
            )

        sent_payload = mock_send.call_args[0][0]
        assert '"totalScore":10' in sent_payload

    @pytest.mark.asyncio
    async def test_final_score_with_negative_behavior_scores(self):
        """Negative behavior scores must reduce the final total."""
        event_orchestrator = MagicMock()
        event_orchestrator.live_score = 10

        score_keeper = ScoreKeeper()
        await score_keeper.add_behavior_score(-4)

        with patch(
            "app.core.queue.utils.send_message_to_queue", new_callable=AsyncMock
        ) as mock_send:
            from app.core.queue.utils import send_final_score_to_core

            await send_final_score_to_core(
                room_id="room-1",
                thread_id="room-1",
                event_orchestrator=event_orchestrator,
                score_keeper=score_keeper,
            )

        sent_payload = mock_send.call_args[0][0]
        assert '"totalScore":6' in sent_payload
