import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import generate_response
from app.core.graph.state import SimulationState


class FakeCapturingLLM:
    """Captures the messages actually sent to the LLM for assertion."""

    def __init__(self, content: str = "OK"):
        self._content = content
        self.received_messages = None

    async def ainvoke(self, messages):
        self.received_messages = messages
        return AIMessage(self._content)


class FakeCapturingLLMClient:
    def __init__(self, content: str = "OK"):
        self._llm_instance = FakeCapturingLLM(content)

    @property
    def llm_instance(self):
        return self._llm_instance


def _make_prompt_data(**overrides):
    fields = {
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
        "previous_memory": None,
        "competency": None,
        "language_dialogue_samples": None,
    }
    fields.update(overrides)
    return type("PD", (), fields)()


def _make_scenario(language_code: str, prompt_data=None):
    language_config = type(
        "LanguageConfig",
        (),
        {"language_code": language_code, "llm_config": None, "stt_config": None},
    )()
    return type(
        "Scenario",
        (),
        {
            "prompt_data": prompt_data or _make_prompt_data(),
            "language_config": language_config,
            "behavior_instructions": [],
            "state_instructions": None,
        },
    )()


class TestGenerateResponseCompressedInput:
    """compress_input's output must reach the LLM prompt but must never
    mutate state.messages — transcripts/event detection/behavior
    detection/scoring all read state.messages and must keep seeing the
    original, uncompressed text."""

    @pytest.mark.asyncio
    async def test_compressed_input_used_in_prompt_but_never_mutates_history(self):
        llm_client = FakeCapturingLLMClient(content="reply")

        original_text = "यह एक लंबा वाक्य है जिसे संपीड़ित किया जाना चाहिए"
        state = SimulationState(
            messages=[HumanMessage(content=original_text)],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            compressed_input="compressed summary",
        )

        config = {
            "configurable": {
                "scenario": _make_scenario("hi-IN"),
                "llm_client": llm_client,
            }
        }

        result = await generate_response(state, config=config)

        assert isinstance(result, dict)
        # The SimulationState passed in must be byte-for-byte unchanged.
        assert isinstance(state.messages[-1], HumanMessage)
        assert state.messages[-1].content == original_text

        # But the LLM actually received the compressed text.
        sent = llm_client.llm_instance.received_messages
        assert sent is not None
        assert sent[-1].content == "compressed summary"

        # compressed_input is cleared in the return dict for state hygiene.
        assert result["compressed_input"] is None

    @pytest.mark.asyncio
    async def test_no_compressed_input_sends_original_text(self):
        llm_client = FakeCapturingLLMClient(content="reply")
        original_text = "hello there"
        state = SimulationState(
            messages=[HumanMessage(content=original_text)],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            compressed_input=None,
        )

        config = {
            "configurable": {
                "scenario": _make_scenario("en-US"),
                "llm_client": llm_client,
            }
        }

        await generate_response(state, config=config)

        sent = llm_client.llm_instance.received_messages
        assert sent is not None
        assert sent[-1].content == original_text
