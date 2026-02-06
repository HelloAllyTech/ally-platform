from app.core.graph.prompt import generate_system_message
from app.core.scenario.base import PromptData


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
        custom_fields=[],
        previous_memory=None,
    )
    base.update(overrides)
    return PromptData(**base)


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
        assert (
            "Your current context" in content
            and "Starting therapy for anxiety." in content
        )
        assert (
            "your life history is" in content and "Grew up in a small town" in content
        )

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
        msg = generate_system_message(
            prompt_data=pd, next_instruction="Focus on rapport."
        )
        content = msg.content

        # When next_instruction is provided, minimal prompt is used
        # It should contain the critical instruction and essential details only
        assert "<CRITICAL_INSTRUCTION>" in content
        assert "Focus on rapport." in content
        assert "<SYSTEM>" in content
        assert pd.name in content
        # Minimal prompt intentionally excludes detailed fields like age,
        # gender, context
        # to keep the prompt focused on the critical instruction

    def test_generate_system_message_with_gender_identity(self):
        """Test that gender_identity is included when provided."""
        pd = make_prompt_data(gender_identity="Non-binary")
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        assert "Your gender identity" in content
        assert "Non-binary" in content

    def test_generate_system_message_with_sexual_orientation(self):
        """Test that sexual_orientation is included when provided."""
        pd = make_prompt_data(sexual_orientation="Queer")
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        assert "Your sexual orientation" in content
        assert "Queer" in content

    def test_generate_system_message_with_session_behavior_guidelines(self):
        """Test that session_behavior_guidelines are included when provided."""
        pd = make_prompt_data(session_behavior_guidelines="Be empathetic and warm")
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        assert "How will you behave in this session" in content
        assert "Be empathetic and warm" in content

    def test_generate_system_message_with_custom_fields(self):
        """Test that custom_fields are formatted correctly."""
        pd = make_prompt_data(
            custom_fields=[
                {"name": "Medical History", "value": "Diabetes"},
                {"name": "Medications", "value": "Insulin"},
            ]
        )
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        assert "Medical History" in content
        assert "Diabetes" in content
        assert "Medications" in content
        assert "Insulin" in content

    def test_generate_system_message_custom_fields_empty_value_ignored(self):
        """Test that custom fields with empty values are ignored."""
        pd = make_prompt_data(
            custom_fields=[
                {"name": "Field1", "value": "Value1"},
                {"name": "Field2", "value": ""},  # Empty value
            ]
        )
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        assert "Field1" in content
        assert "Value1" in content
        assert "Field2" not in content

    def test_generate_system_message_custom_fields_empty_list(self):
        """Test that empty custom_fields list returns empty string."""
        pd = make_prompt_data(custom_fields=[])
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        # Should not crash and should work normally
        assert "Your name" in content

    def test_generate_system_message_with_previous_memory(self):
        """Test that previous_memory is included when provided."""
        previous_session_summary = (
            "In our last session, we discussed anxiety management "
            "techniques and you mentioned making progress with breathing exercises."
        )
        pd = make_prompt_data(previous_memory=previous_session_summary)
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        assert "Summary from your previous session" in content
        assert previous_session_summary in content

    def test_generate_system_message_without_previous_memory(self):
        """Test that previous_memory section is excluded when not provided."""
        pd = make_prompt_data(previous_memory=None)
        msg = generate_system_message(prompt_data=pd)
        content = msg.content
        assert "Summary from your previous session" not in content
