"""
Helper paraphrased event using OpenAI LLM to detect if counselor
paraphrased the agent's previous message.
"""

from typing import List, Optional

from openai import AsyncOpenAI
from openai.types.chat import (
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)
from typing_extensions import override

from app.core.config import settings
from app.core.constants import DetectionType
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.helper_paraphrased.constants import (
    HelperParaphrasedData,
)
from app.core.events.event_types.helper_paraphrased.prompts import (
    get_paraphrase_evaluation_prompt,
)
from app.core.events.event_types.helper_paraphrased.schemas import ParaphraseResult
from app.core.logger import get_logger

logger = get_logger(__name__)


class HelperParaphrasedEvent(BaseEvent):
    """
    Event that detects if the counselor (helper) has paraphrased
    the agent's previous message.

    This event uses OpenAI LLM to evaluate if the counselor's message
    is a paraphrase of the agent's previous message, returning a boolean
    indicating whether paraphrasing occurred.
    """

    detection_type: DetectionType = DetectionType.HELPER_PARAPHRASED
    data: HelperParaphrasedData = HelperParaphrasedData()
    model: str = "gpt-4o-mini"  # Default model for paraphrase evaluation

    #: The session's prompt data (Skills Store text in ``prompts``), so the
    #: classifier prompts render from the store rather than the local defaults.
    prompt_data: Optional[object] = None

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: HelperParaphrasedData,
        visibility_type=None,
        detection_type: DetectionType = DetectionType.HELPER_PARAPHRASED,
        model: str = "gpt-4o-mini",
        **kwargs,
    ) -> "HelperParaphrasedEvent":
        """
        Create a HelperParaphrasedEvent with typed data.

        Args:
            event_id: Event identifier
            data: HelperParaphrasedData instance
            visibility_type: Visibility type (optional)
            detection_type: Detection type (defaults to HELPER_PARAPHRASED)
            model: OpenAI model name (defaults to "gpt-4o-mini")
            **kwargs: Other BaseEvent fields (score, emoji, show_feedback, etc.)
        """
        inst = cls.model_construct(
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
        """
        Detect if the counselor has paraphrased the agent's previous message.

        This method:
        1. Gets the last agent message
        2. Gets the last counselor message
        3. Uses OpenAI LLM to evaluate if counselor paraphrased agent
        4. Returns True if paraphrasing is detected, False otherwise

        Args:
            conversations: List of chat messages

        Returns:
            True if paraphrasing is detected, False otherwise
        """
        if not conversations or len(conversations) < 2:
            return False

        # The last message should be from counselor (this is what triggered the check)
        last_message = conversations[-1]
        if last_message.role.lower() != "counselor":
            return False

        counselor_msg = last_message

        # Find the most recent agent (client) message BEFORE the counselor message
        # Note: Agent messages have role "client" (from AIMessage conversion)
        last_agent_msg = None
        for msg in reversed(conversations[:-1]):  # Exclude the last (counselor) message
            role_lower = msg.role.lower()
            # Agent messages are stored as "client" in ChatMessage
            if role_lower in ("agent", "client"):
                last_agent_msg = msg
                break  # Found the most recent agent message

        # Must have an agent message before the counselor message
        if not last_agent_msg:
            return False

        # Counselor message must come after agent message
        # (counselor paraphrasing what agent just said)
        if not last_agent_msg.content or not counselor_msg.content:
            return False

        # Use OpenAI LLM to evaluate if counselor paraphrased agent
        is_paraphrase = await self._evaluate_paraphrase(
            last_agent_msg.content, counselor_msg.content
        )

        return is_paraphrase

    async def _evaluate_paraphrase(
        self, agent_message: str, counselor_message: str
    ) -> bool:
        """
        Evaluate if counselor paraphrased agent using OpenAI LLM.

        This implementation uses OpenAI's native AsyncOpenAI client with
        structured outputs to avoid LiveKit issue #2836 where intermediate
        LLM results are being spoken by the agent.

        See: https://github.com/livekit/agents/issues/2836

        Args:
            agent_message: The agent's message
            counselor_message: The counselor's message

        Returns:
            True if paraphrasing is detected, False otherwise
        """
        if not agent_message.strip() or not counselor_message.strip():
            return False

        # Use OpenAI's native client to avoid LiveKit streaming issue
        # Livekit has known issue where all messages wrapped in
        # AIMessageChunk will be spoken by the agent
        # See: https://github.com/livekit/agents/issues/2836
        # Use same pattern as OpenAILLMClient: api_key or settings.OPENAI_API_KEY
        api_key = settings.OPENAI_API_KEY
        if not api_key:
            raise ValueError("OpenAI requires OPENAI_API_KEY in settings")
        client = AsyncOpenAI(api_key=api_key)

        system_prompt, user_prompt = get_paraphrase_evaluation_prompt(
            agent_message, counselor_message, prompt_data=self.prompt_data
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
            response_format=ParaphraseResult,
        )
        # Recorded as soon as the call returns, before parsing. No
        # explicit room: this only runs inside a graph node (or a task spawned
        # from one), where the room context var is set.
        from app.core.llm_usage.emitter import emit_openai_usage
        from app.core.llm_usage.tasks import LLMTask

        emit_openai_usage(
            completion,
            task=LLMTask.HELPER_PARAPHRASED.value,
            model=self.model,
            provider="openai",
        )

        result = completion.choices[0].message.parsed
        return result.is_paraphrase
