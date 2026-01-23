"""
Tests for variable substitution in BranchingInstruction.
"""

from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.branching_instructions.constants import ReservedBranchingVariable
from app.core.graph import SimulationState


class TestVariableSubstitution:
    """Tests for static variable substitution logic."""

    def test_build_substitution_map(self):
        """Test extraction of variables from prompt_data."""
        prompt_data = {
            "context": "Customer support scenario",
            "customFields": [
                {"field": "user_name", "value": "Alice"},
                {"field": "account_type", "value": "Premium"},
                {"field": "  spaced_key  ", "value": "trimmed_value"},
                {"field": "empty_val", "value": ""},  # Should be ignored
                {"field": "", "value": "no_key"},  # Should be ignored
            ],
        }

        expected_map = {
            "your context": "Customer support scenario",
            "user_name": "Alice",
            "account_type": "Premium",
            "spaced_key": "trimmed_value",
        }

        result = BranchingInstruction._build_substitution_map(prompt_data)
        assert result == expected_map

    def test_build_substitution_map_empty(self):
        """Test with empty prompt_data."""
        prompt_data = {}
        result = BranchingInstruction._build_substitution_map(prompt_data)
        assert result == {}

    def test_resolve_static_variables(self):
        """Test string substitution logic."""
        content = "Hello <user_name>, welcome to <your context>. Status: <status>."
        tags = ["user_name", "your context", "status"]
        substitution_map = {
            "user_name": "Bob",
            "your context": "Support",
            "other": "unused",
        }

        expected_content = "Hello Bob, welcome to Support. Status: <status>."
        expected_unresolved = ["status"]

        updated_content, unresolved = BranchingInstruction._resolve_static_variables(
            content, tags, substitution_map
        )

        assert updated_content == expected_content
        assert unresolved == expected_unresolved

    def test_create_with_substitution_success(self):
        """Test full flow: create with prompt_data substitutes variables."""
        instruction = (
            "Hello <user_name>, context: <your context>."
            " Dynamic: <last_helper_utterance>"
        )
        prompt_data = {
            "context": "Sales Call",
            "customFields": [{"field": "user_name", "value": "Charlie"}],
        }

        bi = BranchingInstruction.create(instruction, prompt_data)

        # Check content has been substituted
        assert (
            bi.content
            == "Hello Charlie, context: Sales Call. Dynamic: <last_helper_utterance>"
        )

        # Check tags lists
        assert "user_name" in bi.variable_tags
        assert "your context" in bi.variable_tags
        assert "last_helper_utterance" in bi.variable_tags

        # Static tags should now only contain unresolved ones (none in this case)
        # Wait, the implementation returns unresolved tags as static_tags.
        # Let's check the code:
        # final_content, unresolved_tags = cls._resolve_static_variables(...)
        # static_tags=unresolved_tags
        assert bi.static_tags == []

        assert bi.dynamic_tags == ["last_helper_utterance"]

    def test_create_with_partial_substitution(self):
        """Test full flow: create with partial prompt_data."""
        instruction = "Hello <user_name>, age <age>."
        prompt_data = {"customFields": [{"field": "user_name", "value": "Dave"}]}

        bi = BranchingInstruction.create(instruction, prompt_data)

        assert bi.content == "Hello Dave, age <age>."
        assert bi.static_tags == ["age"]  # 'age' remains unresolved

    def test_create_without_prompt_data(self):
        """Test full flow: create without prompt_data (should behave as before)."""
        instruction = "Hello <user_name>"

        bi = BranchingInstruction.create(instruction)

        assert bi.content == "Hello <user_name>"
        assert bi.static_tags == ["user_name"]

    @pytest.mark.asyncio
    async def test_resolve_dynamic_branching_instruction_substitution(self, mocker):
        """Should substitute LAST_HELPER_UTTERANCE with actual last Human message."""
        # Mock chat summary resolution to isolate the test
        mocker.patch(
            "app.core.branching_instructions.base.resolve_chat_summary",
            new_callable=AsyncMock,
        )

        # 1. Setup State
        state = SimulationState(
            messages=[
                AIMessage(content="System prompt"),
                HumanMessage(content="I am the helper user"),
            ],
            permitted_events=[],
            events_accumulator=[],
            current_score=0,
            new_events=[],
            branching_and_feedback_data=[],
        )

        instruction = BranchingInstruction(
            # FIX: No extra angle brackets needed if Enum value already has them
            content=f"Repeat: "
            f"<{ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value}>",
            variable_tags=[],
            static_tags=[],
            # Parser usually strips brackets for the list, so this is correct
            dynamic_tags=["last_helper_utterance"],
        )

        # 3. Execute
        result = await instruction.resolve_dynamic_branching_instruction(
            state.messages, "en-US"
        )

        # 4. Assert
        assert result == "Repeat: I am the helper user"

    @pytest.mark.asyncio
    async def test_resolve_dynamic_branching_instruction_missing_history(self, mocker):
        """Should return raw instruction if tag exists but no Human history exists."""
        # Mock chat summary resolution to isolate the test
        mocker.patch(
            "app.core.branching_instructions.base.resolve_chat_summary",
            new_callable=AsyncMock,
        )

        state = SimulationState(
            messages=[AIMessage(content="Only AI here")],
            permitted_events=[],
            events_accumulator=[],
            current_score=0,
            new_events=[],
            branching_and_feedback_data=[],
        )

        instruction = BranchingInstruction(
            content=f"Recall:"
            f" <{ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value}>",
            variable_tags=[],
            static_tags=[],
            dynamic_tags=["last_helper_utterance"],
        )

        result = await instruction.resolve_dynamic_branching_instruction(
            state.messages, "en-US"
        )

        # Should fallback to the original string gracefully
        assert (
            result
            == f"Recall: <{ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value}>"
        )

    @pytest.mark.asyncio
    async def test_resolve_dynamic_chat_summary(self, mocker):
        """Should substitute <chat_summary> by calling the resolver."""
        # 1. Arrange
        mock_resolver = mocker.patch(
            "app.core.branching_instructions.base.resolve_chat_summary",
            new_callable=AsyncMock,
            # Make it pass the content through but with the tag replaced
            side_effect=lambda content, **kwargs: content.replace(
                f"<{ReservedBranchingVariable.CHAT_SUMMARY.value}>", "Mocked Summary"
            ),
        )
        messages = [HumanMessage(content="Some history")]

        instruction = BranchingInstruction(
            content=f"Summary: <{ReservedBranchingVariable.CHAT_SUMMARY.value}>",
            variable_tags=[ReservedBranchingVariable.CHAT_SUMMARY.value],
            static_tags=[],
            dynamic_tags=[ReservedBranchingVariable.CHAT_SUMMARY.value],
        )

        # 2. Act
        result = await instruction.resolve_dynamic_branching_instruction(
            messages=messages, language_code="en-US", llm_config={"provider": "test"}
        )

        # 3. Assert
        assert result == "Summary: Mocked Summary"
        mock_resolver.assert_awaited_once_with(
            content=instruction.content,
            messages=messages,
            language_code="en-US",
            llm_config={"provider": "test"},
        )

    @pytest.mark.asyncio
    async def test_resolve_dynamic_all_tags(self, mocker):
        """Should substitute all dynamic tags in one call."""
        # 1. Arrange
        mock_summary_resolver = mocker.patch(
            "app.core.branching_instructions.base.resolve_chat_summary",
            new_callable=AsyncMock,
            side_effect=lambda content, **kwargs: content.replace(
                f"<{ReservedBranchingVariable.CHAT_SUMMARY.value}>", "Mocked Summary"
            ),
        )
        messages = [
            AIMessage(content="First AI message"),
            HumanMessage(content="This is the last helper utterance"),
        ]

        instruction_content = (
            f"Utterance: <{ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value}>. "
            f"Summary: <{ReservedBranchingVariable.CHAT_SUMMARY.value}>"
        )

        instruction = BranchingInstruction(
            content=instruction_content,
            variable_tags=[
                ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value,
                ReservedBranchingVariable.CHAT_SUMMARY.value,
            ],
            static_tags=[],
            dynamic_tags=[
                ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value,
                ReservedBranchingVariable.CHAT_SUMMARY.value,
            ],
        )

        # 2. Act
        result = await instruction.resolve_dynamic_branching_instruction(
            messages=messages, language_code="en-US", llm_config={"provider": "test"}
        )

        # 3. Assert
        expected_result = (
            "Utterance: This is the last helper utterance. Summary: Mocked Summary"
        )
        assert result == expected_result
        mock_summary_resolver.assert_awaited_once()
