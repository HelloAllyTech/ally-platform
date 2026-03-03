from typing import ClassVar, List, Optional

from openai import AsyncOpenAI
from openai.types.chat import (
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)
from typing_extensions import override

from app.core.config import settings
from app.core.constants import DetectionType
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.binary_classifier.prompts import (
    get_binary_classifier_prompt,
)
from app.core.events.event_types.binary_classifier.schemas import (
    BinaryClassifierData,
    ClassificationResultStrOp,
)
from app.core.logger import get_logger

logger = get_logger(__name__)


class BinaryClassifierEvent(BaseEvent):
    detection_type: DetectionType = DetectionType.BINARY_CLASSIFIER
    data: BinaryClassifierData
    model: str = "gpt-4o-mini"  # Default model for classification

    # Shared client across all instances to avoid per-call SSL/connection overhead
    _CLIENT: ClassVar[Optional[AsyncOpenAI]] = None

    @classmethod
    def _get_client(cls) -> AsyncOpenAI:
        if cls._CLIENT is None:
            cls._CLIENT = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        return cls._CLIENT

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: BinaryClassifierData,
        model: str = "gpt-4o-mini",
        visibility_type=None,
        detection_type: DetectionType = DetectionType.BINARY_CLASSIFIER,
        **kwargs,
    ) -> "BinaryClassifierEvent":
        inst: BinaryClassifierEvent = cls.model_construct(
            event_id=event_id,
            visibility_type=visibility_type,
            detection_type=detection_type,
            data=data,
            model=model,
            **kwargs,
        )
        return inst

    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        if not conversations:
            return False

        last = conversations[-1]
        if last.role.lower() != "counselor":
            return False

        return await self._classify(last.content)

    async def _classify(self, text: str) -> bool:
        """
        Classify text using OpenAI's native AsyncOpenAI client with structured outputs.

        This implementation uses OpenAI's beta.chat.completions.parse API instead of
        LangChain to work around LiveKit issue #2836 where intermediate LLM results
        are being spoken by the agent.

        See: https://github.com/livekit/agents/issues/2836
        """
        if not text.strip():
            return False

        try:
            # Use OpenAI's native client to avoid LiveKit streaming issue
            # Livekit has known issue where all messages wrapped in
            # AIMessageChunk will be spoken by the agent
            # See: https://github.com/livekit/agents/issues/2836
            client = self._get_client()

            system_prompt, user_prompt = get_binary_classifier_prompt(
                self.data.class_name,
                text,
                self.data.positive_examples,
                self.data.negative_examples,
            )

            messages = [
                ChatCompletionSystemMessageParam(content=system_prompt, role="system"),
                ChatCompletionUserMessageParam(content=user_prompt, role="user"),
            ]

            # Use beta.chat.completions.parse for structured output without streaming
            # This returns pure structured data that won't be spoken by the agent
            completion = await client.beta.chat.completions.parse(
                model=self.model,
                messages=messages,
                response_format=ClassificationResultStrOp,
            )

            result = completion.choices[0].message.parsed

            logger.info(
                f"Binary classification for class '{self.data.class_name}': "
                f"text='{text[:50]}...', result={result.is_class}"
            )

            return result.is_class

        except Exception as e:
            logger.exception(f"Failed to classify text with LLM: {e}")
            return False
