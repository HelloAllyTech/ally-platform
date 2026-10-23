from enum import Enum
from typing import Any, ClassVar, List, Optional, Tuple

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings
from app.core.events.base import ChatMessage
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)


# TODO: Remove this redundant class and combine ClassificationResultStrOp from
# app.core.events.event_types.binary_classifier.schemas
class ClassificationResultStrOp(BaseModel):
    """Structured output format for binary classification results."""

    is_class: bool


class SimulationBehaviorCategory(str, Enum):
    """Category of helper behavior in the simulation."""

    SHOULD_DO = "SHOULD_DO"
    SHOULD_NOT_DO = "SHOULD_NOT_DO"


class StateMatchedInstruction(BaseModel):
    """Agent response instruction for a specific state, scoped to one behavior."""

    state_id: str = Field(
        ...,
        alias="stateId",
        description=(
            "The state ID this instruction applies to "
            "(matches SimulationStateInstruction.state_id)"
        ),
    )
    instruction: str = Field(
        ...,
        alias="instruction",
        description=(
            "How the agent should respond when this behavior is detected "
            "in this state. Use open-ended behavioral guidance to avoid "
            "repetitive responses."
        ),
    )

    model_config = ConfigDict(populate_by_name=True)


class SimulationBehaviorInstruction(BaseModel):
    """
    Describes what the helper should or should not do, and the
    agent's response per state.
    """

    behavior_instruction_id: Optional[str] = Field(
        default=None,
        alias="behaviorInstructionId",
        description="Unique identifier for this behavior instruction from core service",
    )
    category: SimulationBehaviorCategory = Field(
        ...,
        description="Whether the helper should or should not exhibit these behaviors",
    )
    behaviors: List[str] = Field(
        ..., description="List of behavior labels (e.g. 'Validated experience')"
    )
    score: int = Field(..., description="Score assigned to this behavior instruction")
    state_matched_instructions: Optional[List[StateMatchedInstruction]] = Field(
        default=None,
        alias="stateMatchedInstructions",
        description=(
            "Per-state agent instructions. When this behavior is detected, "
            "the entry matching the current state_id is injected into the "
            "prompt."
        ),
    )
    actors_responses: Optional[List[str]] = Field(
        default=None,
        alias="actorsResponses",
        description="[DEPRECATED] Use state_matched_instructions instead. "
        "Will be removed in a future version.",
    )
    model: str = Field(
        default="gpt-4o-mini",
        exclude=True,
        description="Model to use for behavior classification",
    )

    model_config = ConfigDict(populate_by_name=True)

    # Shared client across all instances to avoid per-call SSL/connection overhead
    _CLIENT: ClassVar[Optional[AsyncOpenAI]] = None

    @classmethod
    def _get_client(cls) -> AsyncOpenAI:
        if cls._CLIENT is None:

            cls._CLIENT = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        return cls._CLIENT

    async def detect(
        self, conversations: List[ChatMessage], prompt_data: Optional[Any] = None
    ) -> bool:
        """
        Detect if the counselor's latest message exhibits any of the
        behaviors listed in this instruction.

        Follows the same pattern as BinaryClassifierEvent.detect_event.

        Args:
            conversations: List of chat messages in the conversation.
            prompt_data: Optional prompt data for template resolution.

        Returns:
            True if any behavior in this instruction is detected.
        """
        if not conversations:
            return False

        last = conversations[-1]
        if last.role.lower() != "counselor":
            return False

        return await self._classify(last.content, prompt_data=prompt_data)

    async def _classify(self, text: str, prompt_data: Optional[Any] = None) -> bool:
        """
        Classify whether the counselor's message exhibits any of the
        listed behaviors using OpenAI structured output.

        Uses the same OpenAI native client pattern as BinaryClassifierEvent
        to avoid LiveKit issue #2836.
        """
        if not text.strip():
            return False

        try:
            from openai.types.chat import (
                ChatCompletionSystemMessageParam,
                ChatCompletionUserMessageParam,
            )

            from app.core.config import settings

            if not settings.OPENAI_API_KEY:
                logger.warning(
                    "OpenAI API key not configured, skipping behavior detection"
                )
                return False

            client = self._get_client()

            system_prompt, user_prompt = self._get_behavior_detection_prompt(
                text, prompt_data=prompt_data
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
                task=LLMTask.BEHAVIOUR_DETECTION.value,
                model=self.model,
                provider="openai",
            )

            result = completion.choices[0].message.parsed

            # For SHOULD_NOT_DO, we want to return True if behavior is detected
            # For SHOULD_DO, we want to return True if behavior is detected
            # The logic is the same - just checking if behavior exists
            detected = result.is_class

            logger.info(
                f"Behavior detection for '{self.behaviors}' "
                f"(category={self.category.value}): "
                f"text='{text[:50]}...', detected={detected}"
            )

            return detected

        except Exception as e:
            logger.exception(
                f"Failed to classify behavior instruction "
                f"{self.behavior_instruction_id}: {e}"
            )
            return False

    def _get_behavior_detection_prompt(
        self, message: str, prompt_data: Optional[Any] = None
    ) -> Tuple[str, str]:
        """
        Build the classification prompt for behavior detection.

        Uses a single prompt that checks if the counselor exhibited any of the
        listed behaviors, regardless of whether they are SHOULD_DO or SHOULD_NOT_DO.

        Returns:
            Tuple of (system_prompt, user_prompt).
        """
        behaviors_list = ", ".join(f'"{b}"' for b in self.behaviors)

        system_prompt = load_and_format(
            "events/behavior_detection_system",
            prompt_data=prompt_data,
            behaviors=behaviors_list,
        )

        user_prompt = load_and_format(
            "events/behavior_detection_user",
            prompt_data=prompt_data,
            message=message,
        )

        return system_prompt, user_prompt


class SimulationStateInstruction(BaseModel):
    """
    Defines a score-bounded state. Agent response instructions live on
    SimulationBehaviorInstruction.
    """

    state_id: str = Field(
        ..., alias="stateId", description="State identifier (e.g. '1')"
    )
    score_lower: Optional[int] = Field(
        default=None,
        alias="scoreLower",
        description="Lower score limit for this state (None represents -infinity)",
    )
    score_upper: Optional[int] = Field(
        default=None,
        alias="scoreUpper",
        description="Upper score limit for this state (None represents +infinity)",
    )
    instruction: Optional[str] = Field(
        default=None,
        description=(
            "[DEPRECATED] Use StateMatchedInstruction on each "
            "SimulationBehaviorInstruction instead. Will be removed in a "
            "future version."
        ),
    )
    dialogues: Optional[List[str]] = Field(
        default=None,
        description=(
            "[DEPRECATED] Use StateMatchedInstruction on each "
            "SimulationBehaviorInstruction instead. Will be removed in a "
            "future version."
        ),
    )

    model_config = ConfigDict(populate_by_name=True)
