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

import asyncio
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
from app.core.events.event_types.guardrail.coherence_prefilter import CoherencePrefilter
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

    # Which classifier this guardrail uses (independent of governance):
    # - CATEGORY: shared classifier; fires on coherent content matching the
    #   category (rude, directive, ...).
    # - COHERENCE: dedicated, precision-biased classifier with recent
    #   conversation context + few-shot; must NOT fire on coherent, on-topic
    #   content (used by the STT Coherence Guard).
    detector_type: str = "CATEGORY"

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

        # Shadow-mode instrumentation only (COHERENCE guards specifically —
        # the pre-filter's signals are designed for mis-transcription, not
        # the CATEGORY guards' content-boundary checks). Runs concurrently
        # with the real call so it never adds latency, and its result is
        # only ever logged, never returned. See CoherencePrefilter's module
        # docstring for why this doesn't gate anything yet.
        if (
            self.detector_type == "COHERENCE"
            and settings.COHERENCE_PREFILTER_SHADOW_ENABLED
        ):
            real_result, _ = await asyncio.gather(
                self._classify(last.content, context),
                self._log_shadow_prefilter(last.content, context),
            )
            return real_result

        return await self._classify(last.content, context)

    async def _log_shadow_prefilter(self, counselor_message: str, context: str) -> None:
        """Best-effort: compute and log the shadow pre-filter's verdict.

        Never raises — a failure here must never affect the real guard.
        """
        try:
            # Deferred: app.core.graph (which owns get_room_id) imports this
            # module transitively via app.core.scenario.base, so a top-level
            # import here would be circular.
            from app.core.graph.instrumentation import get_room_id

            would_flag, drift_score = await CoherencePrefilter.would_flag(
                counselor_message, context
            )
            logger.info(
                "[GUARDRAIL_SHADOW] event=%s | room=%s | "
                "prefilter_would_flag=%s | drift_score=%s | counselor='%s...'",
                self.event_id,
                get_room_id(),
                would_flag,
                f"{drift_score:.3f}" if drift_score is not None else "n/a",
                counselor_message[:60],
            )
        except Exception as e:
            logger.debug(f"[GUARDRAIL_SHADOW] failed for {self.event_id}: {e}")

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
        # Deferred: see the matching comment in _log_shadow_prefilter.
        from app.core.graph.instrumentation import get_room_id

        if not text.strip():
            return False
        try:
            client = self._get_client(self.llm_base_url)

            if self.detector_type == "COHERENCE":
                # Coherence guardrails: dedicated precision-biased prompt that
                # uses recent conversation context and few-shot examples.
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
                "Guardrail classification | event=%s | room=%s | "
                "is_violation=%s | counselor='%s...' | boundary='%s...'",
                self.event_id,
                get_room_id(),
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
