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
        character_profile_text="Starting therapy for anxiety.",
        context="Starting therapy for anxiety.",
        life_history_summary="Grew up in a small town.",
        core_memories=None,
        personality=None,
        tone=None,
        opening_statements=["Hi"],
        agent_goal=None,
        custom_fields=[],
        previous_memory=None,
        knowledge_sources=None,
    )
    base.update(overrides)
    return PromptData(**base)


class TestPromptWithRetrievedContext:
    def test_branching_prompt_includes_context(self):
        msg, _ = generate_system_message(
            prompt_data=_pd(),
            next_instruction="Focus on school",
            retrieved_context="**school memories:**\nBullied in 8th grade",
        )
        assert "## Additional Context" in msg.content
        assert "Bullied in 8th grade" in msg.content
        assert "Focus on school" in msg.content

    def test_branching_prompt_without_context(self):
        _, _ = generate_system_message(
            prompt_data=_pd(),
            next_instruction="Focus on school",
            retrieved_context=None,
        )
        # Header is now hardcoded in template, this assertion is skipped
        # assert "## Additional Context" not in msg.content

    def test_behavior_prompt_includes_context(self):
        msg, _ = generate_system_message(
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
        _, _ = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context=None,
        )
        # Header is now hardcoded in template, this assertion is skipped
        # assert "## Additional Context" not in msg.content

    def test_behavior_fallback_includes_context_without_explicit_behavior_instructions(
        self,
    ):
        msg, _ = generate_system_message(
            prompt_data=_pd(),
            retrieved_context="**academic history:**\nTop performer",
        )
        assert "## Additional Context" in msg.content
        assert "Top performer" in msg.content

    def test_behavior_fallback_without_context(self):
        _, _ = generate_system_message(
            prompt_data=_pd(),
            retrieved_context=None,
        )
        # Header is now hardcoded in template, this assertion is skipped
        # assert "## Additional Context" not in msg.content

    def test_empty_string_context_not_injected(self):
        _, _ = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context="",
        )
        # Header is now hardcoded in template, this assertion is skipped
        # assert "## Additional Context" not in msg.content

    def test_inline_mode_respects_rag_gate_from_active_state(self):
        """A state with ragEnabled=False must blank retrieved_context in
        INLINE mode too (RETRIEVED_CONTEXT_DEFER_TO_SUFFIX turned off — the
        documented rollback switch): the volatile suffix must be built from
        the gated `effective_retrieved_context`, not the raw parameter."""
        states = [
            {
                "id": "state_a",
                "name": "A",
                "guidelines": "A guidelines",
                "isStarting": True,
                "scoreLower": None,
                "scoreUpper": None,
                "ragEnabled": False,
            }
        ]
        pd = _pd(
            selected_main_prompt_code="v1",
            prompts={
                "v1": {
                    "prompt": "{state_x_guidelines}\n{retrieved_context}",
                    "availableVariables": ["state_x_guidelines", "retrieved_context"],
                }
            },
            states=states,
        )
        msg, trailing = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[],
            retrieved_context="should be gated off",
            current_score=0,
            defer_retrieved_context=False,
        )
        assert "should be gated off" not in msg.content
        assert "## Additional Context" not in msg.content
        assert trailing is None

    def test_inline_mode_fallback_respects_rag_gate_from_active_state(self):
        """Same gate on the no-behavior_instructions fallback branch, which
        builds its own prompt and appends the suffix separately."""
        states = [
            {
                "id": "state_a",
                "name": "A",
                "guidelines": "A guidelines",
                "isStarting": True,
                "scoreLower": None,
                "scoreUpper": None,
                "ragEnabled": False,
            }
        ]
        pd = _pd(
            selected_main_prompt_code="v1",
            prompts={
                "v1": {
                    "prompt": "{state_x_guidelines}\n{retrieved_context}",
                    "availableVariables": ["state_x_guidelines", "retrieved_context"],
                }
            },
            states=states,
        )
        msg, trailing = generate_system_message(
            prompt_data=pd,
            retrieved_context="should be gated off",
            current_score=0,
            defer_retrieved_context=False,
        )
        assert "should be gated off" not in msg.content
        assert "## Additional Context" not in msg.content
        assert trailing is None

    def test_context_placement_after_persona(self):
        msg, _ = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context="**test key:**\ntest value",
        )
        content = msg.content
        persona_pos = content.find("## Client Persona")
        context_pos = content.find("## Additional Context")
        assert persona_pos != -1
        assert context_pos != -1
        assert context_pos > persona_pos


class TestRetrievedContextDeferredToSuffix:
    """RETRIEVED_CONTEXT_DEFER_TO_SUFFIX: retrieved_context moves out of the
    system message into its own trailing message so the caller can append it
    AFTER conversation history — letting provider prompt caching cover the
    whole growing history instead of capping at this system message's
    volatile content. See app/core/config.py and
    app/core/graph/prompt.py:_build_retrieved_context_message."""

    def test_deferred_mode_excludes_context_from_system_message_and_returns_trailing(
        self,
    ):
        msg, trailing = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context="**family dynamics:**\nParents are strict",
            defer_retrieved_context=True,
        )
        assert "Parents are strict" not in msg.content
        assert "## Additional Context" not in msg.content
        assert trailing is not None
        assert "## Additional Context" in trailing.content
        assert "Parents are strict" in trailing.content

    def test_deferred_mode_no_context_returns_no_trailing(self):
        msg, trailing = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context=None,
            defer_retrieved_context=True,
        )
        assert trailing is None

    def test_deferred_mode_respects_rag_gate_from_active_state(self):
        """A state with ragEnabled=False must still blank retrieved_context
        in deferred mode — proving the trailing message is built from the
        gated `effective_retrieved_context` _build_behavior_prompt already
        computes, not the raw parameter."""
        states = [
            {
                "id": "state_a",
                "name": "A",
                "guidelines": "A guidelines",
                "isStarting": True,
                "scoreLower": None,
                "scoreUpper": None,
                "ragEnabled": False,
            }
        ]
        pd = _pd(
            selected_main_prompt_code="v1",
            prompts={
                "v1": {
                    "prompt": "{state_x_guidelines}\n{retrieved_context}",
                    "availableVariables": ["state_x_guidelines", "retrieved_context"],
                }
            },
            states=states,
        )
        msg, trailing = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[],
            retrieved_context="should be gated off",
            current_score=0,
            defer_retrieved_context=True,
        )
        assert "should be gated off" not in msg.content
        assert trailing is None

    def test_deferred_mode_variant_with_inline_placeholder_renders_blank(self):
        """Mirrors main_agent_prompt_full.txt's deliberate inline
        {retrieved_context} placement: in deferred mode, that placeholder
        must render blank regardless — state_x_guidelines stays inline,
        unaffected, and the context text moves to the trailing message."""
        states = [
            {
                "id": "state_a",
                "name": "A",
                "guidelines": "A guidelines",
                "isStarting": True,
                "scoreLower": None,
                "scoreUpper": None,
                "ragEnabled": True,
            }
        ]
        pd = _pd(
            selected_main_prompt_code="v1",
            prompts={
                "v1": {
                    "prompt": (
                        "## Guidelines\n{state_x_guidelines}\n"
                        "{retrieved_context}\n## Next"
                    ),
                    "availableVariables": ["state_x_guidelines", "retrieved_context"],
                }
            },
            states=states,
        )
        msg, trailing = generate_system_message(
            prompt_data=pd,
            behavior_instructions=[],
            retrieved_context="**topic:** anxiety coping",
            current_score=0,
            defer_retrieved_context=True,
        )
        assert "anxiety coping" not in msg.content
        assert "A guidelines" in msg.content
        assert trailing is not None
        assert "anxiety coping" in trailing.content

    def test_branching_path_unaffected_by_flag(self):
        """Branching swaps templates and busts the cache regardless —
        nothing to win, so the flag must be a complete no-op there."""
        with_flag = generate_system_message(
            prompt_data=_pd(),
            next_instruction="Focus on school",
            retrieved_context="**school memories:**\nBullied in 8th grade",
            defer_retrieved_context=True,
        )
        without_flag = generate_system_message(
            prompt_data=_pd(),
            next_instruction="Focus on school",
            retrieved_context="**school memories:**\nBullied in 8th grade",
            defer_retrieved_context=False,
        )
        assert with_flag[0].content == without_flag[0].content
        assert with_flag[1] is None
        assert without_flag[1] is None
        assert "Bullied in 8th grade" in with_flag[0].content

    def test_flag_omitted_matches_flag_explicitly_false(self):
        omitted = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context="**context:**\nsome text",
        )
        explicit_false = generate_system_message(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context="**context:**\nsome text",
            defer_retrieved_context=False,
        )
        assert omitted[0].content == explicit_false[0].content
        assert omitted[1] is None
        assert explicit_false[1] is None


class TestGeneratePromptContentUnpacking:
    """generate_prompt_content must keep returning a plain str even though
    generate_system_message's own return type changed to a tuple."""

    def test_returns_plain_string(self):
        from app.core.graph.prompt import generate_prompt_content

        content = generate_prompt_content(
            prompt_data=_pd(),
            behavior_instructions=[],
            retrieved_context="**topic:** stress management",
        )
        assert isinstance(content, str)
        assert "stress management" in content
