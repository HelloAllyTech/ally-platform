"""
Tests for voice expression utility functions.
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.speech_prosody import utils as ve_utils


class TestFormatConversationHistory:
    """Test cases for format_conversation_history function."""

    @pytest.mark.unit
    def test_format_conversation_history_empty(self):
        """Test with empty conversation history."""
        text, count = ve_utils.format_conversation_history(None)
        assert text == "No conversation history available."
        assert count == 0

    @pytest.mark.unit
    def test_format_conversation_history_empty_list(self):
        """Test with empty list."""
        text, count = ve_utils.format_conversation_history([])
        assert text == "No conversation history available."
        assert count == 0

    @pytest.mark.unit
    def test_format_conversation_history_single_message(self):
        """Test with single message."""
        history = [{"role": "user", "content": "Hello"}]
        text, count = ve_utils.format_conversation_history(history)
        assert "user: Hello" in text
        assert count == 1

    @pytest.mark.unit
    def test_format_conversation_history_multiple_messages(self):
        """Test with multiple messages."""
        history = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
            {"role": "user", "content": "How are you?"},
        ]
        text, count = ve_utils.format_conversation_history(history)
        assert "user: Hello" in text
        assert "assistant: Hi there" in text
        assert "user: How are you?" in text
        assert count == 3

    @pytest.mark.unit
    def test_format_conversation_history_with_limit(self):
        """Test with limit parameter."""
        history = [{"role": "user", "content": f"Message {i}"} for i in range(15)]
        text, count = ve_utils.format_conversation_history(history, limit=10)
        # Should only include last 10 messages (messages 5-14)
        assert count == 10
        assert "Message 4" not in text  # First 5 should be excluded
        assert "Message 5" in text  # Message 5 is the first of the last 10
        assert "Message 14" in text  # Last message should be included

    @pytest.mark.unit
    def test_format_conversation_history_missing_fields(self):
        """Test with messages missing role or content."""
        history = [
            {"role": "user"},  # Missing content
            {"content": "Hello"},  # Missing role
            {},  # Missing both
        ]
        text, count = ve_utils.format_conversation_history(history)
        assert count == 3
        assert "unknown: " in text
        assert "user: " in text

    @pytest.mark.unit
    def test_format_conversation_history_custom_limit(self):
        """Test with custom limit."""
        history = [{"role": "user", "content": f"Message {i}"} for i in range(20)]
        text, count = ve_utils.format_conversation_history(history, limit=5)
        assert count == 5
        assert "Message 15" in text
        assert "Message 10" not in text


class TestFormatPersonaContext:
    """Test cases for format_persona_context function."""

    @pytest.mark.unit
    def test_format_persona_context_none(self):
        """Test with None persona context."""
        result = ve_utils.format_persona_context(None)
        assert result == "No persona context available."

    @pytest.mark.unit
    def test_format_persona_context_empty_dict(self):
        """Test with empty dict."""
        result = ve_utils.format_persona_context({})
        assert result == "No persona context available."

    @pytest.mark.unit
    def test_format_persona_context_all_fields(self):
        """Test with all essential fields."""
        persona = {
            "personality": "Friendly and outgoing",
            "tone": "Warm and professional",
            "emotional_needs": "Understanding and validation",
            "starting_state": "Calm and ready",
            "context": "Therapy session",
        }
        result = ve_utils.format_persona_context(persona)
        assert "Personality: Friendly and outgoing" in result
        assert "Tone: Warm and professional" in result
        assert "Emotional Needs: Understanding and validation" in result
        assert "Starting State: Calm and ready" in result
        assert "Context: Therapy session" in result

    @pytest.mark.unit
    def test_format_persona_context_partial_fields(self):
        """Test with only some fields."""
        persona = {
            "personality": "Shy",
            "tone": "Gentle",
        }
        result = ve_utils.format_persona_context(persona)
        assert "Personality: Shy" in result
        assert "Tone: Gentle" in result
        assert "Emotional Needs" not in result

    @pytest.mark.unit
    def test_format_persona_context_extra_fields_ignored(self):
        """Test that non-essential fields are ignored."""
        persona = {
            "personality": "Friendly",
            "age": 25,  # Not essential
            "name": "John",  # Not essential
            "tone": "Warm",
        }
        result = ve_utils.format_persona_context(persona)
        assert "Personality: Friendly" in result
        assert "Tone: Warm" in result
        assert "age" not in result
        assert "name" not in result

    @pytest.mark.unit
    def test_format_persona_context_empty_values(self):
        """Test with empty string values."""
        persona = {
            "personality": "",
            "tone": "Warm",
        }
        result = ve_utils.format_persona_context(persona)
        assert "Personality" not in result
        assert "Tone: Warm" in result


class TestExtractPersonaContextFromPromptData:
    """Test cases for extract_persona_context_from_prompt_data function."""

    @pytest.mark.unit
    def test_extract_persona_context_none(self):
        """Test with None prompt_data."""
        result = ve_utils.extract_persona_context_from_prompt_data(None)
        assert result is None

    @pytest.mark.unit
    def test_extract_persona_context_all_fields(self):
        """Test extraction with all essential fields present."""
        mock_prompt_data = Mock()
        mock_prompt_data.personality = "Friendly and outgoing"
        mock_prompt_data.tone = "Warm and professional"
        mock_prompt_data.emotional_needs = "Understanding and validation"
        mock_prompt_data.starting_state = "Calm and ready"
        mock_prompt_data.context = "Therapy session"

        result = ve_utils.extract_persona_context_from_prompt_data(mock_prompt_data)

        assert result is not None
        assert result["personality"] == "Friendly and outgoing"
        assert result["tone"] == "Warm and professional"
        assert result["emotional_needs"] == "Understanding and validation"
        assert result["starting_state"] == "Calm and ready"
        assert result["context"] == "Therapy session"

    @pytest.mark.unit
    def test_extract_persona_context_partial_fields(self):
        """Test extraction with only some fields present."""
        mock_prompt_data = Mock()
        mock_prompt_data.personality = "Shy"
        mock_prompt_data.tone = "Gentle"
        # Other fields are missing

        result = ve_utils.extract_persona_context_from_prompt_data(mock_prompt_data)

        assert result is not None
        assert result["personality"] == "Shy"
        assert result["tone"] == "Gentle"
        assert "emotional_needs" not in result
        assert "starting_state" not in result

    @pytest.mark.unit
    def test_extract_persona_context_missing_fields(self):
        """Test extraction when fields don't exist (defensive)."""
        mock_prompt_data = Mock()
        # No attributes set - getattr will return None

        result = ve_utils.extract_persona_context_from_prompt_data(mock_prompt_data)

        assert result is None

    @pytest.mark.unit
    def test_extract_persona_context_empty_strings(self):
        """Test extraction with empty string values (should be skipped)."""
        mock_prompt_data = Mock()
        mock_prompt_data.personality = ""
        mock_prompt_data.tone = "   "  # Whitespace only
        mock_prompt_data.context = "Valid context"

        result = ve_utils.extract_persona_context_from_prompt_data(mock_prompt_data)

        assert result is not None
        assert "personality" not in result
        assert "tone" not in result
        assert result["context"] == "Valid context"

    @pytest.mark.unit
    def test_extract_persona_context_custom_whitelist(self):
        """Test extraction with custom field whitelist."""
        mock_prompt_data = Mock()
        mock_prompt_data.personality = "Friendly"
        mock_prompt_data.tone = "Warm"
        mock_prompt_data.custom_field = "Custom value"

        custom_whitelist = {"personality": "Personality", "custom_field": "Custom"}

        result = ve_utils.extract_persona_context_from_prompt_data(
            mock_prompt_data, field_whitelist=custom_whitelist
        )

        assert result is not None
        assert result["personality"] == "Friendly"
        assert result["custom_field"] == "Custom value"
        assert "tone" not in result  # Not in whitelist

    @pytest.mark.unit
    def test_extract_persona_context_non_string_values(self):
        """Test extraction with non-string values (should be skipped)."""
        mock_prompt_data = Mock()
        mock_prompt_data.personality = 123  # Not a string
        mock_prompt_data.tone = "Warm"  # Valid string

        result = ve_utils.extract_persona_context_from_prompt_data(mock_prompt_data)

        assert result is not None
        assert "personality" not in result  # Non-string skipped
        assert result["tone"] == "Warm"


class TestBuildVoiceExpressionPrompt:
    """Test cases for build_voice_expression_prompt function."""

    @pytest.mark.unit
    def test_build_prompt_with_enhancement(self):
        """Test building prompt when text enhancement is supported."""
        prompt_template = (
            "Persona: {persona_context}\n"
            "History: {conversation_history}\n"
            "Count: {conversation_history_count}\n"
            "Text: {response_text}\n"
            "Metadata: {parameter_metadata}\n"
            "Enhancement: {text_enhancement_instructions}"
        )

        result = ve_utils.build_prosody_prompt(
            response_text="Hello",
            parameter_metadata_json='{"speed": 1.0}',
            persona_context_text="Personality: Friendly",
            conversation_history_text="user: Hi",
            conversation_history_count=1,
            enhancement_instructions="Use [tags]",
            prompt_with_enhancement=prompt_template,
            prompt_parameters_only="",
        )

        assert "Persona: Personality: Friendly" in result
        assert "History: user: Hi" in result
        assert "Count: 1" in result
        assert "Text: Hello" in result
        assert 'Metadata: {"speed": 1.0}' in result
        assert "Enhancement: Use [tags]" in result

    @pytest.mark.unit
    def test_build_prompt_without_enhancement(self):
        """Test building prompt when text enhancement is not supported."""
        prompt_template = (
            "Persona: {persona_context}\n"
            "History: {conversation_history}\n"
            "Count: {conversation_history_count}\n"
            "Text: {response_text}\n"
            "Metadata: {parameter_metadata}"
        )

        result = ve_utils.build_prosody_prompt(
            response_text="Hello",
            parameter_metadata_json='{"speed": 1.0}',
            persona_context_text="Personality: Friendly",
            conversation_history_text="user: Hi",
            conversation_history_count=1,
            enhancement_instructions=None,
            prompt_with_enhancement="",
            prompt_parameters_only=prompt_template,
        )

        assert "Persona: Personality: Friendly" in result
        assert "History: user: Hi" in result
        assert "Count: 1" in result
        assert "Text: Hello" in result
        assert 'Metadata: {"speed": 1.0}' in result
        assert "Enhancement" not in result


class TestInvokeLLMWithJSONMode:
    """Test cases for invoke_llm_with_json_mode function."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_invoke_with_json_mode_supported(self):
        """Test when LLM supports JSON mode."""
        mock_llm = Mock()
        mock_bind = Mock()
        mock_json_llm = AsyncMock()
        mock_json_llm.ainvoke = AsyncMock(return_value="response")
        mock_bind.return_value = mock_json_llm
        mock_llm.bind = mock_bind
        # Mock __dir__ to return list with response_format
        mock_llm.__dir__ = lambda self=None: ["bind", "response_format"]

        result = await ve_utils.invoke_llm_with_json_mode(mock_llm, "prompt")

        mock_bind.assert_called_once_with(response_format={"type": "json_object"})
        mock_json_llm.ainvoke.assert_called_once_with("prompt")
        assert result == "response"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_invoke_without_json_mode(self):
        """Test when LLM doesn't support JSON mode."""
        mock_llm = AsyncMock()
        mock_llm.ainvoke = AsyncMock(return_value="response")
        # No bind or response_format in __dir__
        mock_llm.__dir__ = lambda self=None: ["ainvoke"]

        result = await ve_utils.invoke_llm_with_json_mode(mock_llm, "prompt")

        mock_llm.ainvoke.assert_called_once_with("prompt")
        assert result == "response"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_invoke_with_bind_but_no_response_format(self):
        """Test when LLM has bind but no response_format attribute."""
        mock_llm = AsyncMock()
        mock_llm.ainvoke = AsyncMock(return_value="response")
        # Has bind but no response_format in __dir__
        mock_llm.__dir__ = lambda self=None: ["bind"]

        result = await ve_utils.invoke_llm_with_json_mode(mock_llm, "prompt")

        mock_llm.ainvoke.assert_called_once_with("prompt")
        assert result == "response"


class TestParseLLMJSONResponse:
    """Test cases for parse_llm_json_response function."""

    @pytest.mark.unit
    def test_parse_valid_json_with_content(self):
        """Test parsing valid JSON from response with content attribute."""
        mock_response = Mock()
        mock_response.content = '{"speed": 1.0, "pitch": 0.5}'

        result = ve_utils.parse_llm_json_response(mock_response)

        assert result == {"speed": 1.0, "pitch": 0.5}

    @pytest.mark.unit
    def test_parse_valid_json_string(self):
        """Test parsing valid JSON from string."""
        response = '{"speed": 1.0}'

        result = ve_utils.parse_llm_json_response(response)

        assert result == {"speed": 1.0}

    @pytest.mark.unit
    def test_parse_invalid_json(self):
        """Test parsing invalid JSON."""
        mock_response = Mock()
        mock_response.content = '{"speed": 1.0, invalid}'

        with patch("app.speech_prosody.utils.logger") as mock_logger:
            result = ve_utils.parse_llm_json_response(mock_response)

        assert result is None
        mock_logger.warning.assert_called_once()

    @pytest.mark.unit
    def test_parse_non_json_string(self):
        """Test parsing non-JSON string."""
        response = "This is not JSON"

        result = ve_utils.parse_llm_json_response(response)

        assert result is None

    @pytest.mark.unit
    def test_parse_json_with_whitespace(self):
        """Test parsing JSON with whitespace."""
        mock_response = Mock()
        mock_response.content = '  {"speed": 1.0}  '

        result = ve_utils.parse_llm_json_response(mock_response)

        assert result == {"speed": 1.0}

    @pytest.mark.unit
    def test_parse_json_array_returns_none(self):
        """Test that JSON arrays are not parsed (only objects)."""
        mock_response = Mock()
        mock_response.content = '[{"speed": 1.0}]'

        result = ve_utils.parse_llm_json_response(mock_response)

        assert result is None

    @pytest.mark.unit
    def test_parse_empty_string(self):
        """Test parsing empty string."""
        mock_response = Mock()
        mock_response.content = ""

        result = ve_utils.parse_llm_json_response(mock_response)

        assert result is None


class TestExtractVoiceExpressionResult:
    """Test cases for extract_voice_expression_result function."""

    @pytest.mark.unit
    def test_extract_with_enhancement_supported(self):
        """Test extraction when text enhancement is supported."""
        result_dict = {
            "parameters": {"speed": 1.0, "pitch": 0.5},
            "enhanced_text": "Hello [excited] world",
        }

        params, enhanced = ve_utils.extract_prosody_result(
            result_dict, "Use [tags]", "Hello world"
        )

        assert params == {"speed": 1.0, "pitch": 0.5}
        assert enhanced == "Hello [excited] world"

    @pytest.mark.unit
    def test_extract_with_enhancement_missing_enhanced_text(self):
        """Test extraction when enhanced_text is missing."""
        result_dict = {
            "parameters": {"speed": 1.0},
        }

        params, enhanced = ve_utils.extract_prosody_result(
            result_dict, "Use [tags]", "Hello world"
        )

        assert params == {"speed": 1.0}
        assert enhanced == "Hello world"  # Falls back to original

    @pytest.mark.unit
    def test_extract_with_enhancement_missing_parameters(self):
        """Test extraction when parameters are missing."""
        result_dict = {
            "enhanced_text": "Hello [excited] world",
        }

        params, enhanced = ve_utils.extract_prosody_result(
            result_dict, "Use [tags]", "Hello world"
        )

        assert params == {}
        assert enhanced == "Hello [excited] world"

    @pytest.mark.unit
    def test_extract_without_enhancement(self):
        """Test extraction when text enhancement is not supported."""
        result_dict = {
            "speed": 1.0,
            "pitch": 0.5,
        }

        params, enhanced = ve_utils.extract_prosody_result(
            result_dict, None, "Hello world"
        )

        assert params == {"speed": 1.0, "pitch": 0.5}
        assert enhanced is None

    @pytest.mark.unit
    def test_extract_enhanced_text_not_string(self):
        """Test when enhanced_text is not a string (should use fallback)."""
        result_dict = {
            "parameters": {"speed": 1.0},
            "enhanced_text": {"invalid": "dict"},
        }

        with patch("app.speech_prosody.utils.logger") as mock_logger:
            params, enhanced = ve_utils.extract_prosody_result(
                result_dict, "Use [tags]", "Hello world"
            )

        assert params == {"speed": 1.0}
        assert enhanced == "Hello world"  # Falls back to original
        mock_logger.error.assert_called_once()

    @pytest.mark.unit
    def test_extract_empty_result_dict(self):
        """Test extraction with empty result dict."""
        result_dict = {}

        params, enhanced = ve_utils.extract_prosody_result(
            result_dict, None, "Hello world"
        )

        assert params == {}
        assert enhanced is None

    @pytest.mark.unit
    def test_extract_empty_result_dict_with_enhancement(self):
        """Test extraction with empty result dict when enhancement is supported."""
        result_dict = {}

        params, enhanced = ve_utils.extract_prosody_result(
            result_dict, "Use [tags]", "Hello world"
        )

        assert params == {}
        assert enhanced == "Hello world"  # Falls back to original
