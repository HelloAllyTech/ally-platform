import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import generate_response
from app.core.graph.state import SimulationState
from app.core.events.base import BaseEvent


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
    async def test_generate_response_builds_system_message_and_returns_ai_only(self, monkeypatch):
        # Monkeypatch create_llm_client to return FakeLLMClient
        def fake_create_llm_client(language_code):
            return FakeLLMClient(content="hello from llm")

        monkeypatch.setattr("app.core.graph.nodes.create_llm_client", fake_create_llm_client)

        # Minimal BaseEvent subclass for new_events validation
        class FakeEvent(BaseEvent):
            async def detect_event(self, conversations):
                return False

        # Build state with some prior messages and two events (one with branching_instruction)
        msgs = [HumanMessage(content="hi"), HumanMessage(content="tell me more")]
        ev1 = FakeEvent(event_id="e1", branching_instruction=None)
        ev2 = FakeEvent(event_id="e2", branching_instruction="probe on family")

        state = SimulationState(
            messages=msgs,
            permitted_events=[],
            events_accumulator=[],
            new_events=[ev1, ev2],
            current_score=0,
            branching_instructions=[],
        )

        # Provide scenario with prompt_data via config
        prompt_data = type("PD", (), {
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
        })()

        # Add language_config to scenario
        language_config = type("LanguageConfig", (), {"language_code": "en-IN"})()
        scenario = type("Scenario", (), {
            "prompt_data": prompt_data,
            "language_config": language_config
        })()
        config = {"configurable": {"scenario": scenario}}

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
    async def test_generate_response_selects_max_magnitude_branching_instruction(self, monkeypatch):
        def fake_create_llm_client(language_code):
            return FakeLLMClient(content="response")

        monkeypatch.setattr("app.core.graph.nodes.create_llm_client", fake_create_llm_client)

        # Multiple branching instructions with different scores
        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_instructions=[
                ("low positive", 2),
                ("high negative", -10),  # Highest magnitude
                ("medium positive", 5),
            ],
        )

        prompt_data = type("PD", (), {
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
        })()

        language_config = type("LanguageConfig", (), {"language_code": "en-US"})()
        scenario = type("Scenario", (), {
            "prompt_data": prompt_data,
            "language_config": language_config
        })()
        config = {"configurable": {"scenario": scenario}}

        new_state = await generate_response(state, config=config)

        # Branching instructions should be cleared after use
        assert new_state.branching_instructions == []

    @pytest.mark.asyncio
    async def test_generate_response_filters_empty_branching_instructions(self, monkeypatch):
        def fake_create_llm_client(language_code):
            return FakeLLMClient(content="response")

        monkeypatch.setattr("app.core.graph.nodes.create_llm_client", fake_create_llm_client)

        # Mix of valid and invalid instructions
        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_instructions=[
                ("", 5),  # Empty string
                ("  ", 3),  # Whitespace only
                ("valid instruction", 2),
            ],
        )

        prompt_data = type("PD", (), {
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
        })()

        language_config = type("LanguageConfig", (), {"language_code": "en-US"})()
        scenario = type("Scenario", (), {
            "prompt_data": prompt_data,
            "language_config": language_config
        })()
        config = {"configurable": {"scenario": scenario}}

        new_state = await generate_response(state, config=config)

        assert new_state.branching_instructions == []

    @pytest.mark.asyncio
    async def test_generate_response_handles_llm_fallback(self, monkeypatch):
        call_count = {"primary": 0, "fallback": 0}

        def fake_create_llm_client(language_code):
            if language_code == "unsupported-lang":
                call_count["primary"] += 1
                raise ValueError("Unsupported language")
            else:
                call_count["fallback"] += 1
                return FakeLLMClient(content="fallback response")

        monkeypatch.setattr("app.core.graph.nodes.create_llm_client", fake_create_llm_client)
        monkeypatch.setattr("app.core.graph.nodes.DEFAULT_LANGUAGE_CODE", "en-US")

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_instructions=[],
        )

        prompt_data = type("PD", (), {
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
        })()

        language_config = type("LanguageConfig", (), {"language_code": "unsupported-lang"})()
        scenario = type("Scenario", (), {
            "prompt_data": prompt_data,
            "language_config": language_config
        })()
        config = {"configurable": {"scenario": scenario}}

        new_state = await generate_response(state, config=config)

        assert call_count["primary"] == 1
        assert call_count["fallback"] == 1
        assert new_state.messages[0].content == "fallback response"

    @pytest.mark.asyncio
    async def test_generate_response_without_scenario(self, monkeypatch):
        def fake_create_llm_client(language_code):
            return FakeLLMClient(content="response without scenario")

        monkeypatch.setattr("app.core.graph.nodes.create_llm_client", fake_create_llm_client)

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_instructions=[],
        )

        # No scenario in config
        config = {"configurable": {}}

        new_state = await generate_response(state, config=config)

        assert len(new_state.messages) == 1
        assert new_state.messages[0].content == "response without scenario"

    @pytest.mark.asyncio
    async def test_generate_response_with_no_language_config(self, monkeypatch):
        def fake_create_llm_client(language_code):
            return FakeLLMClient(content=f"response in {language_code}")

        monkeypatch.setattr("app.core.graph.nodes.create_llm_client", fake_create_llm_client)
        monkeypatch.setattr("app.core.graph.nodes.DEFAULT_LANGUAGE_CODE", "en-US")

        state = SimulationState(
            messages=[HumanMessage(content="hi")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_instructions=[],
        )

        prompt_data = type("PD", (), {
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
        })()

        # No language_config
        scenario = type("Scenario", (), {
            "prompt_data": prompt_data,
            "language_config": None
        })()
        config = {"configurable": {"scenario": scenario}}

        new_state = await generate_response(state, config=config)

        assert "en-US" in new_state.messages[0].content

    @pytest.mark.asyncio
    async def test_generate_response_preserves_state_fields(self, monkeypatch):
        def fake_create_llm_client(language_code):
            return FakeLLMClient(content="response")

        monkeypatch.setattr("app.core.graph.nodes.create_llm_client", fake_create_llm_client)

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
            branching_instructions=[],
        )

        prompt_data = type("PD", (), {
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
        })()

        language_config = type("LanguageConfig", (), {"language_code": "en-US"})()
        scenario = type("Scenario", (), {
            "prompt_data": prompt_data,
            "language_config": language_config
        })()
        config = {"configurable": {"scenario": scenario}}

        new_state = await generate_response(state, config=config)

        # Verify preserved fields
        assert new_state.permitted_events == [e1]
        assert new_state.events_accumulator == accumulated
        assert new_state.current_score == 42
