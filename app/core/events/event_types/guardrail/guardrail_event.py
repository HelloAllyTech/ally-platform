"""
Guardrail event detection using binary classification.

Each GuardrailEvent wraps one guardrail entry from the backend.
Uses binary classification via the configured LLM provider (OpenAI, Ollama, etc.)
to detect when the counselor's utterance violates a guardrail boundary.

Unlike BinaryClassifierEvent which hardcodes OpenAI, GuardrailEvent routes
through the LLM factory so it respects the scenario's llm_config — meaning
it works with Ollama, vLLM, or any other configured provider.

When triggered, actorDialogue is used as branching instruction to guide
the agent's response.
"""

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
from app.core.events.event_types.binary_classifier.schemas import (
    ClassificationResultStrOp,
)
from app.core.events.event_types.guardrail.schemas import GuardrailData
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)


def _get_openai_client(base_url: Optional[str] = None) -> AsyncOpenAI:
    """
    Create an AsyncOpenAI client pointing to either OpenAI or a local provider.

    When base_url is provided (e.g. Ollama at http://localhost:11434/v1),
    the client talks to that endpoint instead of OpenAI's API.
    api_key is still required by the SDK but ignored by local providers.
    """
    return AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY or "ollama",
        base_url=base_url,
    )


class GuardrailEvent(BaseEvent):
    """
    Fires when the counselor's utterance is classified as violating
    a guardrail boundary.

    Routes through the same prompt infrastructure as BinaryClassifierEvent
    but respects the configured LLM provider (OpenAI, Ollama, vLLM).

    Properties:
    - PASSIVE visibility — no score card shown to counselor
    - score = 0 — no scoring impact
    - trigger_multiple = True — can fire multiple times per session
    """

    detection_type: DetectionType = DetectionType.GUARDRAIL
    data: GuardrailData
    model: str = "gpt-4o-mini"

    # Optional base_url — set to Ollama URL when using local provider
    # None means use OpenAI
    llm_base_url: Optional[str] = None

    # USER (category) guardrails use the shared classifier and must fire on
    # coherent, on-topic statements that match their category. SYSTEM guardrails
    # (e.g. the STT Coherence Guard) have the OPPOSITE bias — they must NOT fire
    # on coherent content — so they route to a dedicated, precision-biased
    # classifier prompt with conversation context and few-shot examples.
    kind: str = "USER"

    # Shared client cache per base_url
    _CLIENTS: ClassVar[dict] = {}

    @classmethod
    def _get_client(cls, base_url: Optional[str] = None) -> AsyncOpenAI:
        key = base_url or "openai"
        if key not in cls._CLIENTS:
            cls._CLIENTS[key] = _get_openai_client(base_url)
        return cls._CLIENTS[key]

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: GuardrailData,
        model: str = "gpt-4o-mini",
        llm_base_url: Optional[str] = None,
        visibility_type=None,
        detection_type: DetectionType = DetectionType.GUARDRAIL,
        **kwargs,
    ) -> "GuardrailEvent":
        inst: GuardrailEvent = cls.model_construct(
            event_id=event_id,
            detection_type=detection_type,
            data=data,
            model=model,
            llm_base_url=llm_base_url,
            visibility_type=visibility_type,
            **kwargs,
        )
        return inst

    # Number of preceding turns shown to the classifier as context. Enough to
    # judge whether an utterance is on-topic / coherent without bloating the
    # prompt.
    _CONTEXT_TURNS: ClassVar[int] = 6

    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        if not conversations:
            return False
        last = conversations[-1]
        if last.role.lower() != "counselor":
            return False
        context = self._format_context(conversations[:-1])
        return await self._classify(last.content, context)

    @classmethod
    def _format_context(cls, history: List[ChatMessage]) -> str:
        """Render the most recent turns as 'Role: content' lines for the
        classifier. Used so guardrails whose boundary concerns relevance /
        coherence (e.g. the STT Coherence Guard) can tell an off-topic
        mistranscription apart from a legitimate topic change."""
        recent = [
            m for m in history[-cls._CONTEXT_TURNS :] if m.content and m.content.strip()
        ]
        if not recent:
            return "(no prior conversation)"
        return "\n".join(f"{m.role}: {m.content}" for m in recent)

    async def _classify(self, text: str, conversation_context: str = "") -> bool:
        if not text.strip():
            return False
        try:
            client = self._get_client(self.llm_base_url)

            if self.kind == "SYSTEM":
                # Coherence/system guardrails: dedicated precision-biased prompt
                # that uses recent conversation context and few-shot examples.
                system_prompt = load_and_format(
                    "events/coherence_guardrail_system",
                    helper_dialogue=self.data.helper_dialogue,
                )
                user_prompt = load_and_format(
                    "events/coherence_guardrail_user",
                    counselor_message=text,
                    conversation_context=conversation_context
                    or "(no prior conversation)",
                )
            else:
                # Category guardrails: shared classifier (unchanged behavior).
                system_prompt = load_and_format(
                    "events/guardrail_system",
                    helper_dialogue=self.data.helper_dialogue,
                )
                user_prompt = load_and_format(
                    "events/guardrail_user",
                    counselor_message=text,
                )

            messages = [
                ChatCompletionSystemMessageParam(content=system_prompt, role="system"),
                ChatCompletionUserMessageParam(content=user_prompt, role="user"),
            ]

            completion = await client.beta.chat.completions.parse(
                model=self.model,
                messages=messages,
                response_format=ClassificationResultStrOp,
            )

            result = completion.choices[0].message.parsed

            logger.info(
                "Guardrail classification | event=%s | "
                "is_violation=%s | counselor='%s...' | boundary='%s...'",
                self.event_id,
                result.is_class,
                text[:60],
                self.data.helper_dialogue[:60],
            )

            return result.is_class

        except Exception as e:
            logger.exception(
                "GuardrailEvent %s: classification failed: %s",
                self.event_id,
                e,
            )
            return False
