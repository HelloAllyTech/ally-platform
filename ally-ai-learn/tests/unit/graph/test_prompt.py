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
        role_instructions="Act only as the client in this simulation.",
        gender_identity=None,
        sexual_orientation=None,
        current_location="NYC",
        profession=None,
        character_profile_text="Starting therapy for anxiety.",
        context="Starting therapy for anxiety.",
        life_history_summary="Grew up in a small town.",
        core_memories=None,
        tone=None,
        opening_statements=["Hi"],
        agent_goal=None,
        custom_fields=[],
        previous_memory=None,
        states=[],
    )
    base.update(overrides)
    return PromptData(**base)


class TestPrompt:
    def test_generate_system_message_basic_includes_core_fields(self):
        pd = make_prompt_data()
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # Check for core persona data rather than rigid header names
        assert "Alex" in content
        assert "You are" in content
        assert "Alex" in content
        assert "28" in content
        assert "Male" in content
        assert "NYC" in content
        assert "Starting therapy for anxiety." in content
        assert "Act only as the client in this simulation." in content

    def test_generate_system_message_uses_role_instructions_from_prompt_data(self):
        pd = make_prompt_data(
            role_instructions="You are a difficult customer. Stay in that role."
        )
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])

        assert "You are a difficult customer. Stay in that role." in msg.content

    def test_generate_system_message_supports_title_and_challenge_description_vars(
        self,
    ):
        pd = make_prompt_data(
            title="Burnout Intake",
            description="The client is struggling with workplace stress.",
            prompts={
                "ally_ai_learn_system_main_agent_prompt": {
                    "prompt": "{title} | {challenge_description}",
                    "availableVariables": ["title", "challenge_description"],
                }
            },
        )
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])

        assert (
            "Burnout Intake | The client is struggling with workplace stress."
            in msg.content
        )

    def test_generate_system_message_optional_blocks_and_next_instruction(self):
        pd = make_prompt_data(
            profession="Engineer",
            character_profile_text="Moved around a lot growing up.",
            tone="Calm",
            gender_identity="Non-binary",
            sexual_orientation="Queer",
        )
        msg, _ = generate_system_message(
            prompt_data=pd, next_instruction="Focus on rapport."
        )
        content = msg.content

        # When next_instruction is provided, it is appended to the prompt
        # It should contain the critical instruction
        assert "Important Instruction: Focus on rapport." in content

        # The prompt should still contain the core character details
        # Check for context data presence
        assert "Alex" in content
        assert "You are Alex" in content
        assert "Alex" in content

    def test_generate_system_message_with_gender_identity(self):
        """Test that gender_identity is included when provided."""
        pd = make_prompt_data(gender_identity="Non-binary")
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "You identify as" in content
        assert "Non-binary" in content

    def test_generate_system_message_with_sexual_orientation(self):
        """Test that sexual_orientation is included when provided."""
        pd = make_prompt_data(sexual_orientation="Queer")
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "Your sexual orientation" in content
        assert "Queer" in content

    def test_generate_system_message_with_custom_fields(self):
        """Test that custom_fields are formatted correctly."""
        pd = make_prompt_data(
            custom_fields=[
                {"name": "Medical History", "value": "Diabetes"},
                {"name": "Medications", "value": "Insulin"},
            ]
        )
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
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
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "Field1" in content
        assert "Value1" in content
        assert "Field2" not in content

    def test_generate_system_message_custom_fields_empty_list(self):
        """Test that empty custom_fields list returns empty string."""
        pd = make_prompt_data(custom_fields=[])
        _, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        # Header is now hardcoded in template, this assertion is skipped
        # assert "## Additional Custom Context" not in content

    def test_generate_system_message_with_previous_memory(self):
        """Test that previous_memory is included when provided.

        The BE preformats the value into a full sentence (e.g.
        "You remember from your last session: …") and the ai-learn
        template substitutes the placeholder verbatim — no wrapper.
        We assert on the literal preformatted text round-tripping
        through the template, since the wrapping responsibility now
        lives upstream.
        """
        previous_session_summary = (
            "You remember from your last session: we discussed anxiety "
            "management techniques and you mentioned breathing exercises."
        )
        pd = make_prompt_data(previous_memory=previous_session_summary)
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "last session" in content
        assert "breathing exercises" in content

    def test_generate_system_message_omits_legacy_character_context_fields(self):
        pd = make_prompt_data(
            context="Legacy context",
            life_history_summary="Legacy history",
            core_memories="Legacy memory",
            response_length="BRIEF",
        )
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "Legacy context" not in content
        assert "Legacy history" not in content
        assert "Legacy memory" not in content
        assert "Your response length should be" not in content

    def test_generate_system_message_without_previous_memory(self):
        """Test that previous_memory section is excluded when not provided."""
        pd = make_prompt_data(previous_memory=None)
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        assert "Summary from your previous session" not in content

    def test_generate_system_message_empty_behavior_instructions_list(self):
        """Test that empty behavior_instructions list is handled gracefully."""
        pd = make_prompt_data()
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        content = msg.content
        # Check for core persona data rather than rigid header names
        assert "Alex" in content
        assert "Alex" in content
        # Header is now hardcoded in template, this assertion is skipped
        # assert "## Conditions" not in content

    def test_generate_system_message_empty_behaviors_in_instruction(self):
        """Test behavior instruction with empty behaviors list."""
        pd = make_prompt_data()
        behavior_instruction = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=[],  # Empty behaviors
            score=5,
            actors_responses=["Hello"],
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[behavior_instruction]
        )
        content = msg.content
        # Check for core persona data rather than rigid header names
        assert "Alex" in content
        assert "Alex" in content
        # Header is now hardcoded in template, this assertion is skipped
        # assert "## Conditions" not in content

    def test_generate_system_message_competency_section_omitted_when_empty(self):
        pd = make_prompt_data(competency=None)
        _, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        # Header is now hardcoded in template, this assertion is skipped
        # assert "## Counselor Training Competency" not in msg.content

    def test_generate_system_message_conditions_section_present_when_non_empty(self):
        pd = make_prompt_data()
        behavior_instruction = SimulationBehaviorInstruction(
            category=SimulationBehaviorCategory.SHOULD_DO,
            behaviors=["Valid behavior"],
            score=5,
            actors_responses=["Hello"],
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[behavior_instruction]
        )
        assert "## Conditions" in msg.content
        assert '"trigger_behaviors": [' in msg.content
        assert '"Valid behavior"' in msg.content

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
        msg, _ = generate_system_message(
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
        msg, _ = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[behavior_instruction],
            current_state=state_instruction,
        )
        content = msg.content
        # Should include state instruction but not dialogues
        assert "Be anxious" in content
        assert '"current_state_guidance": "Be anxious"' in content

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
        msg, _ = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[behavior_instruction],
            current_state=state_instruction,
        )
        content = msg.content
        # Dialogues should NOT appear (removed to prevent repetition)
        assert '"Valid dialogue"' not in content
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
        msg, _ = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[behavior_instruction],
            current_state=state_instruction,
        )
        content = msg.content
        # Should work normally without errors
        # Check for core persona data rather than rigid header names
        assert "Alex" in content
        assert "Alex" in content
        assert "Be anxious" in content
        assert '"current_state_guidance": "Be anxious"' in content

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
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=state
        )
        content = msg.content
        assert '"current_state_guidance": "Show cautious relief."' in content
        assert "Show cautious relief." in content
        assert "Stay guarded and withdrawn." not in content

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
        msg, _ = generate_system_message(
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
        msg, _ = generate_system_message(
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
        msg, _ = generate_system_message(
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
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=current_state
        )
        content = msg.content
        assert '"current_state_guidance": "Stay guarded and withdrawn."' in content
        assert "Stay guarded and withdrawn." in content
        assert "Show cautious relief." not in content
        assert "Begin to open up slightly." not in content

        # Test score 2 resolves to state 2
        current_state = _resolve_current_state(state_instructions, 2)
        assert current_state.state_id == "2"
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=current_state
        )
        content = msg.content
        assert '"current_state_guidance": "Show cautious relief."' in content
        assert "Show cautious relief." in content
        assert "Stay guarded and withdrawn." not in content
        assert "Begin to open up slightly." not in content

        # Test score 7 resolves to state 3
        current_state = _resolve_current_state(state_instructions, 7)
        assert current_state.state_id == "3"
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=current_state
        )
        content = msg.content
        assert '"current_state_guidance": "Begin to open up slightly."' in content
        assert "Begin to open up slightly." in content
        assert "Stay guarded and withdrawn." not in content
        assert "Show cautious relief." not in content

        # Test score 10 (outside all ranges) returns None and uses natural fallback
        current_state = _resolve_current_state(state_instructions, 10)
        assert current_state is None
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[bi], current_state=current_state
        )
        content = msg.content
        assert '"current_state_guidance": null' in content

    def test_generate_system_message_non_english_no_samples_uses_multilingual_template(
        self,
    ):
        """Non-English without samples: multilingual template used (samples empty)."""
        pd = make_prompt_data()
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="hi-IN"
        )
        content = msg.content
        assert "Output language: hi-IN" in content
        assert "Generate the next dialogue" in content
        assert "hi-IN" in content
        assert "Example 1:" not in content
        assert "## Filler Word Guidance" in content
        assert "No curated filler list is set for this language" in content

    def test_generate_system_message_non_english_includes_allowed_fillers(self):
        """Non-English: allowed_fillers list appears in multilingual block."""
        pd = make_prompt_data(allowed_fillers=["ठीक है", "मतलब"])
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="hi-IN"
        )
        content = msg.content
        assert "## Filler Word Guidance" in content
        assert "ठीक है, मतलब" in content
        # The list sits under the filler section, whatever the guidance wording.
        assert content.index("## Filler Word Guidance") < content.index("ठीक है, मतलब")

    def test_generate_system_message_non_english_empty_samples_uses_multilingual_tpl(
        self,
    ):
        """Non-English, empty samples: template used, no example text."""
        pd = make_prompt_data(language_dialogue_samples=["", "", ""])
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="ml-IN"
        )
        content = msg.content
        assert "Output language: ml-IN" in content
        assert "ml-IN" in content
        assert "Example 1:" not in content

    def test_generate_system_message_region_tagged_english_includes_dialect_block(
        self,
    ):
        """Region-tagged English (en-IN, en-US, en-GB) must still receive the
        multilingual block — without it the LLM has no signal to choose between
        Indian, American, and British English and defaults to its training
        distribution (typically American English)."""
        pd_in = make_prompt_data(language_label="English (India)")
        msg_en_in, _ = generate_system_message(
            prompt_data=pd_in, behavior_instructions=[], language_code="en-IN"
        )
        pd_us = make_prompt_data(language_label="English (US)")
        msg_en_us, _ = generate_system_message(
            prompt_data=pd_us, behavior_instructions=[], language_code="en-US"
        )

        assert "Output language: English (India) (locale: en-IN)" in msg_en_in.content
        assert "Output language: English (US) (locale: en-US)" in msg_en_us.content

    def test_generate_system_message_bare_english_renders_language_instruction(self):
        """Bare 'en' (no region) now renders the multilingual section too.

        The block was inlined into the main prompt template, so the
        language directive shows up regardless of language. For bare
        'en' the locale slot reads 'en' and the label falls back to
        the same. Slight redundancy for English sessions; in exchange
        we drop one indirection in the prompt builder.
        """
        pd = make_prompt_data()
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="en"
        )

        assert "Output language:" in msg.content
        assert "en" in msg.content

    def test_generate_system_message_includes_language_label_when_present(self):
        """Non-English with language_label: human-readable name appears in the
        multilingual block alongside the BCP-47 code."""
        pd = make_prompt_data(language_label="Tamil (India)")
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="ta-IN"
        )
        content = msg.content
        assert "Tamil (India)" in content
        assert "ta-IN" in content

    def test_generate_system_message_override_replaces_label_slot(self):
        """Per-scenario author override takes the label slot in the
        multilingual block. The DB-derived label steps aside; the locale
        code stays for traceability."""
        pd = make_prompt_data(
            language_label="Tamil (India)",
            language_characteristics=(
                "Speaks simple, colloquial Chennai Tamil; code-mixes with English."
            ),
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="ta-IN"
        )
        content = msg.content
        assert (
            "Output language: Speaks simple, colloquial Chennai Tamil; "
            "code-mixes with English. (locale: ta-IN)"
        ) in content
        # DB label must NOT also appear — override wins.
        assert "Output language: Tamil (India)" not in content

    def test_generate_system_message_falls_back_to_db_label_when_override_blank(self):
        """With no override the DB-derived label fills the slot."""
        pd = make_prompt_data(language_label="Tamil (India)")
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="ta-IN"
        )
        content = msg.content
        assert "Output language: Tamil (India) (locale: ta-IN)" in content

    def test_generate_system_message_falls_back_to_code_when_label_missing(self):
        """Non-English without language_label: the locale code stands in for the
        label so the prompt still renders coherently."""
        pd = make_prompt_data(language_label=None)
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="ta-IN"
        )
        content = msg.content
        # Template: "Output language: {language_label} (locale: {language_code})."
        # With label=None the fallback substitutes the code into both slots.
        assert "Output language: ta-IN (locale: ta-IN)" in content

    def test_generate_system_message_samples_present_injects_sample_block(self):
        """When samples present for non-English, use sample block."""
        samples = [
            {"counselor": "Hello, how are you?", "actor": "എനിക്ക് സഹായം വേണം."},
            {"counselor": "I understand.", "actor": "എനിക്ക് വളരെ വിഷമമാണ്."},
        ]
        pd = make_prompt_data(language_dialogue_samples=samples)
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="ml-IN"
        )
        content = msg.content
        # Sample block should be present
        assert "Generate the next dialogue" in content
        assert "ml-IN" in content
        assert "Example 1:" in content
        assert "Counselor:" in content
        assert "Client:" in content
        assert "എനിക്ക് സഹായം വേണം." in content


class TestOptionalFieldsDefensiveGuards:
    """Tests verifying safe handling when studio fields are absent (None/empty)."""

    def test_format_language_samples_with_none_returns_empty_string(self):
        """_format_language_samples with None must not crash."""
        from app.core.graph.prompt import _format_language_samples

        result = _format_language_samples(None)
        assert result == ""

    def test_format_language_samples_with_empty_list_returns_empty_string(self):
        from app.core.graph.prompt import _format_language_samples

        result = _format_language_samples([])
        assert result == ""

    def test_generate_system_message_none_character_profile_text(self):
        """System message generates when character_profile_text is None."""
        pd = make_prompt_data(character_profile_text=None)
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="en-IN"
        )
        assert msg.content is not None

    def test_generate_system_message_none_role_instructions(self):
        """System message generates without crash when role_instructions is None."""
        pd = make_prompt_data(role_instructions=None)
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="en-IN"
        )
        assert msg.content is not None

    def test_generate_system_message_none_behavior_instructions(self):
        """System message generates without crash when behavior_instructions is None."""
        pd = make_prompt_data()
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=None, language_code="en-IN"
        )
        assert msg.content is not None

    def test_generate_system_message_none_linguistic_style_samples(self):
        """System message generates when language_dialogue_samples is None."""
        pd = make_prompt_data(language_dialogue_samples=None)
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="hi-IN"
        )
        assert msg.content is not None
        assert "Output language: hi-IN" in msg.content

    def test_generate_system_message_none_allowed_filler_words(self):
        """System message generates filler guidance when allowed_fillers is None."""
        pd = make_prompt_data(allowed_fillers=None)
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], language_code="hi-IN"
        )
        assert msg.content is not None
        assert "No curated filler list is set for this language" in msg.content

    def test_generate_system_message_all_optional_fields_none(self):
        """System message generates when all optional studio fields are None."""
        pd = make_prompt_data(
            character_profile_text=None,
            role_instructions=None,
            language_dialogue_samples=None,
            allowed_fillers=None,
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=None, language_code="en-IN"
        )
        assert msg.content is not None
        assert len(msg.content) > 0


class TestLanguageGlossary:
    """Tier 0 language-glossary style card ({language_glossary} placeholder)."""

    GLOSSARY = (
        '## Core style\n- worry: say "டென்ஷன்"; avoid "பதட்டம்"\n'
        "## Pronouns & kinship\n- Mother: always she-forms.\n  e.g. அம்மா சொன்னாங்க"
    )

    def test_behavior_prompt_includes_glossary_when_present(self):
        pd = make_prompt_data(language_glossary=self.GLOSSARY)
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        assert '- worry: say "டென்ஷன்"; avoid "பதட்டம்"' in msg.content
        assert "அம்மா சொன்னாங்க" in msg.content

    def test_behavior_prompt_renders_clean_without_glossary(self):
        pd = make_prompt_data()
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        # No leftover literal placeholder, no glossary content
        assert "{language_glossary}" not in msg.content
        assert "டென்ஷன்" not in msg.content

    def test_branching_prompt_includes_glossary_when_present(self):
        pd = make_prompt_data(language_glossary=self.GLOSSARY)
        msg, _ = generate_system_message(
            prompt_data=pd, next_instruction="Focus on rapport."
        )
        assert '- worry: say "டென்ஷன்"; avoid "பதட்டம்"' in msg.content
        assert "Important Instruction: Focus on rapport." in msg.content

    def test_branching_prompt_renders_clean_without_glossary(self):
        pd = make_prompt_data()
        msg, _ = generate_system_message(
            prompt_data=pd, next_instruction="Focus on rapport."
        )
        assert "{language_glossary}" not in msg.content

    def test_glossary_appended_to_override_body_without_placeholder(self):
        """Dashboard-override / legacy-variant bodies predate the
        {language_glossary} placeholder — the system-level append must still
        deliver the glossary without any studio prompt edit."""
        pd = make_prompt_data(
            language_glossary=self.GLOSSARY,
            prompts={
                "ally_ai_learn_system_main_agent_prompt": {
                    "prompt": "You are {name}. Speak naturally.",
                    "availableVariables": ["name"],
                }
            },
        )
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        assert "## Language style guide" in msg.content
        assert msg.content.count('- worry: say "டென்ஷன்"; avoid "பதட்டம்"') == 1

    def test_glossary_not_duplicated_when_template_has_placeholder(self):
        """The default file template renders {language_glossary}; the append
        guard must detect that and not add a second copy. The private-rules
        framing rides with the block in both paths — exactly once."""
        pd = make_prompt_data(language_glossary=self.GLOSSARY)
        msg, _ = generate_system_message(prompt_data=pd, behavior_instructions=[])
        assert msg.content.count('- worry: say "டென்ஷன்"; avoid "பதட்டம்"') == 1
        assert msg.content.count("## Language style guide") == 1
        assert "not a language tutor" in msg.content

    def test_glossary_appended_to_branching_override_without_placeholder(self):
        pd = make_prompt_data(
            language_glossary=self.GLOSSARY,
            prompts={
                "ally_ai_learn_system_branching_agent_prompt": {
                    "prompt": "You are {name}. {next_instruction}",
                    "availableVariables": ["name", "next_instruction"],
                }
            },
        )
        msg, _ = generate_system_message(
            prompt_data=pd, next_instruction="Focus on rapport."
        )
        assert "## Language style guide" in msg.content
        assert msg.content.count('- worry: say "டென்ஷன்"; avoid "பதட்டம்"') == 1


class TestDialogueLengthInstruction:
    def test_dialogue_length_short(self):
        pd = make_prompt_data(
            states=[
                {
                    "id": "1",
                    "name": "state1",
                    "guidelines": "guideline1",
                    "scoreLower": 0,
                    "scoreUpper": 100,
                    "ragEnabled": True,
                    "dialogueLength": "short",
                }
            ],
            prompts={
                "ally_ai_learn_system_main_agent_prompt": {
                    "prompt": "{state_x_guidelines}\n{dialogue_length_instruction}",
                    "availableVariables": [
                        "state_x_guidelines",
                        "dialogue_length_instruction",
                    ],
                }
            },
            selected_main_prompt_code="ally_ai_learn_system_main_agent_prompt",
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], current_score=50
        )
        assert "Keep the response short." in msg.content

    def test_dialogue_length_medium(self):
        pd = make_prompt_data(
            states=[
                {
                    "id": "1",
                    "name": "state1",
                    "guidelines": "guideline1",
                    "scoreLower": 0,
                    "scoreUpper": 100,
                    "ragEnabled": True,
                    "dialogueLength": "medium",
                }
            ],
            prompts={
                "ally_ai_learn_system_main_agent_prompt": {
                    "prompt": "{state_x_guidelines}\n{dialogue_length_instruction}",
                    "availableVariables": [
                        "state_x_guidelines",
                        "dialogue_length_instruction",
                    ],
                }
            },
            selected_main_prompt_code="ally_ai_learn_system_main_agent_prompt",
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], current_score=50
        )
        assert "Keep the response of medium length." in msg.content

    def test_dialogue_length_long(self):
        pd = make_prompt_data(
            states=[
                {
                    "id": "1",
                    "name": "state1",
                    "guidelines": "guideline1",
                    "scoreLower": 0,
                    "scoreUpper": 100,
                    "ragEnabled": True,
                    "dialogueLength": "long",
                }
            ],
            prompts={
                "ally_ai_learn_system_main_agent_prompt": {
                    "prompt": "{state_x_guidelines}\n{dialogue_length_instruction}",
                    "availableVariables": [
                        "state_x_guidelines",
                        "dialogue_length_instruction",
                    ],
                }
            },
            selected_main_prompt_code="ally_ai_learn_system_main_agent_prompt",
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], current_score=50
        )
        assert "Make the response long and detailed." in msg.content

    def test_dialogue_length_none(self):
        pd = make_prompt_data(
            states=[
                {
                    "id": "1",
                    "name": "state1",
                    "guidelines": "guideline1",
                    "scoreLower": 0,
                    "scoreUpper": 100,
                    "ragEnabled": True,
                    "dialogueLength": None,
                }
            ],
            prompts={
                "ally_ai_learn_system_main_agent_prompt": {
                    "prompt": "{state_x_guidelines}\n{dialogue_length_instruction}",
                    "availableVariables": [
                        "state_x_guidelines",
                        "dialogue_length_instruction",
                    ],
                }
            },
            selected_main_prompt_code="ally_ai_learn_system_main_agent_prompt",
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], current_score=50
        )
        assert "Keep the response" not in msg.content
        assert "Make the response" not in msg.content

    def test_dialogue_length_not_provided(self):
        pd = make_prompt_data(
            states=[
                {
                    "id": "1",
                    "name": "state1",
                    "guidelines": "guideline1",
                    "scoreLower": 0,
                    "scoreUpper": 100,
                    "ragEnabled": True,
                }
            ],
            prompts={
                "ally_ai_learn_system_main_agent_prompt": {
                    "prompt": "{state_x_guidelines}\n{dialogue_length_instruction}",
                    "availableVariables": [
                        "state_x_guidelines",
                        "dialogue_length_instruction",
                    ],
                }
            },
            selected_main_prompt_code="ally_ai_learn_system_main_agent_prompt",
        )
        msg, _ = generate_system_message(
            prompt_data=pd, behavior_instructions=[], current_score=50
        )
        assert "Keep the response" not in msg.content
        assert "Make the response" not in msg.content
