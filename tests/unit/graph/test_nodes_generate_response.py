import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.events.base import BaseEvent
from app.core.graph.nodes import generate_response
from app.core.graph.state import (
    BranchingAndFeedbackData,
    EventFeedback,
    SimulationState,
)


class FakeLLM:
    def __init__(self, content: str = "OK"):
        self._content = content

    async def ainvoke(self, messages):
        # Return AIMessage-like object with .content
        return AIMessage(self._content)


class FakeLLMClient:
    """Mock LLM client that returns a FakeLLM instance."""

    def __init__(self, content: str = "OK"):
        self._llm_instance = FakeLLM(content)

    @property
    def llm_instance(self):
        return self._llm_instance


class TestGenerateResponse:
    @pytest.mark.asyncio
    async def test_generate_response_builds_system_message_and_returns_ai_only(
        self, monkeypatch
    ):
        # Use pre-configured LLM client (new approach)
        llm_client = FakeLLMClient(content="hello from llm")

        # Minimal BaseEvent subclass for new_events validation
        class FakeEvent(BaseEvent):
            async def detect_event(self, conversations):
                return False

        # Build state with some prior messages and two events (one with
        # branching_instruction)
        msgs = [HumanMessage(content="hi"), HumanMessage(content="tell me more")]
        ev1 = FakeEvent(event_id="e1", branching_instruction=None)
        branching_inst = BranchingInstruction.create("probe on family")
        ev2 = FakeEvent(event_id="e2", branching_instruction=branching_inst)

        state = SimulationState(
            messages=msgs,
            permitted_events=[],
            events_accumulator=[],
            new_events=[ev1, ev2],
            current_score=0,
            branching_and_feedback_data=[],
        )

        # Provide scenario with prompt_data via config
        prompt_data = type(
            "PD",
            (),
            {
                "name": "Alex",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        # Add language_config to scenario
        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-IN", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {"prompt_data": prompt_data, "language_config": language_config},
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        new_state = await generate_response(state, config=config)

        # Should return only the new AI message in state.messages
        assert len(new_state.messages) == 1
        assert isinstance(new_state.messages[0], AIMessage)
        assert new_state.messages[0].content == "hello from llm"

        # new_events cleared
        assert new_state.new_events == []
        # permitted/events_accumulator/current_score preserved
        assert new_state.current_score == state.current_score

    @pytest.mark.asyncio
    async def test_generate_response_selects_max_magnitude_branching_instruction(
        self, monkeypatch
    ):
        # Use pre-configured LLM client (new approach)
        llm_client = FakeLLMClient(content="response")

        # Multiple branching instructions with different scores
        low_inst = BranchingInstruction.create("low positive")
        high_inst = BranchingInstruction.create("high negative")
        medium_inst = BranchingInstruction.create("medium positive")
        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=low_inst,
                    feedback=EventFeedback(
                        emoji=":)", message="Low", show_feedback=True
                    ),
                    score=2,
                    event_id="e1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=high_inst,  # Highest magnitude
                    feedback=EventFeedback(
                        emoji=":(", message="High", show_feedback=True
                    ),
                    score=-10,
                    event_id="e2",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=medium_inst,
                    feedback=EventFeedback(
                        emoji=":D", message="Medium", show_feedback=True
                    ),
                    score=5,
                    event_id="e3",
                ),
            ],
        )

        prompt_data = type(
            "PD",
            (),
            {
                "name": "Test",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-US", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {"prompt_data": prompt_data, "language_config": language_config},
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        new_state = await generate_response(state, config=config)

        # Branching and feedback data should be cleared after use
        assert new_state.branching_and_feedback_data == []

    @pytest.mark.asyncio
    async def test_generate_response_with_no_branching_instructions(self, monkeypatch):
        # Use pre-configured LLM client (new approach)
        llm_client = FakeLLMClient(content="response")

        # Events without branching instructions (now in non_branching_feedback_data)
        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(
                        emoji=":)", message="Good", show_feedback=True
                    ),
                    score=5,
                    event_id="e1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(
                        emoji=":D", message="Great", show_feedback=True
                    ),
                    score=3,
                    event_id="e2",
                ),
            ],
        )

        prompt_data = type(
            "PD",
            (),
            {
                "name": "Test",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-US", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {"prompt_data": prompt_data, "language_config": language_config},
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        new_state = await generate_response(state, config=config)

        # Branching and feedback data should be cleared after use
        assert new_state.branching_and_feedback_data == []
        assert new_state.non_branching_feedback_data == []

    @pytest.mark.asyncio
    async def test_generate_response_handles_llm_fallback(self, monkeypatch):
        call_count = {"primary": 0, "fallback": 0}

        def fake_create_llm_client(llm_config=None, language_code=None):
            if language_code == "unsupported-lang":
                call_count["primary"] += 1
                raise ValueError("Unsupported language")
            else:
                call_count["fallback"] += 1
                return FakeLLMClient(content="fallback response")

        monkeypatch.setattr(
            "app.core.graph.nodes.create_llm_client", fake_create_llm_client
        )
        monkeypatch.setattr("app.core.graph.nodes.DEFAULT_LANGUAGE_CODE", "en-US")

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )

        prompt_data = type(
            "PD",
            (),
            {
                "name": "Test",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {
                "language_code": "unsupported-lang",
                "llm_config": None,
                "stt_config": None,
            },
        )()
        scenario = type(
            "Scenario",
            (),
            {"prompt_data": prompt_data, "language_config": language_config},
        )()
        config = {"configurable": {"scenario": scenario}}

        new_state = await generate_response(state, config=config)

        assert call_count["primary"] == 1
        assert call_count["fallback"] == 1
        assert new_state.messages[0].content == "fallback response"

    @pytest.mark.asyncio
    async def test_generate_response_without_scenario(self, monkeypatch):
        def fake_create_llm_client(llm_config=None, language_code=None):
            return FakeLLMClient(content="response without scenario")

        monkeypatch.setattr(
            "app.core.graph.nodes.create_llm_client", fake_create_llm_client
        )

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )

        # No scenario in config
        config = {"configurable": {}}

        new_state = await generate_response(state, config=config)

        assert len(new_state.messages) == 1
        assert new_state.messages[0].content == "response without scenario"

    @pytest.mark.asyncio
    async def test_generate_response_with_no_language_config(self, monkeypatch):
        # Use pre-configured LLM client (new approach)
        llm_client = FakeLLMClient(content="response in en-US")
        monkeypatch.setattr("app.core.graph.nodes.DEFAULT_LANGUAGE_CODE", "en-US")

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
        )

        prompt_data = type(
            "PD",
            (),
            {
                "name": "Test",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        # No language_config
        scenario = type(
            "Scenario", (), {"prompt_data": prompt_data, "language_config": None}
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        new_state = await generate_response(state, config=config)

        assert "en-US" in new_state.messages[0].content

    @pytest.mark.asyncio
    async def test_generate_response_preserves_state_fields(self, monkeypatch):
        # Use pre-configured LLM client (new approach)
        llm_client = FakeLLMClient(content="response")

        class FakeEvent(BaseEvent):
            async def detect_event(self, conversations):
                return False

        e1 = FakeEvent(event_id="e1")
        accumulated = [("2024-01-01T00:00:00.000Z", e1)]

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[e1],
            events_accumulator=accumulated,
            new_events=[],
            current_score=42,
            branching_and_feedback_data=[],
        )

        prompt_data = type(
            "PD",
            (),
            {
                "name": "Test",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-US", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {"prompt_data": prompt_data, "language_config": language_config},
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        new_state = await generate_response(state, config=config)

        # Verify preserved fields
        assert new_state.permitted_events == [e1]
        assert new_state.events_accumulator == accumulated
        assert new_state.current_score == 42

    @pytest.mark.asyncio
    async def test_generate_response_selects_feedback_from_branching_event(
        self, monkeypatch
    ):
        """Test that feedback is selected from branching event when available"""
        # Use pre-configured LLM client (new approach)
        llm_client = FakeLLMClient(content="response")

        probe_inst = BranchingInstruction.create("probe deeper")
        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=probe_inst,
                    feedback=EventFeedback(
                        emoji=":)", message="Great job!", show_feedback=True
                    ),
                    score=10,
                    event_id="e1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(
                        emoji=":D", message="Excellent", show_feedback=True
                    ),
                    score=15,  # Higher score but no branching instruction
                    event_id="e2",
                ),
            ],
        )

        prompt_data = type(
            "PD",
            (),
            {
                "name": "Test",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-US", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {"prompt_data": prompt_data, "language_config": language_config},
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        new_state = await generate_response(state, config=config)

        # Branching and feedback data should be cleared
        assert new_state.branching_and_feedback_data == []

    @pytest.mark.asyncio
    async def test_generate_response_selects_highest_score_feedback_when_no_branching(
        self, monkeypatch
    ):
        """Test that highest score event's feedback is selected
        when no branching events"""
        # Use pre-configured LLM client (new approach)
        llm_client = FakeLLMClient(content="response")

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(
                        emoji=":)", message="Good", show_feedback=True
                    ),
                    score=5,
                    event_id="e1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(
                        emoji=":D", message="Excellent", show_feedback=True
                    ),
                    score=15,  # Highest score
                    event_id="e2",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(
                        emoji=":(", message="Bad", show_feedback=True
                    ),
                    score=-10,  # Highest magnitude (negative)
                    event_id="e3",
                ),
            ],
        )

        prompt_data = type(
            "PD",
            (),
            {
                "name": "Test",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-US", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {"prompt_data": prompt_data, "language_config": language_config},
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        new_state = await generate_response(state, config=config)

        # Branching and feedback data should be cleared
        assert new_state.branching_and_feedback_data == []

    @pytest.mark.asyncio
    async def test_generate_response_handles_empty_feedback_message(self, monkeypatch):
        """Test that empty string is sent when feedback message is None"""
        # Use pre-configured LLM client (new approach)
        llm_client = FakeLLMClient(content="response")

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(
                        emoji=None, message=None, show_feedback=True
                    ),
                    score=10,  # Score exists but no message
                    event_id="e1",
                ),
            ],
        )

        prompt_data = type(
            "PD",
            (),
            {
                "name": "Test",
                "age": "30",
                "gender": "Male",
                "gender_identity": None,
                "sexual_orientation": None,
                "current_location": "NYC",
                "profession": None,
                "context": "Context",
                "session_behavior_guidelines": None,
                "life_history_summary": "History",
                "core_memories": None,
                "personality": None,
                "starting_state": None,
                "emotional_needs": None,
                "tone": None,
                "opening_statements": ["Hi"],
                "agent_goal": None,
                "custom_fields": None,
                "response_length": None,
                "agent_dialogues": None,
                "prompt": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-US", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {"prompt_data": prompt_data, "language_config": language_config},
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        new_state = await generate_response(state, config=config)

        # Branching and feedback data should be cleared
        assert new_state.branching_and_feedback_data == []
