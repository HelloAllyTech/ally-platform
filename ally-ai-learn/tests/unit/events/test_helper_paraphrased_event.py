"""Unit tests for HelperParaphrasedEvent."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.constants import DetectionType
from app.core.events.base import ChatMessage
from app.core.events.event_types.helper_paraphrased.constants import (
    HelperParaphrasedData,
)
from app.core.events.event_types.helper_paraphrased.helper_paraphrased_event import (
    HelperParaphrasedEvent,
)
from app.core.events.event_types.helper_paraphrased.schemas import ParaphraseResult


class TestHelperParaphrasedEvent:
    """Test suite for HelperParaphrasedEvent class."""

    @pytest.mark.asyncio
    async def test_create_event(self):
        """Test creating a helper paraphrased event."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_1",
            data=data,
            score=5,
        )

        assert event.event_id == "paraphrase_test_1"
        assert event.score == 5
        assert event.detection_type == DetectionType.HELPER_PARAPHRASED

    @pytest.mark.asyncio
    async def test_detect_event_empty_conversations(self):
        """Test that empty conversations return False."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_3",
            data=data,
        )

        result = await event.detect_event([])
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_event_insufficient_messages(self):
        """Test that less than 2 messages return False."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_4",
            data=data,
        )

        conversations = [ChatMessage(role="client", content="Hello")]
        result = await event.detect_event(conversations)
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_event_missing_agent_message(self):
        """Test that missing agent message returns False."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_5",
            data=data,
        )

        conversations = [
            ChatMessage(role="counselor", content="I understand"),
            ChatMessage(role="counselor", content="That makes sense"),
        ]
        result = await event.detect_event(conversations)
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_event_missing_counselor_message(self):
        """Test that missing counselor message returns False."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_6",
            data=data,
        )

        conversations = [
            ChatMessage(role="client", content="How are you feeling?"),
            ChatMessage(role="client", content="Tell me more"),
        ]
        result = await event.detect_event(conversations)
        assert result is False

    @pytest.mark.asyncio
    @patch(
        "app.core.events.event_types.helper_paraphrased."
        "helper_paraphrased_event.AsyncOpenAI"
    )
    async def test_detect_event_paraphrasing_detected(self, mock_async_openai):
        """Test that paraphrasing is detected when LLM returns True."""
        mock_openai_client = AsyncMock()
        mock_async_openai.return_value = mock_openai_client

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ParaphraseResult(is_paraphrase=True)
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_7",
            data=data,
        )

        conversations = [
            ChatMessage(role="client", content="How are you feeling today?"),
            ChatMessage(
                role="counselor",
                content="What emotions are you experiencing right now?",
            ),
        ]

        result = await event.detect_event(conversations)
        assert result is True
        mock_openai_client.beta.chat.completions.parse.assert_called_once()

    @pytest.mark.asyncio
    @patch(
        "app.core.events.event_types.helper_paraphrased."
        "helper_paraphrased_event.AsyncOpenAI"
    )
    async def test_detect_event_no_paraphrasing(self, mock_async_openai):
        """Test that no paraphrasing is detected when LLM returns False."""
        mock_openai_client = AsyncMock()
        mock_async_openai.return_value = mock_openai_client

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ParaphraseResult(
            is_paraphrase=False
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_8",
            data=data,
        )

        conversations = [
            ChatMessage(role="client", content="How are you feeling today?"),
            ChatMessage(role="counselor", content="What's the weather like?"),
        ]

        result = await event.detect_event(conversations)
        assert result is False
        mock_openai_client.beta.chat.completions.parse.assert_called_once()

    @pytest.mark.asyncio
    async def test_detect_event_empty_message_content(self):
        """Test that empty message content returns False."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_9",
            data=data,
        )

        conversations = [
            ChatMessage(role="client", content=""),
            ChatMessage(role="counselor", content="I understand"),
        ]
        result = await event.detect_event(conversations)
        assert result is False

    @pytest.mark.asyncio
    @patch(
        "app.core.events.event_types.helper_paraphrased."
        "helper_paraphrased_event.AsyncOpenAI"
    )
    async def test_detect_event_llm_error(self, mock_async_openai):
        """Test that LLM errors are handled gracefully."""
        mock_openai_client = AsyncMock()
        mock_async_openai.return_value = mock_openai_client

        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            side_effect=Exception("LLM API error")
        )

        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_10",
            data=data,
        )

        conversations = [
            ChatMessage(role="client", content="How are you?"),
            ChatMessage(role="counselor", content="I'm fine"),
        ]

        result = await event.detect_event(conversations)
        assert result is False

    @pytest.mark.asyncio
    @patch(
        "app.core.events.event_types.helper_paraphrased."
        "helper_paraphrased_event.AsyncOpenAI"
    )
    async def test_detect_event_counselor_before_agent(self, mock_async_openai):
        """Test that counselor message must come after agent message."""
        mock_openai_client = AsyncMock()
        mock_async_openai.return_value = mock_openai_client

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ParaphraseResult(is_paraphrase=True)
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_11",
            data=data,
        )

        # Counselor message comes before agent message
        # Should still work as we find the last agent and last counselor
        conversations = [
            ChatMessage(role="counselor", content="I understand"),
            ChatMessage(role="client", content="How are you feeling?"),
        ]

        # Should return False because last message is not from counselor
        result = await event.detect_event(conversations)
        assert result is False

    @pytest.mark.asyncio
    @patch(
        "app.core.events.event_types.helper_paraphrased."
        "helper_paraphrased_event.AsyncOpenAI"
    )
    async def test_detect_event_with_agent_role(self, mock_async_openai):
        """Test that agent messages with role 'agent' are also detected."""
        mock_openai_client = AsyncMock()
        mock_async_openai.return_value = mock_openai_client

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ParaphraseResult(is_paraphrase=True)
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="paraphrase_test_12",
            data=data,
        )

        conversations = [
            ChatMessage(role="agent", content="How are you feeling today?"),
            ChatMessage(
                role="counselor",
                content="What emotions are you experiencing right now?",
            ),
        ]

        result = await event.detect_event(conversations)
        assert result is True

    @pytest.mark.asyncio
    async def test_default_model_is_gpt_4o_mini(self):
        """Test that default model is gpt-4o-mini."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(event_id="test_event", data=data)

        assert event.model == "gpt-4o-mini"

    @pytest.mark.asyncio
    async def test_custom_model_can_be_set(self):
        """Test that custom model can be set."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="test_event", data=data, model="gpt-4o"
        )

        assert event.model == "gpt-4o"

    @pytest.mark.asyncio
    @patch(
        "app.core.events.event_types.helper_paraphrased."
        "helper_paraphrased_event.AsyncOpenAI"
    )
    async def test_evaluate_paraphrase_uses_correct_model(self, mock_async_openai):
        """Test that the correct model is used for LLM evaluation."""
        mock_openai_client = AsyncMock()
        mock_async_openai.return_value = mock_openai_client

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ParaphraseResult(is_paraphrase=True)
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(
            event_id="test_event", data=data, model="gpt-4o"
        )

        conversations = [
            ChatMessage(role="client", content="Test agent message"),
            ChatMessage(role="counselor", content="Test counselor message"),
        ]

        await event.detect_event(conversations)

        call_args = mock_openai_client.beta.chat.completions.parse.call_args
        assert call_args.kwargs["model"] == "gpt-4o"

    @pytest.mark.asyncio
    @patch(
        "app.core.events.event_types.helper_paraphrased."
        "helper_paraphrased_event.AsyncOpenAI"
    )
    async def test_evaluate_paraphrase_returns_false_for_empty_messages(
        self, mock_async_openai
    ):
        """Test that empty messages return False."""
        data = HelperParaphrasedData()
        event = HelperParaphrasedEvent.create(event_id="test_event", data=data)

        result = await event._evaluate_paraphrase("", "   ")
        assert result is False

        # Should not call LLM for empty messages
        mock_async_openai.assert_not_called()
