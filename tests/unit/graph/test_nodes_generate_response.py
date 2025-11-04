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


class TestGenerateResponse:
    @pytest.mark.asyncio
    async def test_generate_response_builds_system_message_and_returns_ai_only(self, monkeypatch):
        # Monkeypatch ChatOpenAI constructor to return FakeLLM
        def fake_ctor(model, temperature, api_key):
            return FakeLLM(content="hello from llm")

        monkeypatch.setattr("app.core.graph.nodes.ChatOpenAI", fake_ctor)

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

        scenario = type("Scenario", (), {"prompt_data": prompt_data})()
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
