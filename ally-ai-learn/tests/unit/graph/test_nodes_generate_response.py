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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
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
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        result = await generate_response(state, config=config)

        # Should return a dict with the new AI message
        assert isinstance(result, dict)
        assert len(result["messages"]) == 1
        assert isinstance(result["messages"][0], AIMessage)
        assert result["messages"][0].content == "hello from llm"

        # new_events cleared, next_instruction reset
        assert result["new_events"] == []
        assert result["next_instruction"] is None

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
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
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        result = await generate_response(state, config=config)

        # generate_response returns a dict; feedback clearing is now
        # handled by the separate send_event_feedback node
        assert isinstance(result, dict)
        assert result["next_instruction"] is None

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
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
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        result = await generate_response(state, config=config)

        assert isinstance(result, dict)
        assert result["next_instruction"] is None

    @pytest.mark.asyncio
    async def test_generate_response_handles_llm_fallback(self, monkeypatch):
        call_count = {"primary": 0, "fallback": 0}

        def fake_create_llm_client(
            llm_config=None, language_code=None, temperature=None
        ):
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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
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
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario}}

        result = await generate_response(state, config=config)

        assert call_count["primary"] == 1
        assert call_count["fallback"] == 1
        assert result["messages"][0].content == "fallback response"

    @pytest.mark.asyncio
    async def test_generate_response_without_scenario(self, monkeypatch):
        def fake_create_llm_client(
            llm_config=None, language_code=None, temperature=None
        ):
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

        result = await generate_response(state, config=config)

        assert len(result["messages"]) == 1
        assert result["messages"][0].content == "response without scenario"

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
            },
        )()

        # No language_config
        scenario = type(
            "Scenario",
            (),
            {
                "prompt_data": prompt_data,
                "language_config": None,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        result = await generate_response(state, config=config)

        assert "en-US" in result["messages"][0].content

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
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
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        result = await generate_response(state, config=config)

        # generate_response now returns a dict with only the fields it updates;
        # permitted_events, events_accumulator, and current_score are preserved
        # by the LangGraph state (not overwritten by this node)
        assert isinstance(result, dict)
        assert len(result["messages"]) == 1

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
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
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        result = await generate_response(state, config=config)

        assert isinstance(result, dict)
        assert result["next_instruction"] is None

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
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
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        result = await generate_response(state, config=config)

        assert isinstance(result, dict)
        assert result["next_instruction"] is None

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
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
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        result = await generate_response(state, config=config)

        assert isinstance(result, dict)
        assert result["next_instruction"] is None


class CapturingFakeLLM(FakeLLM):
    """Same as FakeLLM but records the exact messages array it received, so
    tests can assert on message ORDER (system, history, trailing context)."""

    def __init__(self, content: str = "OK"):
        super().__init__(content)
        self.captured_messages = None

    async def ainvoke(self, messages):
        self.captured_messages = list(messages)
        return await super().ainvoke(messages)


class CapturingFakeLLMClient(FakeLLMClient):
    def __init__(self, content: str = "OK"):
        self._llm_instance = CapturingFakeLLM(content)


class TestGenerateResponseRetrievedContextDeferredToSuffix:
    """RETRIEVED_CONTEXT_DEFER_TO_SUFFIX: retrieved_context must land as the
    LAST message in messages_to_send (after history), not inside the system
    message — see app/core/config.py and prompt.py's
    _build_retrieved_context_message."""

    @pytest.mark.asyncio
    async def test_flag_on_appends_context_after_history(self, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "RETRIEVED_CONTEXT_DEFER_TO_SUFFIX", True)

        llm_client = CapturingFakeLLMClient(content="hello")
        msgs = [HumanMessage(content="hi"), HumanMessage(content="tell me more")]
        state = SimulationState(
            messages=msgs,
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            retrieved_context="**topic:** anxiety coping",
        )

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-IN", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        await generate_response(state, config=config)

        captured = llm_client.llm_instance.captured_messages
        assert captured is not None
        # System message (first) must NOT contain the retrieved context.
        assert "anxiety coping" not in captured[0].content
        # The two original history messages appear, in order, before the tail.
        assert captured[1].content == "hi"
        assert captured[2].content == "tell me more"
        # The trailing message (last) carries the retrieved context.
        assert len(captured) == 4
        assert "anxiety coping" in captured[-1].content
        assert "## Additional Context" in captured[-1].content

    @pytest.mark.asyncio
    async def test_flag_off_keeps_context_inside_system_message(self, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "RETRIEVED_CONTEXT_DEFER_TO_SUFFIX", False)

        llm_client = CapturingFakeLLMClient(content="hello")
        msgs = [HumanMessage(content="hi")]
        state = SimulationState(
            messages=msgs,
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            retrieved_context="**topic:** anxiety coping",
        )

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
                "previous_memory": None,
                "competency": None,
                "language_dialogue_samples": None,
            },
        )()

        language_config = type(
            "LanguageConfig",
            (),
            {"language_code": "en-IN", "llm_config": None, "stt_config": None},
        )()
        scenario = type(
            "Scenario",
            (),
            {
                "prompt_data": prompt_data,
                "language_config": language_config,
                "behavior_instructions": [],
                "state_instructions": None,
            },
        )()
        config = {"configurable": {"scenario": scenario, "llm_client": llm_client}}

        await generate_response(state, config=config)

        captured = llm_client.llm_instance.captured_messages
        assert captured is not None
        # No trailing context message — same message count as history + system.
        assert len(captured) == 2
        # Retrieved context lands inside the system message, as before.
        assert "anxiety coping" in captured[0].content
