"""
Tests for the rolling conversation summary (episodic memory).

Covers:
- summary_boundary_index / count_learner_turns slicing rules
- update_rolling_summary formatting + merge call
- the compact_history node's gating (flag, store, pause, cadence, in-flight)
  and its DETACHED background compaction writing into RollingSummaryStore
- generate_system_message appending the summary as the LAST block
- graph wiring of compact_history behind ROLLING_SUMMARY_ENABLED
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.config import settings
from app.core.graph.nodes import compact_history
from app.core.graph.rolling_summary import (
    RollingSummaryStore,
    count_learner_turns,
    summary_boundary_index,
    update_rolling_summary,
)
from app.core.graph.state import SimulationState


def _conversation(learner_turns: int) -> list:
    """Alternating learner/agent messages: N learner turns, each replied to."""
    messages = []
    for i in range(learner_turns):
        messages.append(HumanMessage(content=f"learner {i}"))
        messages.append(AIMessage(content=f"client {i}"))
    return messages


def _state(messages):
    return SimulationState(
        messages=messages,
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
    )


def _config(llm_client=None, session_clock=None, scenario=None, store=None):
    return {
        "configurable": {
            "llm_client": llm_client,
            "session_clock": session_clock,
            "scenario": scenario,
            "rolling_summary_store": store,
        }
    }


class TestSummaryBoundary:
    def test_short_conversation_has_no_summarizable_prefix(self):
        messages = _conversation(3)
        assert summary_boundary_index(messages, tail_dialogues=6) == 0

    def test_boundary_anchors_on_tailth_last_learner_turn(self):
        messages = _conversation(10)
        # 10 learner turns at even indices 0..18; tail of 6 keeps turns 4..9,
        # so the boundary is the index of learner turn 4 -> 8.
        assert summary_boundary_index(messages, tail_dialogues=6) == 8

    def test_nonpositive_tail_summarizes_everything(self):
        messages = _conversation(4)
        assert summary_boundary_index(messages, tail_dialogues=0) == len(messages)

    def test_count_learner_turns(self):
        assert count_learner_turns(_conversation(5)) == 5
        assert count_learner_turns([AIMessage(content="x")]) == 0


class TestUpdateRollingSummary:
    @pytest.mark.asyncio
    async def test_merges_previous_summary_and_new_turns(self):
        structured = AsyncMock()
        structured.ainvoke.return_value = MagicMock(summary="updated summary")
        llm_client = MagicMock()
        llm_client.llm_instance.with_structured_output.return_value = structured

        result = await update_rolling_summary(
            previous_summary="old summary",
            new_messages=_conversation(2),
            llm_client=llm_client,
        )

        assert result == "updated summary"
        sent = structured.ainvoke.call_args[0][0]
        # [system template, human payload]
        assert len(sent) == 2
        assert "old summary" in sent[1].content
        assert "COUNSELLOR: learner 0" in sent[1].content
        assert "YOU: client 0" in sent[1].content

    @pytest.mark.asyncio
    async def test_empty_delta_keeps_previous_summary_without_llm_call(self):
        llm_client = MagicMock()
        result = await update_rolling_summary(
            previous_summary="kept",
            new_messages=[],
            llm_client=llm_client,
        )
        assert result == "kept"
        llm_client.llm_instance.with_structured_output.assert_not_called()

    @pytest.mark.asyncio
    async def test_blank_llm_output_falls_back_to_previous(self):
        structured = AsyncMock()
        structured.ainvoke.return_value = MagicMock(summary="   ")
        llm_client = MagicMock()
        llm_client.llm_instance.with_structured_output.return_value = structured

        result = await update_rolling_summary(
            previous_summary="previous",
            new_messages=_conversation(1),
            llm_client=llm_client,
        )
        assert result == "previous"


class TestCompactHistoryNode:
    @pytest.mark.asyncio
    async def test_noop_when_flag_disabled(self):
        store = RollingSummaryStore()
        with patch.object(settings, "ROLLING_SUMMARY_ENABLED", False):
            result = await compact_history(
                _state(_conversation(20)), _config(store=store)
            )
        assert result == {}
        assert store._task is None

    @pytest.mark.asyncio
    async def test_noop_without_store(self):
        with patch.object(settings, "ROLLING_SUMMARY_ENABLED", True):
            result = await compact_history(_state(_conversation(20)), _config())
        assert result == {}

    @pytest.mark.asyncio
    async def test_noop_while_paused(self):
        store = RollingSummaryStore()
        clock = MagicMock()
        clock.is_paused = True
        with patch.object(settings, "ROLLING_SUMMARY_ENABLED", True):
            result = await compact_history(
                _state(_conversation(20)),
                _config(session_clock=clock, store=store),
            )
        assert result == {}
        assert store._task is None

    @pytest.mark.asyncio
    async def test_noop_below_cadence(self):
        # Boundary exists but fewer than EVERY_TURNS new learner turns beyond
        # the already-covered prefix.
        messages = _conversation(8)
        store = RollingSummaryStore()
        boundary = summary_boundary_index(messages, 6)
        store.covered_count = boundary - 2
        with (
            patch.object(settings, "ROLLING_SUMMARY_ENABLED", True),
            patch.object(settings, "ROLLING_SUMMARY_EVERY_TURNS", 4),
            patch.object(settings, "ROLLING_SUMMARY_TAIL_DIALOGUES", 6),
        ):
            result = await compact_history(
                _state(messages),
                _config(llm_client=MagicMock(), store=store),
            )
        assert result == {}
        assert store._task is None

    @pytest.mark.asyncio
    async def test_skips_when_compaction_in_flight(self):
        store = RollingSummaryStore()
        never_done = asyncio.get_event_loop().create_future()
        pending = asyncio.ensure_future(never_done)
        store._task = pending
        with patch.object(settings, "ROLLING_SUMMARY_ENABLED", True):
            result = await compact_history(
                _state(_conversation(20)),
                _config(llm_client=MagicMock(), store=store),
            )
        assert result == {}
        assert store._task is pending
        pending.cancel()

    @pytest.mark.asyncio
    async def test_compacts_in_background_and_advances_store(self):
        messages = _conversation(12)
        store = RollingSummaryStore()
        with (
            patch.object(settings, "ROLLING_SUMMARY_ENABLED", True),
            patch.object(settings, "ROLLING_SUMMARY_EVERY_TURNS", 4),
            patch.object(settings, "ROLLING_SUMMARY_TAIL_DIALOGUES", 6),
            patch(
                "app.core.graph.rolling_summary.update_rolling_summary",
                new=AsyncMock(return_value="new summary"),
            ),
        ):
            result = await compact_history(
                _state(messages), _config(llm_client=MagicMock(), store=store)
            )
            # Node returns IMMEDIATELY with no state writes; compaction runs
            # in a detached task that updates the store.
            assert result == {}
            assert store._task is not None
            await store._task
        # 12 learner turns, tail 6 -> boundary at learner turn 6 (index 12).
        assert store.summary == "new summary"
        assert store.covered_count == 12
        assert store.total_count == 24

    @pytest.mark.asyncio
    async def test_background_failure_keeps_previous_store(self):
        messages = _conversation(12)
        store = RollingSummaryStore()
        store.summary = "old"
        store.covered_count = 2
        with (
            patch.object(settings, "ROLLING_SUMMARY_ENABLED", True),
            patch.object(settings, "ROLLING_SUMMARY_EVERY_TURNS", 4),
            patch.object(settings, "ROLLING_SUMMARY_TAIL_DIALOGUES", 6),
            patch(
                "app.core.graph.rolling_summary.update_rolling_summary",
                new=AsyncMock(side_effect=RuntimeError("boom")),
            ),
        ):
            result = await compact_history(
                _state(messages), _config(llm_client=MagicMock(), store=store)
            )
            assert result == {}
            await store._task
        assert store.summary == "old"
        assert store.covered_count == 2


class TestPromptInjection:
    def test_summary_is_appended_as_last_block(self):
        from langchain_core.messages import SystemMessage

        from app.core.graph.prompt import _append_rolling_summary

        base = SystemMessage(content="PERSONA BLOCK")
        result = _append_rolling_summary(base, "summary text")
        assert result.content.startswith("PERSONA BLOCK")
        assert result.content.endswith("summary text")
        assert "Conversation so far (your memory)" in result.content

    def test_empty_summary_leaves_message_unchanged(self):
        from langchain_core.messages import SystemMessage

        from app.core.graph.prompt import _append_rolling_summary

        base = SystemMessage(content="PERSONA BLOCK")
        assert _append_rolling_summary(base, None) is base
        assert _append_rolling_summary(base, "   ") is base

    def test_summary_is_capped(self):
        from langchain_core.messages import SystemMessage

        from app.core.graph.prompt import _append_rolling_summary

        with patch.object(settings, "ROLLING_SUMMARY_MAX_CHARS", 10):
            result = _append_rolling_summary(SystemMessage(content="P"), "x" * 100)
        assert "x" * 10 in result.content
        assert "x" * 11 not in result.content

    def test_generate_system_message_places_summary_after_glossary(self):
        from app.core.graph.prompt import generate_system_message
        from app.core.scenario.base import PromptData

        prompt_data = PromptData(
            role_instructions="You are a client.",
            language_glossary="GLOSSARY CARD",
        )
        msg = generate_system_message(
            prompt_data=prompt_data,
            behavior_instructions=[],
            rolling_summary="SUMMARY TAIL",
        )
        assert "GLOSSARY CARD" in msg.content
        assert "SUMMARY TAIL" in msg.content
        assert msg.content.index("GLOSSARY CARD") < msg.content.index("SUMMARY TAIL")
        assert msg.content.endswith("SUMMARY TAIL")


class TestGraphWiring:
    def test_compact_history_wired_when_enabled(self):
        with patch.object(settings, "ROLLING_SUMMARY_ENABLED", True):
            from app.core.graph.graph_builder import build_simulation_graph

            graph = build_simulation_graph()
        assert "compact_history" in graph.nodes

    def test_compact_history_absent_when_disabled(self):
        with patch.object(settings, "ROLLING_SUMMARY_ENABLED", False):
            from app.core.graph.graph_builder import build_simulation_graph

            graph = build_simulation_graph()
        assert "compact_history" not in graph.nodes
