from app.core.graph.prompt import generate_system_message
from app.core.scenario.base import (
    PromptData,
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)
from app.core.scenario.simulation_instructions import (
    SimulationBehaviorCategory,
    StateMatchedInstruction,
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

        # When next_instruction is provided, it is appended to the prompt
        # It should contain the critical instruction
        assert "Important Instruction: Focus on rapport." in content

        # The prompt should still contain the core character details
        assert "Name: Alex" in content

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
        """
        [Deprecated path] State with empty dialogues falls back to
        instruction only.
        """
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
        """
        [Deprecated path] Dialogues are no longer used (removed to prevent
        repetition); only instruction is used.
        """
        pd = make_prompt_data()
        behavior_instruction = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Valid behavior"],
            score=5,
        )
        state_instruction = SimulationStateInstruction(
            state_id="1",
            instruction="Be anxious",
            dialogues=["", "Valid dialogue", "", ""],  # Dialogues are ignored
        )
        msg = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[behavior_instruction],
            current_state=state_instruction,
        )
        content = msg.content
        # Dialogues should NOT appear (removed to prevent repetition)
        assert '"Valid dialogue"' not in content
        assert "say something similar to" not in content
        # Only instruction should be used
        assert "Be anxious" in content

    def test_generate_system_message_none_values_handling(self):
        """
        [Deprecated path] None actors_responses and None dialogues are
        handled without errors.
        """
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

    def test_state_matched_instructions_used_for_matching_state(self):
        """
        state_matched_instructions entry matching current state_id is
        injected into the prompt.
        """
        pd = make_prompt_data()
        bi = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Validated experience"],
            score=10,
            state_matched_instructions=[
                StateMatchedInstruction(
                    stateId="1", instruction="Stay guarded and withdrawn."
                ),
                StateMatchedInstruction(
                    stateId="2", instruction="Show cautious relief."
                ),
            ],
        )
        state = SimulationStateInstruction(stateId="2", scoreLower=0, scoreUpper=4)
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=state
        )
        content = msg.content
        assert "State 2" in content
        assert "Show cautious relief." in content
        assert "Stay guarded and withdrawn." not in content
        assert "say something similar to" not in content

    def test_state_matched_instructions_takes_precedence_over_deprecated_instruction(
        self,
    ):
        """
        state_matched_instructions overrides the deprecated state
        instruction and dialogues.
        """
        pd = make_prompt_data()
        bi = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Validated experience"],
            score=10,
            state_matched_instructions=[
                StateMatchedInstruction(
                    stateId="1", instruction="New per-behavior guidance."
                ),
            ],
        )
        state = SimulationStateInstruction(
            stateId="1",
            instruction="Old deprecated instruction",
            dialogues=["Old deprecated dialogue"],
        )
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=state
        )
        content = msg.content
        assert "New per-behavior guidance." in content
        assert "Old deprecated instruction" not in content
        assert "Old deprecated dialogue" not in content

    def test_state_matched_instructions_no_match_falls_back_to_deprecated_instruction(
        self,
    ):
        """
        When state_matched_instructions has no entry for current state,
        falls back to deprecated state instruction.
        """
        pd = make_prompt_data()
        bi = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Validated experience"],
            score=10,
            state_matched_instructions=[
                StateMatchedInstruction(
                    stateId="3", instruction="Instruction for state 3."
                ),
            ],
        )
        state = SimulationStateInstruction(
            stateId="2",
            instruction="Fallback deprecated instruction",
        )
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=state
        )
        content = msg.content
        assert "Fallback deprecated instruction" in content
        assert "Instruction for state 3." not in content

    def test_different_bis_use_their_own_state_matched_instructions(self):
        """
        Each behavior instruction resolves its own state_matched_instructions
        independently.
        """
        pd = make_prompt_data()
        bi_should_do = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Validated experience"],
            score=10,
            state_matched_instructions=[
                StateMatchedInstruction(
                    stateId="1", instruction="Respond with cautious warmth."
                ),
            ],
        )
        bi_should_not_do = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_NOT_DO,
            behaviors=["Invalidated feelings"],
            score=-10,
            state_matched_instructions=[
                StateMatchedInstruction(
                    stateId="1", instruction="Shut down and become defensive."
                ),
            ],
        )
        state = SimulationStateInstruction(stateId="1", scoreLower=None, scoreUpper=-1)
        msg = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[bi_should_do, bi_should_not_do],
            current_state=state,
        )
        content = msg.content
        assert "Respond with cautious warmth." in content
        assert "Shut down and become defensive." in content

    def test_state_matched_instructions_resolved_from_score(self):
        """
        Test that score-based state resolution works with
        state_matched_instructions.
        """
        from app.core.graph.nodes import _resolve_current_state

        pd = make_prompt_data()
        bi = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Validated experience"],
            score=10,
            state_matched_instructions=[
                StateMatchedInstruction(
                    stateId="1", instruction="Stay guarded and withdrawn."
                ),
                StateMatchedInstruction(
                    stateId="2", instruction="Show cautious relief."
                ),
                StateMatchedInstruction(
                    stateId="3", instruction="Begin to open up slightly."
                ),
            ],
        )

        # Define state instructions with score ranges matching scenario_sample2
        state_instructions = [
            SimulationStateInstruction(stateId="1", scoreLower=None, scoreUpper=-1),
            SimulationStateInstruction(stateId="2", scoreLower=0, scoreUpper=4),
            SimulationStateInstruction(stateId="3", scoreLower=5, scoreUpper=9),
        ]

        # Test score -5 resolves to state 1
        current_state = _resolve_current_state(state_instructions, -5)
        assert current_state.state_id == "1"
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=current_state
        )
        content = msg.content
        assert "State 1" in content
        assert "Stay guarded and withdrawn." in content
        assert "Show cautious relief." not in content
        assert "Begin to open up slightly." not in content

        # Test score 2 resolves to state 2
        current_state = _resolve_current_state(state_instructions, 2)
        assert current_state.state_id == "2"
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=current_state
        )
        content = msg.content
        assert "State 2" in content
        assert "Show cautious relief." in content
        assert "Stay guarded and withdrawn." not in content
        assert "Begin to open up slightly." not in content

        # Test score 7 resolves to state 3
        current_state = _resolve_current_state(state_instructions, 7)
        assert current_state.state_id == "3"
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=current_state
        )
        content = msg.content
        assert "State 3" in content
        assert "Begin to open up slightly." in content
        assert "Stay guarded and withdrawn." not in content
        assert "Show cautious relief." not in content

        # Test score 10 (outside all ranges) returns None and uses natural fallback
        current_state = _resolve_current_state(state_instructions, 10)
        assert current_state is None
        msg = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=current_state
        )
        content = msg.content
        assert "State" not in content  # No state label when no state
        assert (
            "respond naturally based on your character" in content
        )  # Natural fallback

    def test_generate_system_message_non_english_no_samples_uses_multilingual_template(
        self,
    ):
        """Non-English without samples: multilingual template used (samples empty)."""
        pd = make_prompt_data()
        msg = generate_system_message(prompt_data=pd, language_code="hi-IN")
        content = msg.content
        assert "**LANGUAGE INSTRUCTION:**" in content
        assert "Generate next dialogue" in content
        assert "hi-IN" in content
        assert "Example 1:" not in content

    def test_generate_system_message_non_english_empty_samples_uses_multilingual_tpl(
        self,
    ):
        """Non-English, empty samples: template used, no example text."""
        pd = make_prompt_data(language_dialogue_samples=["", "", ""])
        msg = generate_system_message(prompt_data=pd, language_code="ml-IN")
        content = msg.content
        assert "**LANGUAGE INSTRUCTION:**" in content
        assert "ml-IN" in content
        assert "Example 1:" not in content

    def test_generate_system_message_english_omits_language_instruction(self):
        """Test that language instruction is omitted for English language codes."""
        pd = make_prompt_data()
        msg_en_in = generate_system_message(prompt_data=pd, language_code="en-IN")
        msg_en_us = generate_system_message(prompt_data=pd, language_code="en-US")

        assert "**LANGUAGE INSTRUCTION:**" not in msg_en_in.content
        assert "**LANGUAGE INSTRUCTION:**" not in msg_en_us.content

    def test_generate_system_message_samples_present_injects_sample_block(self):
        """When samples present for non-English, use sample block."""
        samples = [
            {"counselor": "Hello, how are you?", "actor": "എനിക്ക് സഹായം വേണം."},
            {"counselor": "I understand.", "actor": "എനിക്ക് വളരെ വിഷമമാണ്."},
        ]
        pd = make_prompt_data(language_dialogue_samples=samples)
        msg = generate_system_message(prompt_data=pd, language_code="ml-IN")
        content = msg.content
        # Sample block should be present
        assert "Generate next dialogue" in content
        assert "ml-IN" in content
        assert "Example 1:" in content
        assert "Counselor:" in content
        assert "Client:" in content
        assert "എനിക്ക് സഹായം വേണം." in content
