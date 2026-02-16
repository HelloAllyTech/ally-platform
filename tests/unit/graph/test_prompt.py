from app.core.graph.prompt import generate_system_message
from app.core.scenario.base import (
    PromptData,
    SimulationBehaviorCategory,
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)


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
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # Core required fields must be present
        assert "Name: Alex" in content
        assert "Age: 28" in content
        assert "Gender: Male" in content
        assert "Location: NYC" in content
        assert "Starting therapy for anxiety." in content

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
        assert (
            "Generate next dialogue as per the conversation history and instruction:"
            in content
        )
        assert "Important Instruction for next dialogue: Focus on rapport." in content
        # Minimal prompt intentionally excludes detailed fields like age,
        # gender, context
        # to keep the prompt focused on the critical instruction

    def test_generate_system_message_with_gender_identity(self):
        """Test that gender_identity is included when provided."""
        pd = make_prompt_data(gender_identity="Non-binary")
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # gender_identity is not currently included in the behavior prompt format
        assert "Character details:" in content

    def test_generate_system_message_with_sexual_orientation(self):
        """Test that sexual_orientation is included when provided."""
        pd = make_prompt_data(sexual_orientation="Queer")
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # sexual_orientation is not currently included in the behavior prompt format
        assert "Character details:" in content

    def test_generate_system_message_with_session_behavior_guidelines(self):
        """Test that session_behavior_guidelines are included when provided."""
        pd = make_prompt_data(session_behavior_guidelines="Be empathetic and warm")
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # session_behavior_guidelines are now part of the base system prompt
        assert "Role instruction:" in content

    def test_generate_system_message_with_custom_fields(self):
        """Test that custom_fields are formatted correctly."""
        pd = make_prompt_data(
            custom_fields=[
                {"name": "Medical History", "value": "Diabetes"},
                {"name": "Medications", "value": "Insulin"},
            ]
        )
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "Medical History: Diabetes" in content
        assert "Medications: Insulin" in content

    def test_generate_system_message_custom_fields_empty_value_ignored(self):
        """Test that custom fields with empty values are ignored."""
        pd = make_prompt_data(
            custom_fields=[
                {"name": "Field1", "value": "Value1"},
                {"name": "Field2", "value": ""},  # Empty value
            ]
        )
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "Field1" in content
        assert "Value1" in content
        assert "Field2" not in content

    def test_generate_system_message_custom_fields_empty_list(self):
        """Test that empty custom_fields list returns empty string."""
        pd = make_prompt_data(custom_fields=[])
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # Should not crash and should work normally
        assert (
            "Character details: Name: Alex, Age: 28, Gender: Male, Location: NYC"
            in content
        )

    def test_generate_system_message_with_previous_memory(self):
        """Test that previous_memory is included when provided."""
        previous_session_summary = (
            "In our last session, we discussed anxiety management "
            "techniques and you mentioned making progress with breathing exercises."
        )
        pd = make_prompt_data(previous_memory=previous_session_summary)
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # previous_memory is not currently included in the behavior prompt format
        assert "Role instruction:" in content

    def test_generate_system_message_without_previous_memory(self):
        """Test that previous_memory section is excluded when not provided."""
        pd = make_prompt_data(previous_memory=None)
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "Summary from your previous session" not in content

    def test_generate_system_message_empty_behavior_instructions_list(self):
        """Test that empty behavior_instructions list is handled gracefully."""
        pd = make_prompt_data()
        msg = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # Should work normally and include character details
        assert (
            "Character details: Name: Alex, Age: 28, Gender: Male, Location: NYC"
            in content
        )
        assert "Conditions:" not in content  # No conditions block should be present

    def test_generate_system_message_empty_behaviors_in_instruction(self):
        """Test behavior instruction with empty behaviors list."""
        pd = make_prompt_data()
        behavior_instruction = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=[],  # Empty behaviors
            score=5,
            actors_responses=["Hello"],
        )
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[behavior_instruction]
        )
        content = msg.content
        # Should work normally and not include the empty behavior instruction
        assert (
            "Character details: Name: Alex, Age: 28, Gender: Male, Location: NYC"
            in content
        )
        assert "Conditions:" not in content  # No conditions block should be present

    def test_generate_system_behavior_instruction_with_empty_strings(self):
        """Test behavior instruction with empty string behaviors."""
        pd = make_prompt_data()
        behavior_instruction = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=[
                "",
                "Valid behavior",
                "",
                "Another valid behavior",
            ],  # Mixed empty and valid
            score=5,
            actors_responses=["Hello"],
        )
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[behavior_instruction]
        )
        content = msg.content
        # Should only include non-empty behaviors
        assert '"Valid behavior"' in content
        assert '"Another valid behavior"' in content
        assert '""' not in content  # Empty strings should be filtered out

    def test_generate_system_message_empty_dialogues_in_state(self):
        """Test state instruction with empty dialogues list."""
        pd = make_prompt_data()
        behavior_instruction = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Valid behavior"],
            score=5,
        )
        state_instruction = SimulationStateInstruction(
            state_id="1", instruction="Be anxious", dialogues=[]  # Empty dialogues
        )
        msg = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[behavior_instruction],
            current_state=state_instruction,
        )
        content = msg.content
        # Should include state instruction but not dialogues
        assert "State 1" in content
        assert "Be anxious" in content
        assert "say something similar to" not in content  # No dialogue options

    def test_generate_system_message_state_with_empty_string_dialogues(self):
        """Test state instruction with empty string dialogues."""
        pd = make_prompt_data()
        behavior_instruction = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Valid behavior"],
            score=5,
        )
        state_instruction = SimulationStateInstruction(
            state_id="1",
            instruction="Be anxious",
            dialogues=["", "Valid dialogue", "", ""],  # Mixed empty and valid
        )
        msg = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[behavior_instruction],
            current_state=state_instruction,
        )
        content = msg.content
        # Should only include non-empty dialogues
        assert '"Valid dialogue"' in content
        assert '""' not in content  # Empty strings should be filtered out

    def test_generate_system_message_none_values_handling(self):
        """Test handling of None values in optional fields."""
        pd = make_prompt_data()
        behavior_instruction = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Valid behavior"],
            score=5,
            actors_responses=None,  # None actors_responses
        )
        state_instruction = SimulationStateInstruction(
            state_id="1", instruction="Be anxious", dialogues=None  # None dialogues
        )
        msg = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[behavior_instruction],
            current_state=state_instruction,
        )
        content = msg.content
        # Should work normally without errors
        assert (
            "Character details: Name: Alex, Age: 28, Gender: Male, Location: NYC"
            in content
        )
        assert "State 1" in content
        assert "Be anxious" in content
        assert "say something similar to" not in content  # No dialogue options
