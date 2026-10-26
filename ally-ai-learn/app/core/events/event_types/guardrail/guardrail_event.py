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

import time
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

    # Which classifier this guardrail uses (independent of governance):
    # - CATEGORY: shared classifier; fires on coherent content matching the
    #   category (rude, directive, ...).
    # - COHERENCE: dedicated, precision-biased classifier with recent
    #   conversation context + few-shot; must NOT fire on coherent, on-topic
    #   content (used by the STT Coherence Guard).
    detector_type: str = "CATEGORY"

    # ---- COHERENCE escalation state (per session; the event instance is
    # rebuilt per job from the scenario metadata, so these are session-scoped).
    #
    # Declared as ordinary fields rather than pydantic private attrs because
    # these events are built with `model_construct`, which does not initialise
    # private attributes. They are never serialized: serialize_event()
    # (app/core/graph/utils.py) builds an explicit dict, so adding fields here
    # does not change the wire contract with Core.
    #
    # Only used when detector_type == "COHERENCE". See
    # app/core/events/coherence_guard.py for the policy and the chosen values.
    coherence_consecutive_misses: int = 0
    coherence_escalations: int = 0
    #: monotonic deadline; the guard does not fire again before this.
    coherence_quiet_until: Optional[float] = None
    #: The author's (or platform default's) ordinary instruction, kept so an
    #: escalation can be swapped in and then swapped back out.
    coherence_normal_instruction: Optional[object] = None
    coherence_escalation_instruction: Optional[object] = None

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
        if self.detector_type == "COHERENCE" and self._coherence_exhausted():
            # Once the escalation budget is spent the policy answers False for
            # the rest of the session whatever the classifier says, so don't
            # pay for (or gate the reply on) a classification it would discard.
            logger.info(
                "[COHERENCE] event=%s suppressed for the rest of the session "
                "(%d escalation(s) used); classification skipped",
                self.event_id,
                self.coherence_escalations,
            )
            return False
        context = self._format_context(conversations[:-1])
        violation = await self._classify(last.content, context)
        if self.detector_type != "COHERENCE":
            return violation
        return self._apply_coherence_policy(violation)

    # ------------------------------------------------------------------
    # COHERENCE escalation policy
    # ------------------------------------------------------------------

    def _coherence_exhausted(self) -> bool:
        """Whether the session's escalation budget is spent.

        From then on ``_apply_coherence_policy`` returns False on every turn:
        the escalation count only grows and the cap is fixed, and the streak
        and instruction it still updates feed only decisions it can no longer
        make. Errs toward classifying: on any error this says False, so the
        policy's own fallback to the raw classifier result still applies.
        """
        try:
            from app.core.events import coherence_guard as policy

            return self.coherence_escalations >= policy.max_escalations()
        except Exception:  # noqa: BLE001
            return False

    def _apply_coherence_policy(self, violation: bool) -> bool:
        """Decide whether a classified coherence violation should actually fire.

        Without this, GUARDRAIL's always-resend behaviour plus empty detection
        limits meant a learner the STT keeps mismatching could be asked to
        repeat forever, in the same words. See
        app/core/events/coherence_guard.py for the policy and why each number
        is what it is.

        Fully guarded: on any internal error, fall back to the raw classifier
        result — degrading to the previous (loop-prone) behaviour is much
        better than dropping the only mis-transcription mitigation there is.
        """
        try:
            from app.core.events import coherence_guard as policy

            if not violation:
                # A coherent turn breaks the streak. Cooldowns and the
                # escalation count deliberately survive it: they are
                # per-session budgets, not per-streak.
                if self.coherence_consecutive_misses:
                    logger.info(
                        "[COHERENCE] event=%s streak reset (coherent turn)",
                        self.event_id,
                    )
                self.coherence_consecutive_misses = 0
                self._restore_normal_instruction()
                return False

            now = time.monotonic()
            self.coherence_consecutive_misses += 1
            streak = self.coherence_consecutive_misses

            cap = policy.max_escalations()
            if self.coherence_escalations >= cap:
                # The guard has escalated its budget and the learner is still
                # not getting through. Continuing to interject is nagging; the
                # predictable neutral fallback is to let the persona respond to
                # what it heard.
                logger.warning(
                    "[COHERENCE] event=%s SUPPRESSED for the rest of the "
                    "session: %d escalation(s) already used (streak=%d)",
                    self.event_id,
                    self.coherence_escalations,
                    streak,
                )
                return False

            quiet_until = self.coherence_quiet_until
            if quiet_until is not None and now < quiet_until:
                logger.info(
                    "[COHERENCE] event=%s suppressed by cooldown "
                    "(%.1fs remaining, streak=%d)",
                    self.event_id,
                    quiet_until - now,
                    streak,
                )
                return False

            if streak >= policy.escalate_after():
                self._install_escalation_instruction()
                self.coherence_escalations += 1
                # Reset the streak so the very next garbled turn does not
                # escalate again the moment the cooldown lapses.
                self.coherence_consecutive_misses = 0
                self.coherence_quiet_until = now + policy.escalation_cooldown_s()
                logger.warning(
                    "[COHERENCE] event=%s ESCALATING after %d consecutive "
                    "misunderstandings (escalation %d/%d); guard quiet for %.0fs",
                    self.event_id,
                    streak,
                    self.coherence_escalations,
                    cap,
                    policy.escalation_cooldown_s(),
                )
                return True

            self._restore_normal_instruction()
            self.coherence_quiet_until = now + policy.min_gap_s()
            logger.info(
                "[COHERENCE] event=%s firing ordinary repeat request "
                "(streak=%d, escalates at %d)",
                self.event_id,
                streak,
                policy.escalate_after(),
            )
            return True
        except Exception:  # noqa: BLE001
            logger.exception(
                "[COHERENCE] escalation policy failed for event=%s; falling "
                "back to the raw classifier result",
                self.event_id,
            )
            return violation

    def _install_escalation_instruction(self) -> None:
        """Swap the repeat-request instruction for the escalation one."""
        from app.core.branching_instructions.base import BranchingInstruction
        from app.core.events.coherence_guard import COHERENCE_ESCALATION_ACTOR_DIALOGUE

        if self.coherence_normal_instruction is None:
            self.coherence_normal_instruction = self.branching_instruction
        if self.coherence_escalation_instruction is None:
            self.coherence_escalation_instruction = BranchingInstruction.create(
                COHERENCE_ESCALATION_ACTOR_DIALOGUE, prompt_data=None
            )
        self.branching_instruction = self.coherence_escalation_instruction

    def _restore_normal_instruction(self) -> None:
        """Put the author's ordinary instruction back after an escalation."""
        if (
            self.coherence_normal_instruction is not None
            and self.branching_instruction is self.coherence_escalation_instruction
        ):
            self.branching_instruction = self.coherence_normal_instruction

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
            # Recorded as soon as the call returns, before parsing. No
            # explicit room: this only runs inside a graph node (or a task spawned
            # from one), where the room context var is set.
            from app.core.llm_usage.emitter import emit_openai_usage
            from app.core.llm_usage.tasks import LLMTask

            emit_openai_usage(
                completion,
                task=LLMTask.GUARDRAIL_CHECK.value,
                model=self.model,
                provider="ollama" if self.llm_base_url else "openai",
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
