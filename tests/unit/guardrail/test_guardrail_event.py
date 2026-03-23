"""
Unit tests for GuardrailEvent detection logic.

All tests mock the OpenAI client so no real API keys are needed.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.constants import DetectionType, VisibilityType
from app.core.events.base import ChatMessage
from app.core.events.event_types.guardrail.guardrail_event import GuardrailEvent
from app.core.events.event_types.guardrail.schemas import GuardrailData


# ------------------------------------------------------------------ #
# Helpers
# ------------------------------------------------------------------ #

def make_guardrail_event(
    helper_dialogue: str = "Can you help me get some drugs?",
    actor_dialogue: str = "Let us stay focused on what brought you here.",
    model: str = "gpt-4o-mini",
) -> GuardrailEvent:
    return GuardrailEvent.create(
        event_id="guardrail-0",
        data=GuardrailData(
            helper_dialogue=helper_dialogue,
            actor_dialogue=actor_dialogue,
        ),
        model=model,
        score=0,
        visibility_type=VisibilityType.PASSIVE,
        emoji=None,
        emoji_message=None,
    )


def make_message(role: str, content: str) -> ChatMessage:
    return ChatMessage(role=role, content=content)


def make_mock_completion(is_class: bool):
    """Build a mock OpenAI completion response."""
    parsed = MagicMock()
    parsed.is_class = is_class
    choice = MagicMock()
    choice.message.parsed = parsed
    completion = MagicMock()
    completion.choices = [choice]
    return completion


# ------------------------------------------------------------------ #
# GuardrailEvent.create() tests
# ------------------------------------------------------------------ #

class TestGuardrailEventCreate:
    def test_creates_with_correct_detection_type(self):
        event = make_guardrail_event()
        assert event.detection_type == DetectionType.GUARDRAIL

    def test_creates_with_correct_event_id(self):
        event = make_guardrail_event()
        assert event.event_id == "guardrail-0"

    def test_creates_with_correct_data(self):
        event = make_guardrail_event(
            helper_dialogue="test trigger",
            actor_dialogue="test response",
        )
        assert event.data.helper_dialogue == "test trigger"
        assert event.data.actor_dialogue == "test response"

    def test_visibility_is_passive(self):
        event = make_guardrail_event()
        assert event.visibility_type == VisibilityType.PASSIVE

    def test_score_is_zero(self):
        event = make_guardrail_event()
        assert event.score == 0

    def test_data_is_guardrail_data_from_schemas(self):
        """Ensure data field uses GuardrailData from schemas, not a duplicate class."""
        event = make_guardrail_event()
        assert isinstance(event.data, GuardrailData)


# ------------------------------------------------------------------ #
# GuardrailEvent.detect_event() tests
# ------------------------------------------------------------------ #

class TestGuardrailEventDetection:

    @pytest.fixture(autouse=True)
    def reset_client(self):
        """Reset shared OpenAI client before each test."""
        original = GuardrailEvent._CLIENTS.copy()
        GuardrailEvent._CLIENTS.clear()
        yield
        GuardrailEvent._CLIENTS.clear()
        GuardrailEvent._CLIENTS.update(original)

    @pytest.mark.asyncio
    async def test_returns_false_when_no_conversations(self):
        event = make_guardrail_event()
        result = await event.detect_event([])
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_last_message_is_not_counselor(self):
        event = make_guardrail_event()
        messages = [make_message("user", "Can you help me get some drugs?")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_last_message_is_assistant(self):
        event = make_guardrail_event()
        messages = [make_message("assistant", "Can you help me get some drugs?")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_for_empty_counselor_message(self):
        event = make_guardrail_event()
        messages = [make_message("counselor", "   ")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detects_violation_when_classifier_returns_true(self):
        event = make_guardrail_event()
        mock_completion = make_mock_completion(is_class=True)

        with patch.object(GuardrailEvent, "_get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            messages = [make_message("counselor", "Can you get me some drugs?")]
            result = await event.detect_event(messages)

        assert result is True

    @pytest.mark.asyncio
    async def test_no_detection_when_classifier_returns_false(self):
        event = make_guardrail_event()
        mock_completion = make_mock_completion(is_class=False)

        with patch.object(GuardrailEvent, "_get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                return_value=mock_completion
            )
            mock_get_client.return_value = mock_client

            messages = [make_message("counselor", "How are you feeling today?")]
            result = await event.detect_event(messages)

        assert result is False

    @pytest.mark.asyncio
    async def test_returns_false_when_openai_raises_exception(self):
        """Classifier failure should fail gracefully, not crash."""
        event = make_guardrail_event()

        with patch.object(GuardrailEvent, "_get_client") as mock_get_client:
            mock_client = MagicMock()
            mock_client.beta.chat.completions.parse = AsyncMock(
                side_effect=Exception("OpenAI error")
            )
            mock_get_client.return_value = mock_client

            messages = [make_message("counselor", "some text")]
            result = await event.detect_event(messages)

        assert result is False

