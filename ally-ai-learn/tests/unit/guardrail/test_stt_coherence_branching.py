"""
Mocked (zero-token) integration test for the STT Coherence Guard's branching.

Proves that when the gibberish guardrail fires — i.e. its actorDialogue
directive becomes ``state.next_instruction`` (as resolve_branching_instruction
would set it) — the real ``generate_response`` node + real prompt assembly
steer the actor to ASK THE COUNSELOR TO REPEAT, rather than answering the
garbled content.

No real LLM calls: the LLM is a fake that captures the messages it is given so
we can assert on the system prompt the actor would have been driven by.
"""

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.graph.nodes import generate_response
from app.core.graph.state import SimulationState

# The seeded STT Coherence Guard actorDialogue directive (kept in sync with the
# ally-be migration). When the guard fires this becomes next_instruction.
GUARD_DIRECTIVE = (
    "You could not properly follow the counselor's last message - it was either "
    "unintelligible/garbled, or it did not connect to the conversation in a way "
    "that suggests it may not have come through correctly. Stay in character and, "
    "in your own words, briefly tell them you didn't quite catch that and ask "
    "them to repeat or rephrase. Do not attempt to answer, guess at, or act on "
    "the unclear content, and do not change the subject to follow it."
)

GIBBERISH_UTTERANCE = "you too fly the carrot meeting under nine"


class CapturingLLM:
    """Fake LLM that records the messages it was asked to complete."""

    def __init__(self, content: str = "actor reply"):
        self._content = content
        self.captured_messages = None

    async def ainvoke(self, messages):
        self.captured_messages = messages
        return AIMessage(self._content)


class CapturingLLMClient:
    def __init__(self, llm: CapturingLLM):
        self._llm = llm

    @property
    def llm_instance(self):
        return self._llm


def _scenario_stub():
    prompt_data = type(
        "PD",
        (),
        {
            "name": "Asha",
            "age": "29",
            "gender": "Female",
            "gender_identity": None,
            "sexual_orientation": None,
            "current_location": "Pune",
            "profession": None,
            "context": "Recently lost her job and is anxious about money.",
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
        },
    )()
    language_config = type(
        "LanguageConfig",
        (),
        {"language_code": "hi-IN", "llm_config": None, "stt_config": None},
    )()
    return type(
        "Scenario",
        (),
        {
            "prompt_data": prompt_data,
            "language_config": language_config,
            "behavior_instructions": [],
            "state_instructions": None,
        },
    )()


def _state(next_instruction):
    return SimulationState(
        messages=[
            HumanMessage(content="I lost my job last month and I'm stressed."),
            AIMessage(content="That sounds really hard. How are you coping?"),
            HumanMessage(content=GIBBERISH_UTTERANCE),
        ],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
        next_instruction=next_instruction,
    )


def _system_text(captured_messages) -> str:
    """Concatenate the content of the system message(s) sent to the LLM."""
    parts = []
    for m in captured_messages or []:
        role = getattr(m, "type", getattr(m, "role", ""))
        if role == "system" or m.__class__.__name__ == "SystemMessage":
            parts.append(str(m.content))
    return "\n".join(parts)


class TestSttCoherenceGuardBranching:
    @pytest.mark.asyncio
    async def test_guard_directive_steers_actor_to_ask_for_repeat(self):
        llm = CapturingLLM(content="Sorry, I didn't catch that — could you repeat?")
        config = {
            "configurable": {
                "scenario": _scenario_stub(),
                "llm_client": CapturingLLMClient(llm),
            }
        }

        result = await generate_response(_state(GUARD_DIRECTIVE), config=config)

        # The directive reached the actor's system prompt: it is told to ask the
        # counselor to repeat/rephrase and NOT to act on the garbled content.
        system_text = _system_text(llm.captured_messages)
        assert "repeat or rephrase" in system_text
        assert "didn't quite catch" in system_text
        assert "do not change the subject to follow it" in system_text

        # Even though the directive itself is English (we no longer translate
        # guardrails), the actor is still instructed to reply in the session
        # language (hi-IN here) — so an English directive does not leak an
        # English reply.
        assert "hi-IN" in system_text

        # The node returns the actor reply and resets the consumed instruction.
        assert result["messages"][0].content == (
            "Sorry, I didn't catch that — could you repeat?"
        )
        assert result["next_instruction"] is None

    @pytest.mark.asyncio
    async def test_without_guard_no_clarification_directive_in_prompt(self):
        """Contrast: with no next_instruction the actor is not told to clarify,
        proving the guard's directive is what injects the ask-to-repeat
        behavior."""
        llm = CapturingLLM()
        config = {
            "configurable": {
                "scenario": _scenario_stub(),
                "llm_client": CapturingLLMClient(llm),
            }
        }

        await generate_response(_state(None), config=config)

        system_text = _system_text(llm.captured_messages)
        assert "repeat or rephrase" not in system_text
        assert "didn't quite catch" not in system_text
