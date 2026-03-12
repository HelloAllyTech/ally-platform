from app.core.graph.prompt import generate_system_message
from app.core.scenario.base import PromptData, SimulationBehaviorInstruction
from app.core.scenario.simulation_instructions import SimulationBehaviorCategory


def _pd(**overrides):
    base = dict(
        name="Alex",
        age="28",
        gender="Male",
        gender_identity=None,
        sexual_orientation=None,
        current_location="NYC",
        profession=None,
        context="Starting therapy for anxiety.",
        session_behavior_guidelines=None,
        life_history_summary="Grew up in a small town.",
        core_memories=None,
        personality=None,
        starting_state=None,
        emotional_needs=None,
        tone=None,
        opening_statements=["Hi"],
        agent_goal=None,
        custom_fields=[],
        previous_memory=None,
        knowledge_base=None,
    )
    base.update(overrides)
    return PromptData(**base)


class TestPromptWithRetrievedContext:
    def test_branching_prompt_includes_context(self):
        msg = generate_system_message(
            prompt_data=_pd(),
            next_instruction="Focus on school",
            retrieved_context="**school memories:**\nBullied in 8th grade",
        )
        assert "## Additional Context" in msg.content
        assert "Bullied in 8th grade" in msg.content
        assert "Focus on school" in msg.content

    def test_branching_prompt_without_context(self):
        msg = generate_system_message(
            prompt_data=_pd(),
            next_instruction="Focus on school",
            retrieved_context=None,
        )
        assert "## Additional Context" not in msg.content

    def test_behavior_prompt_includes_context(self):
        msg = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[
                SimulationBehaviorInstruction(
                    category=SimulationBehaviorCategory.SHOULD_DO,
                    behaviors=["Validated feelings"],
                    score=10,
                    actors_responses=["I feel understood"],
                )
            ],
            retrieved_context="**family dynamics:**\nParents are strict",
        )
        assert "## Additional Context" in msg.content
        assert "Parents are strict" in msg.content

    def test_behavior_prompt_without_context(self):
        msg = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context=None,
        )
        assert "## Additional Context" not in msg.content

    def test_full_prompt_includes_context(self):
        msg = generate_system_message(
            prompt_data=_pd(),
            retrieved_context="**academic history:**\nTop performer",
        )
        assert "## Additional Context" in msg.content
        assert "Top performer" in msg.content

    def test_full_prompt_without_context(self):
        msg = generate_system_message(
            prompt_data=_pd(),
            retrieved_context=None,
        )
        assert "## Additional Context" not in msg.content

    def test_empty_string_context_not_injected(self):
        msg = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context="",
        )
        assert "## Additional Context" not in msg.content

    def test_context_placement_after_persona(self):
        msg = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context="**test key:**\ntest value",
        )
        content = msg.content
        persona_pos = content.find("## Your Client Persona Details")
        context_pos = content.find("## Additional Context")
        assert persona_pos != -1
        assert context_pos != -1
        assert context_pos > persona_pos
