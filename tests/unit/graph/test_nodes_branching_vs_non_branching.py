"""
Test cases for branching vs non-branching event processing separation.

Tests cover:
1. State synchronization: ensuring non-branching feedback is available when merging
2. Error handling: handling failures in async non-branching processing
3. Both paths work correctly: branching vs non-branching event processing
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.events.base import BaseEvent, ChatMessage
from app.core.graph.nodes import (
    generate_response,
    process_events,
    resolve_branching_instruction,
    send_event_feedback,
)
from app.core.graph.state import (
    BranchingAndFeedbackData,
    EventFeedback,
    SimulationState,
)


class DetectingEvent(BaseEvent):
    """Test event that detects based on match_text."""

    score: int | None = 1
    match_text: str | None = None
    branching_instruction: BranchingInstruction | None = None
    emoji: str | None = None
    emoji_message: str | None = None
    show_feedback: bool = True

    async def detect_event(self, conversations: list[ChatMessage]) -> bool:
        if not self.match_text:
            return False
        return any(self.match_text in m.content for m in conversations)


class TestBranchingVsNonBranchingSeparation:
    """Test separation of branching vs non-branching event processing."""

    @pytest.mark.asyncio
    async def test_process_events_splits_branching_and_non_branching(self):
        """Test that process_events splits events into branching vs non-branching."""
        msgs = [HumanMessage(content="test message")]
        e1 = DetectingEvent(
            event_id="e1",
            match_text="test",
            score=5,
            branching_instruction=BranchingInstruction.create("Branch instruction"),
            emoji="👍",
            emoji_message="Branch feedback",
        )
        e2 = DetectingEvent(
            event_id="e2",
            match_text="test",
            score=3,
            branching_instruction=None,  # Non-branching
            emoji="😊",
            emoji_message="Non-branch feedback",
        )

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1, e2],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        class MockEventOrchestrator:
            async def orchestrate_events(self, room, detected_event_ids):
                # Return both branching and non-branching events
                return (
                    [],
                    0,
                    [
                        BranchingAndFeedbackData(
                            branching_instruction=BranchingInstruction.create(
                                "Branch instruction"
                            ),
                            feedback=EventFeedback(
                                emoji="👍",
                                message="Branch feedback",
                                show_feedback=True,
                            ),
                            score=5,
                            event_id="e1",
                        ),
                        BranchingAndFeedbackData(
                            branching_instruction=None,  # Non-branching
                            feedback=EventFeedback(
                                emoji="😊",
                                message="Non-branch feedback",
                                show_feedback=True,
                            ),
                            score=3,
                            event_id="e2",
                        ),
                    ],
                )

            def get_last_occurred_at(self, event_id: str):
                return None

            def get_occurrence_count(self, event_id: str) -> int:
                return 0

        config = {
            "configurable": {
                "event_orchestrator": MockEventOrchestrator(),
                "room": object(),
            }
        }

        new_state = await process_events(state, config=config)

        # Verify events are split correctly
        assert len(new_state["branching_and_feedback_data"]) == 1
        assert (
            new_state["branching_and_feedback_data"][0].branching_instruction
            is not None
        )
        assert new_state["branching_and_feedback_data"][0].score == 5

        assert len(new_state["non_branching_feedback_data"]) == 1
        assert new_state["non_branching_feedback_data"][0].branching_instruction is None
        assert new_state["non_branching_feedback_data"][0].score == 3

    @pytest.mark.asyncio
    async def test_resolve_branching_instruction_only_processes_branching_events(self):
        """Test that resolve_branching_instruction only processes branching events."""
        instruction = BranchingInstruction.create("Branch instruction")
        instruction._llm_resolved = True  # Skip LLM resolution for simplicity

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction,
                    feedback=EventFeedback(emoji="👍", message="Branch feedback"),
                    score=10,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Non-branch feedback"),
                    score=5,
                    event_id="e2",
                )
            ],
        )

        result = await resolve_branching_instruction(state)

        # Should only process branching events
        assert result["next_instruction"] == "Branch instruction"
        # Should select branching event feedback (Priority 1)
        assert result["feedback_to_send"] is not None
        assert result["feedback_to_send"].message == "Branch feedback"

    @pytest.mark.asyncio
    async def test_generate_response_returns_dict_without_feedback_logic(self):
        """Test that generate_response returns a dict and does not handle feedback."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=BranchingInstruction.create("Branch"),
                    feedback=EventFeedback(emoji="👍", message="Branch feedback"),
                    score=10,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Non-branch feedback"),
                    score=5,
                    event_id="e2",
                )
            ],
            next_instruction="Branch",
            feedback_to_send=EventFeedback(emoji="👍", message="Branch feedback"),
        )

        mock_llm_client = MagicMock()
        mock_llm_instance = AsyncMock()
        mock_llm_instance.ainvoke = AsyncMock(
            return_value=AIMessage(content="Response")
        )
        mock_llm_client.llm_instance = mock_llm_instance

        config = {
            "configurable": {
                "llm_client": mock_llm_client,
                "scenario": None,
                "room": None,
            }
        }

        result = await generate_response(state, config=config)

        assert isinstance(result, dict)
        assert result["next_instruction"] is None
        assert result["messages"][0].content == "Response"

    @pytest.mark.asyncio
    async def test_send_event_feedback_fallback_to_non_branching(self):
        """Test send_event_feedback falls back to non-branching feedback."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Non-branch feedback"),
                    score=5,
                    event_id="e1",
                )
            ],
            next_instruction=None,
            feedback_to_send=None,
        )

        mock_room = MagicMock()
        mock_room.name = "test_room"

        config = {
            "configurable": {
                "room": mock_room,
            }
        }

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            result = await send_event_feedback(state, config=config)

            assert mock_send.called
            call_args = mock_send.call_args[0][0]
            assert call_args.data.message == "Non-branch feedback"

        assert result["branching_and_feedback_data"] is None
        assert result["non_branching_feedback_data"] is None

    @pytest.mark.asyncio
    async def test_cumulative_score_includes_both_branching_and_non_branching(self):
        """Test cumulative score includes both branching and non-branching."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=BranchingInstruction.create("Branch"),
                    feedback=EventFeedback(emoji="👍", message="Branch feedback"),
                    score=10,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Non-branch feedback"),
                    score=5,
                    event_id="e2",
                )
            ],
            next_instruction="Branch",
            feedback_to_send=EventFeedback(emoji="👍", message="Branch feedback"),
        )

        mock_room = MagicMock()
        mock_room.name = "test_room"

        config = {
            "configurable": {
                "room": mock_room,
            }
        }

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            await send_event_feedback(state, config=config)

            # Verify feedback was sent with cumulative score (10 + 5 = 15)
            assert mock_send.called
            call_args = mock_send.call_args[0][0]
            assert call_args.data.score == 15  # 10 + 5

    @pytest.mark.asyncio
    async def test_state_synchronization_non_branching_available_for_merging(self):
        """Test non-branching feedback data available when merging."""
        # Step 1: Process events - split into branching and non-branching
        msgs = [HumanMessage(content="test")]
        e1 = DetectingEvent(
            event_id="e1",
            match_text="test",
            score=5,
            branching_instruction=None,  # Non-branching
            emoji="😊",
            emoji_message="Non-branch feedback",
        )

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        class MockEventOrchestrator:
            async def orchestrate_events(self, room, detected_event_ids):
                return (
                    [],
                    0,
                    [
                        BranchingAndFeedbackData(
                            branching_instruction=None,
                            feedback=EventFeedback(
                                emoji="😊", message="Non-branch feedback"
                            ),
                            score=5,
                            event_id="e1",
                        )
                    ],
                )

            def get_last_occurred_at(self, event_id: str):
                return None

            def get_occurrence_count(self, event_id: str) -> int:
                return 0

        config = {
            "configurable": {
                "event_orchestrator": MockEventOrchestrator(),
                "room": object(),
            }
        }

        processed_state = await process_events(state, config=config)

        # Verify non-branching data is stored
        assert len(processed_state["non_branching_feedback_data"]) == 1

        # Step 2: Resolve branching (should be empty)
        resolve_state = SimulationState(
            messages=msgs,
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=processed_state.get(
                "branching_and_feedback_data"
            )
            or [],
            non_branching_feedback_data=processed_state.get(
                "non_branching_feedback_data"
            )
            or [],
        )

        resolve_result = await resolve_branching_instruction(resolve_state)

        # No branching events, so no instruction
        assert resolve_result["next_instruction"] is None
        assert resolve_result["feedback_to_send"] is None

        # Step 3: Generate response - should merge non-branching feedback
        generate_state = SimulationState(
            messages=msgs,
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=resolve_state.branching_and_feedback_data,
            non_branching_feedback_data=resolve_state.non_branching_feedback_data,
            next_instruction=resolve_result["next_instruction"],
            feedback_to_send=resolve_result["feedback_to_send"],
        )

        mock_llm_client = MagicMock()
        mock_llm_instance = AsyncMock()
        mock_llm_instance.ainvoke = AsyncMock(
            return_value=AIMessage(content="Response")
        )
        mock_llm_client.llm_instance = mock_llm_instance

        generate_config = {
            "configurable": {
                "llm_client": mock_llm_client,
                "scenario": None,
                "room": None,
            }
        }

        result = await generate_response(generate_state, generate_config)

        # generate_response returns a dict with the AI message
        assert isinstance(result, dict)
        assert result["messages"][0].content == "Response"

        # Non-branching feedback data is still on generate_state for
        # send_event_feedback to consume later
        assert len(generate_state.non_branching_feedback_data) == 1

    @pytest.mark.asyncio
    async def test_error_handling_orchestrator_failure(self):
        """Test error handling when orchestrator fails."""
        msgs = [HumanMessage(content="test")]
        e1 = DetectingEvent(event_id="e1", match_text="test", score=5)

        state = SimulationState(
            messages=msgs,
            permitted_events=[e1],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        class FailingEventOrchestrator:
            async def orchestrate_events(self, room, detected_event_ids):
                raise Exception("Orchestrator failure")

            def get_last_occurred_at(self, event_id: str):
                return None

            def get_occurrence_count(self, event_id: str) -> int:
                return 0

        config = {
            "configurable": {
                "event_orchestrator": FailingEventOrchestrator(),
                "room": object(),
            }
        }

        # Should handle error gracefully
        with pytest.raises(Exception, match="Orchestrator failure"):
            await process_events(state, config=config)

    @pytest.mark.asyncio
    async def test_error_handling_llm_resolution_failure(self):
        """Test error handling when LLM resolution fails in branching instruction."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)>"
        )

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction,
                    feedback=EventFeedback(emoji="👍", message="Feedback"),
                    score=10,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[],
        )

        # Mock LLM resolution to fail
        async def failing_resolve(llm_config, language_code):
            raise Exception("LLM resolution failure")

        instruction.resolve_llm_responses = failing_resolve

        # Should propagate the error
        with pytest.raises(Exception, match="LLM resolution failure"):
            await resolve_branching_instruction(state)

    @pytest.mark.asyncio
    async def test_priority_branching_feedback_over_non_branching(self):
        """Test that branching event feedback takes priority over non-branching."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=BranchingInstruction.create("Branch"),
                    feedback=EventFeedback(emoji="👍", message="Branch feedback"),
                    score=5,  # Lower score
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Non-branch feedback"),
                    score=10,  # Higher score
                    event_id="e2",
                )
            ],
            next_instruction="Branch",
            feedback_to_send=EventFeedback(
                emoji="👍", message="Branch feedback"
            ),  # From branching (Priority 1)
        )

        mock_room = MagicMock()
        mock_room.name = "test_room"

        config = {
            "configurable": {
                "room": mock_room,
            }
        }

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            await send_event_feedback(state, config=config)

            # Verify branching feedback was used (Priority 1)
            assert mock_send.called
            call_args = mock_send.call_args[0][0]
            assert call_args.data.message == "Branch feedback"  # From branching event
            # But cumulative score should include both (5 + 10 = 15)
            assert call_args.data.score == 15

    @pytest.mark.asyncio
    async def test_empty_non_branching_events_handled_gracefully(self):
        """Test that empty non-branching events are handled gracefully."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],  # Empty
            next_instruction=None,
            feedback_to_send=None,
        )

        config = {
            "configurable": {
                "room": None,
            }
        }

        # Should handle gracefully without errors
        result = await send_event_feedback(state, config=config)
        assert result["non_branching_feedback_data"] is None
