"""
Test cases for the `generate_llm_response` function.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.outputs import LLMResult

from app.core.branching_instructions.functions.llm_response import (
    LLMResponse,
    generate_llm_response,
)
from app.llms.base import BaseLLMClient


@pytest.mark.asyncio
class TestGenerateLLMResponse:
    """Test cases for generate_llm_response."""

    async def test_generate_llm_response_success(self):
        """Test a successful LLM response generation."""
        mock_llm_instance = MagicMock()
        mock_llm_instance.with_structured_output.return_value.ainvoke = AsyncMock(
            return_value={
                "raw": LLMResult(
                    generations=[], llm_output={"usage": {"total_tokens": 5}}
                ),
                "parsed": LLMResponse(content="Test response"),
            }
        )
        mock_llm_client = MagicMock(spec=BaseLLMClient)
        mock_llm_client.llm_instance = mock_llm_instance

        with patch(
            "app.core.branching_instructions.functions.llm_response.create_llm_client",
            return_value=mock_llm_client,
        ) as mock_create_client, patch(
            "app.core.llm_usage.emitter.emit_langchain_usage"
        ) as mock_emit_usage:
            result = await generate_llm_response("Test content")

        assert result == "Test response"
        mock_create_client.assert_called_once()
        mock_emit_usage.assert_called_once()

    async def test_generate_llm_response_with_preconfigured_client(self):
        """Test using a pre-configured LLM client."""
        mock_llm_instance = MagicMock()
        mock_llm_instance.with_structured_output.return_value.ainvoke = AsyncMock(
            return_value={
                "raw": LLMResult(
                    generations=[], llm_output={"usage": {"total_tokens": 5}}
                ),
                "parsed": LLMResponse(content="Test response"),
            }
        )
        mock_llm_client = MagicMock(spec=BaseLLMClient)
        mock_llm_client.llm_instance = mock_llm_instance

        with patch(
            "app.core.branching_instructions.functions.llm_response.create_llm_client"
        ) as mock_create_client, patch(
            "app.core.llm_usage.emitter.emit_langchain_usage"
        ) as mock_emit_usage:
            result = await generate_llm_response(
                "Test content", llm_client=mock_llm_client
            )

        assert result == "Test response"
        mock_create_client.assert_not_called()
        mock_emit_usage.assert_called_once()

    async def test_generate_llm_response_handles_raw_usage_data(self):
        """Test that raw usage data is correctly emitted."""
        raw_result = LLMResult(
            generations=[], llm_output={"usage": {"total_tokens": 10}}
        )
        mock_llm_instance = MagicMock()
        mock_llm_instance.with_structured_output.return_value.ainvoke = AsyncMock(
            return_value={
                "raw": raw_result,
                "parsed": LLMResponse(content="Test response"),
            }
        )
        mock_llm_client = MagicMock(spec=BaseLLMClient)
        mock_llm_client.llm_instance = mock_llm_instance

        with patch(
            "app.core.branching_instructions.functions.llm_response.create_llm_client",
            return_value=mock_llm_client,
        ), patch(
            "app.core.llm_usage.emitter.emit_langchain_usage"
        ) as mock_emit_usage:
            await generate_llm_response("Test content")

        mock_emit_usage.assert_called_once()
        assert mock_emit_usage.call_args[0][0] == raw_result

    async def test_generate_llm_response_handles_parsing_failure(self):
        """Test that a ValueError is raised on parsing failure."""
        mock_llm_instance = MagicMock()
        mock_llm_instance.with_structured_output.return_value.ainvoke = AsyncMock(
            return_value={
                "raw": LLMResult(
                    generations=[], llm_output={"usage": {"total_tokens": 5}}
                ),
                "parsed": None,
                "parsing_error": "Some parsing error",
            }
        )
        mock_llm_client = MagicMock(spec=BaseLLMClient)
        mock_llm_client.llm_instance = mock_llm_instance

        with patch(
            "app.core.branching_instructions.functions.llm_response.create_llm_client",
            return_value=mock_llm_client,
        ), pytest.raises(ValueError) as excinfo:
            await generate_llm_response("Test content")

        assert "unparseable llm_response output" in str(excinfo.value)

    async def test_generate_llm_response_handles_non_dict_response(self):
        """Test the defensive fallback for non-dict LLM responses."""
        mock_llm_instance = MagicMock()
        mock_llm_instance.with_structured_output.return_value.ainvoke = AsyncMock(
            return_value=LLMResponse(content="Fallback response")
        )
        mock_llm_client = MagicMock(spec=BaseLLMClient)
        mock_llm_client.llm_instance = mock_llm_instance

        with patch(
            "app.core.branching_instructions.functions.llm_response.create_llm_client",
            return_value=mock_llm_client,
        ) as mock_create_client:
            result = await generate_llm_response("Test content")

        assert result == "Fallback response"
        mock_create_client.assert_called_once()

    async def test_generate_llm_response_with_empty_content(self):
        """Test that an empty string is returned for empty content."""
        result = await generate_llm_response("")
        assert result == ""
