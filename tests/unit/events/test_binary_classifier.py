from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.constants import DetectionType
from app.core.events.base import ChatMessage
from app.core.events.event_types.binary_classifier.binary_classifier_event import (
    BinaryClassifierEvent,
)
from app.core.events.event_types.binary_classifier.schemas import (
    BinaryClassifierData,
    ClassificationResultStrOp,
    Example,
)


@pytest.mark.asyncio
class TestBinaryClassifierEvent:
    @pytest.fixture(autouse=True)
    def reset_client(self):
        """Reset the cached OpenAI client before each test."""
        BinaryClassifierEvent._CLIENT = None
        yield
        BinaryClassifierEvent._CLIENT = None

    async def test_create_event(self):
        data = BinaryClassifierData(class_name="greeting")
        event = BinaryClassifierEvent.create(
            event_id="test_event", data=data, score=10, emoji="👋"
        )

        assert event.event_id == "test_event"
        assert event.data.class_name == "greeting"
        assert event.detection_type == DetectionType.BINARY_CLASSIFIER
        assert event.score == 10
        assert event.emoji == "👋"

    async def test_detect_event_with_counselor_message(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=True
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        data = BinaryClassifierData(class_name="greeting")
        event = BinaryClassifierEvent.create(event_id="greeting_event", data=data)

        conversations = [
            ChatMessage(role="user", content="Hi there"),
            ChatMessage(role="counselor", content="Hello! How are you?"),
        ]

        result = await event.detect_event(conversations)

        assert result is True
        mock_openai_client.beta.chat.completions.parse.assert_called_once()

    async def test_detect_event_with_non_counselor_message(self):
        data = BinaryClassifierData(class_name="greeting")
        event = BinaryClassifierEvent.create(event_id="greeting_event", data=data)

        conversations = [ChatMessage(role="user", content="Hi there")]

        result = await event.detect_event(conversations)

        assert result is False

    async def test_detect_event_with_empty_conversations(self):
        data = BinaryClassifierData(class_name="greeting")
        event = BinaryClassifierEvent.create(event_id="greeting_event", data=data)

        result = await event.detect_event([])

        assert result is False

    async def test_classify_returns_false_when_not_class(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=False
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        data = BinaryClassifierData(class_name="greeting")
        event = BinaryClassifierEvent.create(event_id="greeting_event", data=data)

        conversations = [
            ChatMessage(role="counselor", content="You should try meditation.")
        ]

        result = await event.detect_event(conversations)

        assert result is False

    async def test_classify_handles_llm_exception(self):
        mock_openai_client = AsyncMock()

        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            side_effect=Exception("LLM API error")
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        data = BinaryClassifierData(class_name="greeting")
        event = BinaryClassifierEvent.create(event_id="greeting_event", data=data)

        conversations = [ChatMessage(role="counselor", content="Hello!")]

        result = await event.detect_event(conversations)

        assert result is False

    async def test_classify_with_empty_text(self):
        data = BinaryClassifierData(class_name="greeting")
        event = BinaryClassifierEvent.create(event_id="greeting_event", data=data)

        conversations = [ChatMessage(role="counselor", content="   ")]

        result = await event.detect_event(conversations)

        assert result is False

    async def test_create_event_with_few_shot_examples(self):

        positive_examples = [
            Example(text="Hello there!"),
            Example(text="Hi, how are you?"),
        ]
        negative_examples = [
            Example(text="You should try meditation."),
            Example(text="That's not good."),
        ]

        data = BinaryClassifierData(
            class_name="greeting",
            positive_examples=positive_examples,
            negative_examples=negative_examples,
        )
        event = BinaryClassifierEvent.create(event_id="test_event", data=data)

        assert event.data.class_name == "greeting"
        assert event.data.positive_examples == positive_examples
        assert event.data.negative_examples == negative_examples

    async def test_classify_with_few_shot_examples(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=True
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        positive_examples = [
            Example(text="Hello there!"),
            Example(text="Hi, how are you?"),
        ]
        negative_examples = [Example(text="You should try meditation.")]

        data = BinaryClassifierData(
            class_name="greeting",
            positive_examples=positive_examples,
            negative_examples=negative_examples,
        )
        event = BinaryClassifierEvent.create(event_id="greeting_event", data=data)

        conversations = [
            ChatMessage(role="user", content="Hi there"),
            ChatMessage(role="counselor", content="Hey! Good to see you!"),
        ]

        result = await event.detect_event(conversations)

        assert result is True
        mock_openai_client.beta.chat.completions.parse.assert_called_once()

    async def test_classify_with_class_name_only(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=True
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        data = BinaryClassifierData(class_name="empathetic response")
        event = BinaryClassifierEvent.create(event_id="empathy_event", data=data)

        conversations = [
            ChatMessage(role="user", content="I'm feeling really sad"),
            ChatMessage(
                role="counselor",
                content="I can understand how difficult that must be for you.",
            ),
        ]

        result = await event.detect_event(conversations)

        assert result is True
        mock_openai_client.beta.chat.completions.parse.assert_called_once()

        call_args = mock_openai_client.beta.chat.completions.parse.call_args
        messages = call_args.kwargs["messages"]
        prompt_content = messages[0]["content"]

        assert "empathetic response" in prompt_content
        assert "Positive examples" not in prompt_content
        assert "Negative examples" not in prompt_content

    async def test_classify_with_class_name_and_positive_examples_only(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=True
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        positive_examples = [
            Example(text="I understand how you feel."),
            Example(text="That sounds really difficult."),
            Example(text="I can see why that would be hard for you."),
        ]

        data = BinaryClassifierData(
            class_name="empathetic response", positive_examples=positive_examples
        )
        event = BinaryClassifierEvent.create(event_id="empathy_event", data=data)

        conversations = [
            ChatMessage(role="user", content="I'm struggling"),
            ChatMessage(role="counselor", content="I hear you, that must be tough."),
        ]

        result = await event.detect_event(conversations)

        assert result is True
        mock_openai_client.beta.chat.completions.parse.assert_called_once()

        call_args = mock_openai_client.beta.chat.completions.parse.call_args
        messages = call_args.kwargs["messages"]
        prompt_content = messages[0]["content"]

        assert "empathetic response" in prompt_content
        assert "Positive examples" in prompt_content
        assert "I understand how you feel." in prompt_content
        assert "Negative examples" not in prompt_content

    async def test_classify_with_class_name_and_negative_examples_only(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=False
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        negative_examples = [
            Example(text="Just think positive."),
            Example(text="Everyone goes through this."),
            Example(text="You'll get over it."),
        ]

        data = BinaryClassifierData(
            class_name="empathetic response", negative_examples=negative_examples
        )
        event = BinaryClassifierEvent.create(event_id="empathy_event", data=data)

        conversations = [
            ChatMessage(role="user", content="I'm sad"),
            ChatMessage(role="counselor", content="Just be happy!"),
        ]

        result = await event.detect_event(conversations)

        assert result is False
        mock_openai_client.beta.chat.completions.parse.assert_called_once()

        call_args = mock_openai_client.beta.chat.completions.parse.call_args
        messages = call_args.kwargs["messages"]
        prompt_content = messages[0]["content"]

        assert "empathetic response" in prompt_content
        assert "Negative examples" in prompt_content
        assert "Just think positive." in prompt_content
        assert "Positive examples" not in prompt_content

    async def test_classify_with_both_positive_and_negative_examples(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=True
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        positive_examples = [
            Example(text="How are you feeling today?"),
            Example(text="Can you tell me more about that?"),
            Example(text="What's been on your mind?"),
        ]
        negative_examples = [
            Example(text="You should do this."),
            Example(text="I think you need to change."),
            Example(text="Here's what I would do."),
        ]

        data = BinaryClassifierData(
            class_name="open-ended question",
            positive_examples=positive_examples,
            negative_examples=negative_examples,
        )
        event = BinaryClassifierEvent.create(event_id="question_event", data=data)

        conversations = [
            ChatMessage(role="user", content="I don't know what to do"),
            ChatMessage(
                role="counselor", content="What would help you feel better right now?"
            ),
        ]

        result = await event.detect_event(conversations)

        assert result is True
        mock_openai_client.beta.chat.completions.parse.assert_called_once()

        call_args = mock_openai_client.beta.chat.completions.parse.call_args
        messages = call_args.kwargs["messages"]
        prompt_content = messages[0]["content"]

        assert "open-ended question" in prompt_content
        assert "Positive examples" in prompt_content
        assert "Negative examples" in prompt_content
        assert "How are you feeling today?" in prompt_content
        assert "You should do this." in prompt_content

    async def test_create_event_with_empty_class_name(self):
        data = BinaryClassifierData(class_name="")
        event = BinaryClassifierEvent.create(event_id="test_event", data=data)

        assert event.data.class_name == ""
        assert event.data.positive_examples is None
        assert event.data.negative_examples is None

    async def test_create_event_with_empty_examples_lists(self):
        data = BinaryClassifierData(
            class_name="greeting", positive_examples=[], negative_examples=[]
        )
        event = BinaryClassifierEvent.create(event_id="test_event", data=data)

        assert event.data.class_name == "greeting"
        assert event.data.positive_examples == []
        assert event.data.negative_examples == []

    async def test_classify_with_multiple_positive_examples(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=True
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        positive_examples = [
            Example(text="Example 1"),
            Example(text="Example 2"),
            Example(text="Example 3"),
            Example(text="Example 4"),
            Example(text="Example 5"),
        ]

        data = BinaryClassifierData(
            class_name="test_class", positive_examples=positive_examples
        )
        event = BinaryClassifierEvent.create(event_id="test_event", data=data)

        conversations = [ChatMessage(role="counselor", content="Test message")]

        result = await event.detect_event(conversations)

        assert result is True
        assert event.data.positive_examples == positive_examples
        assert len(event.data.positive_examples) == 5

    async def test_classify_with_single_example_in_each_category(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=True
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        data = BinaryClassifierData(
            class_name="greeting",
            positive_examples=[Example(text="Hello!")],
            negative_examples=[Example(text="Goodbye!")],
        )
        event = BinaryClassifierEvent.create(event_id="test_event", data=data)

        conversations = [ChatMessage(role="counselor", content="Hi there!")]

        result = await event.detect_event(conversations)

        assert result is True
        assert len(event.data.positive_examples) == 1
        assert len(event.data.negative_examples) == 1

    async def test_default_model_is_gpt_4o_mini(self):
        data = BinaryClassifierData(class_name="test")
        event = BinaryClassifierEvent.create(event_id="test_event", data=data)

        assert event.model == "gpt-4o-mini"

    async def test_custom_model_can_be_set(self):
        data = BinaryClassifierData(class_name="test")
        event = BinaryClassifierEvent.create(
            event_id="test_event", data=data, model="gpt-4o"
        )

        assert event.model == "gpt-4o"

    async def test_classify_uses_correct_model(self):
        mock_openai_client = AsyncMock()

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.parsed = ClassificationResultStrOp(
            is_class=True
        )
        mock_openai_client.beta.chat.completions.parse = AsyncMock(
            return_value=mock_completion
        )

        # Set the mock client directly
        BinaryClassifierEvent._CLIENT = mock_openai_client

        data = BinaryClassifierData(class_name="test")
        event = BinaryClassifierEvent.create(
            event_id="test_event", data=data, model="gpt-4o"
        )

        conversations = [ChatMessage(role="counselor", content="Test message")]

        await event.detect_event(conversations)

        call_args = mock_openai_client.beta.chat.completions.parse.call_args
        assert call_args.kwargs["model"] == "gpt-4o"
