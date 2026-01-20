"""
Test cases for LLM response resolution in branching instructions.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.core.branching_instructions.base import BranchingInstruction
from app.core.branching_instructions.parser import extract_llm_response_tags


class TestExtractLLMResponseTags:
    """Test extraction of llm_response tags from instructions."""

    def test_extract_single_llm_response_tag(self):
        """Test extracting a single llm_response tag."""
        instruction = "Use <llm_response(facts about exercise)>"
        result = extract_llm_response_tags(instruction)

        assert result == {"llm_response(facts about exercise)": "facts about exercise"}

    def test_extract_multiple_llm_response_tags(self):
        """Test extracting multiple llm_response tags."""
        instruction = (
            "Use <llm_response(facts about exercise)> and "
            "<llm_response(benefits of meditation)>"
        )
        result = extract_llm_response_tags(instruction)

        assert result == {
            "llm_response(facts about exercise)": "facts about exercise",
            "llm_response(benefits of meditation)": "benefits of meditation",
        }

    def test_extract_no_llm_response_tags(self):
        """Test when no llm_response tags are present."""
        instruction = "Regular instruction with <name> variable"
        result = extract_llm_response_tags(instruction)

        assert result == {}

    def test_extract_llm_response_with_complex_parameter(self):
        """Test extracting llm_response with complex parameter text."""
        instruction = "Use <llm_response(3 facts about exercise, keep it brief)>"
        result = extract_llm_response_tags(instruction)

        assert result == {
            "llm_response(3 facts about exercise, keep it brief)": (
                "3 facts about exercise, keep it brief"
            )
        }


class TestBranchingInstructionLLMResolution:
    """Test LLM response resolution in BranchingInstruction."""

    @pytest.mark.asyncio
    async def test_needs_llm_resolution_initial_state(self):
        """Test that new instruction needs LLM resolution."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)>"
        )

        assert instruction.needs_llm_resolution() is True

    @pytest.mark.asyncio
    async def test_needs_llm_resolution_after_resolution(self):
        """Test that instruction doesn't need resolution after being resolved."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)>"
        )

        with patch(
            "app.core.branching_instructions.base.generate_llm_response",
            new_callable=AsyncMock,
            return_value="Exercise improves health",
        ):
            await instruction.resolve_llm_responses()

        assert instruction.needs_llm_resolution() is False

    @pytest.mark.asyncio
    async def test_resolve_single_llm_response_tag(self):
        """Test resolving a single llm_response tag."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)>"
        )

        with patch(
            "app.core.branching_instructions.base.generate_llm_response",
            new_callable=AsyncMock,
            return_value="Exercise improves cardiovascular health",
        ) as mock_generate:
            await instruction.resolve_llm_responses(language_code="en-IN")

        mock_generate.assert_called_once_with(
            content="facts about exercise",
            language_code="en-IN",
            llm_config=None,
        )
        assert instruction.content == "Use Exercise improves cardiovascular health"

    @pytest.mark.asyncio
    async def test_resolve_multiple_llm_response_tags(self):
        """Test resolving multiple llm_response tags."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)> and "
            "<llm_response(benefits of meditation)>"
        )

        responses = {
            "facts about exercise": "Exercise improves health",
            "benefits of meditation": "Meditation reduces stress",
        }

        async def mock_generate(content, language_code, llm_config):
            return responses.get(content, "")

        with patch(
            "app.core.branching_instructions.base.generate_llm_response",
            new_callable=AsyncMock,
            side_effect=mock_generate,
        ):
            await instruction.resolve_llm_responses()

        assert instruction.content == (
            "Use Exercise improves health and Meditation reduces stress"
        )

    @pytest.mark.asyncio
    async def test_resolve_with_custom_llm_config(self):
        """Test resolving with custom LLM configuration."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)>"
        )

        llm_config = {"model": "gpt-4", "temperature": 0.7}

        with patch(
            "app.core.branching_instructions.base.generate_llm_response",
            new_callable=AsyncMock,
            return_value="Exercise improves health",
        ) as mock_generate:
            await instruction.resolve_llm_responses(
                llm_config=llm_config, language_code="hi-IN"
            )

        mock_generate.assert_called_once_with(
            content="facts about exercise",
            language_code="hi-IN",
            llm_config=llm_config,
        )

    @pytest.mark.asyncio
    async def test_resolve_no_llm_response_tags(self):
        """Test resolving when no llm_response tags are present."""
        instruction = BranchingInstruction.create("Regular instruction")
        original_content = instruction.content

        await instruction.resolve_llm_responses()

        assert instruction.content == original_content
        assert instruction.needs_llm_resolution() is False

    @pytest.mark.asyncio
    async def test_resolve_idempotent(self):
        """Test that resolving multiple times doesn't cause issues."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)>"
        )

        with patch(
            "app.core.branching_instructions.base.generate_llm_response",
            new_callable=AsyncMock,
            return_value="Exercise improves health",
        ) as mock_generate:
            await instruction.resolve_llm_responses()
            first_content = instruction.content

            # Call again - should not make another LLM call
            await instruction.resolve_llm_responses()
            second_content = instruction.content

        # Should only be called once
        assert mock_generate.call_count == 1
        assert first_content == second_content
        assert first_content == "Use Exercise improves health"

    @pytest.mark.asyncio
    async def test_resolve_mixed_tags(self):
        """Test resolving instruction with both regular and llm_response tags."""
        prompt_data = {"customFields": [{"field": "name", "value": "John"}]}

        instruction = BranchingInstruction.create(
            "Hello <name>, use <llm_response(facts about exercise)>",
            prompt_data=prompt_data,
        )

        with patch(
            "app.core.branching_instructions.base.generate_llm_response",
            new_callable=AsyncMock,
            return_value="Exercise improves health",
        ):
            await instruction.resolve_llm_responses()

        assert instruction.content == "Hello John, use Exercise improves health"
