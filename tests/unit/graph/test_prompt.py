from types import SimpleNamespace

from app.core.graph.prompt import generate_system_message
from app.core.scenario.base import VoicePromptData


def make_prompt_data(**overrides):
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
    )
    base.update(overrides)
    return VoicePromptData(**base)


class TestPrompt:
    def test_generate_system_message_basic_includes_core_fields(self):
        pd = make_prompt_data()
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        # Core required fields must be present
        assert "Your name" in content and "Alex" in content
        assert "Your age" in content and "28" in content
        assert "Your gender" in content and "Male" in content
        assert "Your current location" in content and "NYC" in content
        assert "Your current context" in content and "Starting therapy for anxiety." in content
        assert "Summary of your life's history" in content and "Grew up in a small town" in content

    def test_generate_system_message_optional_blocks_and_next_instruction(self):
        pd = make_prompt_data(
            profession="Engineer",
            session_behavior_guidelines="Be concise.",
            core_memories="Childhood move.",
            personality="Introvert",
            starting_state="Nervous",
            emotional_needs="Validation",
            tone="Calm",
            gender_identity="Non-binary",
            sexual_orientation="Queer",
        )
        msg = generate_system_message(prompt_data=pd, next_instruction="Focus on rapport.")
        content = msg.content

        # Optional sections
        for text in [
            "Your profession",
            "How will you behave in this session",
            "Your core memories influencing your beliefs & actions",
            "Your personality",
            "Your current thoughts",
            "Your emotional needs from this counselling session",
            "Your talking stye/tone",
            "Your gender identity:",
            "Your sexual orientation:",
            "CRITICAL INSTRUCTION FOR YOUR NEXT REPLY",
            "Focus on rapport.",
        ]:
            assert text in content
