"""
Test edge cases for dynamic variable resolution in branching instructions.

These tests ensure robust handling of edge cases in:
- last_helper_utterance resolution
- chat_summary resolution
- Combined dynamic variable resolution
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.branching_instructions.functions.last_helper_utterance import (
    get_last_helper_utterance,
    resolve_last_helper_utterance,
)


class TestLastHelperUtteranceEdgeCases:
    """Test edge cases for last_helper_utterance resolution."""

    def test_get_last_helper_utterance_empty_messages(self):
        """Test with empty message list."""
        result = get_last_helper_utterance([])
        assert result is None

    def test_get_last_helper_utterance_only_ai_messages(self):
        """Test with only AI messages (no Human messages)."""
        messages = [
            AIMessage(content="AI message 1"),
            AIMessage(content="AI message 2"),
        ]
        result = get_last_helper_utterance(messages)
        assert result is None

    def test_get_last_helper_utterance_only_system_messages(self):
        """Test with only System messages."""
        messages = [
            SystemMessage(content="System prompt"),
            SystemMessage(content="Another system message"),
        ]
        result = get_last_helper_utterance(messages)
        assert result is None

    def test_get_last_helper_utterance_mixed_messages(self):
        """Test with mixed message types, returns last Human message."""
        messages = [
            SystemMessage(content="System prompt"),
            HumanMessage(content="First human message"),
            AIMessage(content="AI response"),
            HumanMessage(content="Second human message"),
            AIMessage(content="Another AI response"),
        ]
        result = get_last_helper_utterance(messages)
        assert result == "Second human message"

    def test_get_last_helper_utterance_single_human_message(self):
        """Test with single Human message."""
        messages = [HumanMessage(content="Only human message")]
        result = get_last_helper_utterance(messages)
        assert result == "Only human message"

    def test_resolve_last_helper_utterance_tag_not_present(self):
        """Test when tag is not in content."""
        content = "No tags here"
        messages = [HumanMessage(content="Test")]
        result = resolve_last_helper_utterance(content, messages)
        assert result == "No tags here"

    def test_resolve_last_helper_utterance_no_human_messages(self):
        """Test when tag exists but no Human messages available."""
        content = "Respond to <last_helper_utterance>"
        messages = [AIMessage(content="Only AI")]
        result = resolve_last_helper_utterance(content, messages)
        # Should keep tag as-is
        assert result == "Respond to <last_helper_utterance>"

    def test_resolve_last_helper_utterance_success(self):
        """Test successful resolution."""
        content = "Respond to <last_helper_utterance>"
        messages = [
            HumanMessage(content="Hello there"),
            AIMessage(content="Hi"),
        ]
        result = resolve_last_helper_utterance(content, messages)
        assert result == "Respond to Hello there"

    def test_resolve_last_helper_utterance_multiple_tags(self):
        """Test with multiple occurrences of the tag."""
        content = "First: <last_helper_utterance>, Second: <last_helper_utterance>"
        messages = [HumanMessage(content="Test message")]
        result = resolve_last_helper_utterance(content, messages)
        assert result == "First: Test message, Second: Test message"


class TestChatSummaryEdgeCases:
    """Test edge cases for chat_summary resolution."""

    @pytest.mark.asyncio
    async def test_resolve_chat_summary_empty_messages(self, mocker):
        """Test chat summary with empty message list."""
        from app.core.branching_instructions.functions.chat_summary import (
            generate_chat_summary,
        )

        result = await generate_chat_summary(messages=[], language_code="en-US")
        assert result == "No conversation history available."

    @pytest.mark.asyncio
    async def test_resolve_chat_summary_llm_failure(self, mocker):
        """Test graceful fallback when LLM fails."""
        from app.core.branching_instructions.functions.chat_summary import (
            generate_chat_summary,
        )

        # Mock create_llm_client to raise an exception
        mocker.patch(
            "app.core.branching_instructions.functions.chat_summary.create_llm_client",
            side_effect=Exception("LLM unavailable"),
        )

        messages = [HumanMessage(content="Test")]
        result = await generate_chat_summary(messages, language_code="en-US")
        assert result == "Conversation summary currently unavailable."

    @pytest.mark.asyncio
    async def test_resolve_chat_summary_only_system_messages(self, mocker):
        """
        Test chat summary with only system messages
        (should skip them in conversation).
        """
        from app.core.branching_instructions.functions.chat_summary import (
            generate_chat_summary,
        )

        # Create a proper mock structure
        mock_response = MagicMock()
        mock_response.summary = "Empty conversation"

        mock_structured = AsyncMock()
        mock_structured.ainvoke = AsyncMock(return_value=mock_response)

        mock_llm_instance = MagicMock()
        mock_llm_instance.with_structured_output = MagicMock(
            return_value=mock_structured
        )

        mock_client = MagicMock()
        mock_client.llm_instance = mock_llm_instance

        mocker.patch(
            "app.core.branching_instructions.functions.chat_summary.create_llm_client",
            return_value=mock_client,
        )

        messages = [
            SystemMessage(content="System prompt 1"),
            SystemMessage(content="System prompt 2"),
        ]
        result = await generate_chat_summary(messages, language_code="en-US")
        assert result == "Empty conversation"


class TestCombinedDynamicVariableResolution:
    """Test combined resolution of multiple dynamic variables."""

    @pytest.mark.asyncio
    async def test_resolve_both_dynamic_tags_with_empty_messages(self, mocker):
        """Test resolving both tags when messages are empty."""
        # Mock returns the content as-is since no messages to summarize
        mocker.patch(
            "app.core.branching_instructions.base.resolve_chat_summary",
            new_callable=AsyncMock,
            side_effect=lambda content, **kwargs: content,  # Return content unchanged
        )

        instruction = BranchingInstruction(
            content="Utterance: <last_helper_utterance>, Summary: <chat_summary>",
            variable_tags=["last_helper_utterance", "chat_summary"],
            static_tags=[],
            dynamic_tags=["last_helper_utterance", "chat_summary"],
        )

        result = await instruction.resolve_dynamic_branching_instruction(
            messages=[], language_code="en-US"
        )

        # Both tags should remain as-is when no messages
        assert "<last_helper_utterance>" in result
        assert "<chat_summary>" in result

    @pytest.mark.asyncio
    async def test_resolve_no_dynamic_tags_optimization(self):
        """Test that resolution is skipped when no dynamic tags exist."""
        instruction = BranchingInstruction(
            content="Static instruction",
            variable_tags=[],
            static_tags=[],
            dynamic_tags=[],  # No dynamic tags
        )

        # Should return immediately without any processing
        result = await instruction.resolve_dynamic_branching_instruction(
            messages=[HumanMessage(content="Test")], language_code="en-US"
        )

        assert result == "Static instruction"

    @pytest.mark.asyncio
    async def test_resolve_only_last_helper_utterance_tag(self, mocker):
        """Test resolving only last_helper_utterance when chat_summary not present."""
        # Mock should not be called for chat_summary
        mock_summary = mocker.patch(
            "app.core.branching_instructions.base.resolve_chat_summary",
            new_callable=AsyncMock,
        )

        instruction = BranchingInstruction(
            content="Respond to <last_helper_utterance>",
            variable_tags=["last_helper_utterance"],
            static_tags=[],
            dynamic_tags=["last_helper_utterance"],
        )

        messages = [HumanMessage(content="Hello world")]
        result = await instruction.resolve_dynamic_branching_instruction(
            messages=messages, language_code="en-US"
        )

        assert result == "Respond to Hello world"
        # chat_summary resolver should not be called
        mock_summary.assert_not_called()

    @pytest.mark.asyncio
    async def test_resolve_only_chat_summary_tag(self, mocker):
        """Test resolving only chat_summary when last_helper_utterance not present."""
        mock_summary = mocker.patch(
            "app.core.branching_instructions.base.resolve_chat_summary",
            new_callable=AsyncMock,
            return_value="Summary: Test summary",
        )

        instruction = BranchingInstruction(
            content="Summary: <chat_summary>",
            variable_tags=["chat_summary"],
            static_tags=[],
            dynamic_tags=["chat_summary"],
        )

        messages = [HumanMessage(content="Test")]
        result = await instruction.resolve_dynamic_branching_instruction(
            messages=messages, language_code="en-US", llm_config={"model": "gpt-4"}
        )

        assert result == "Summary: Test summary"
        mock_summary.assert_awaited_once()
