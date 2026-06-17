"""
Centralized schemas for event orchestrator and related structures.
"""

import time
from datetime import datetime
from enum import Enum
from typing import Optional, TypedDict

from pydantic import BaseModel, Field

from app.core.constants import DetectionType
from app.core.events.base import ChatMessage
from app.core.events.event_types.combination.constants import ExpressionNode
from app.core.time_utils import get_current_iso_timestamp
from app.core.time_utils import get_current_iso_timestamp as get_iso_timestamp


class CoreMessageType(str, Enum):
    MESSAGE = "message"
    EVENT = "event"
    BEHAVIOR_INSTRUCTION = "behavior_instruction"
    TURN_METRICS = "turn_metrics"


class TurnMetricsData(BaseModel):
    """Per-turn latency metrics shipped to Core for the latency dashboards.

    All *_ms fields are integer milliseconds. ``response_latency_ms`` is the
    headline metric (user stops speaking -> agent starts speaking); the rest is
    the breakdown so a bottleneck can be pinpointed. Breakdown fields are
    optional because some stages are skipped or not always measured.
    """

    turn_index: int
    response_latency_ms: int
    invocation_id: Optional[str] = None

    # Framework timings (LiveKit MetricsCollectedEvent)
    eou_delay_ms: Optional[int] = None
    llm_ttft_ms: Optional[int] = None
    tts_ttfb_ms: Optional[int] = None

    # App-stage timings (graph nodes)
    orchestration_ms: Optional[int] = None
    llm_response_ms: Optional[int] = None
    prosody_ms: Optional[int] = None
    branching_ms: Optional[int] = None
    knowledge_retrieval_ms: Optional[int] = None
    # Parallel fan-out branch totals (for fan-in bottleneck analysis)
    process_events_ms: Optional[int] = None
    behaviors_ms: Optional[int] = None

    # Dimensions / flags
    scenario_id: Optional[int] = None
    language: Optional[str] = None
    llm_model: Optional[str] = None
    # Inference provider for llm_model ('openai' | 'gemini' | 'anthropic') and
    # the generation params used — captured so drift analytics can attribute
    # behaviour to a specific (provider, model, params) experiment tuple.
    llm_provider: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    env: Optional[str] = None
    response_chars: Optional[int] = None
    events_detected: Optional[int] = None
    prosody_skipped: Optional[bool] = None
    llm_timed_out: Optional[bool] = None
    interrupted: Optional[bool] = None
    metadata: Optional[dict] = None


class EventRegistryEntry(BaseModel):
    """
    Structure for an event registry entry.

    Attributes:
        happened: Whether the event has occurred/is active
        trigger_multiple: True for sentence similarity events (can trigger
                         multiple times),
                         False for time/score/combination events
                         (trigger once)
    """

    happened: bool = False
    trigger_multiple: bool = False
    occurred_at: Optional[datetime] = None
    # Number of times the event actually fired (sent to UI/Core).
    # Used by max_occurrences to cap how many times the event can trigger.
    occurrence_count: int = 0
    # Number of times the underlying detection condition was TRUE,
    # regardless of whether the event actually fired.
    # Used by occurrence_interval to fire only on every Nth detection.
    detection_count: int = 0


class ExpressionListEntry(TypedDict):
    """
    Structure for an expression list entry (combination events).

    Attributes:
        event_id: The event ID this expression belongs to
        type: The detection type (should be COMBINATION)
        expression: The expression node to evaluate
    """

    event_id: str
    type: DetectionType
    expression: ExpressionNode


class CustomUIEventMessageTypeData(BaseModel):
    """Schema for custom event data payload."""

    score: Optional[int] = Field(None, description="Event score")
    emoji: Optional[str] = Field(..., description="Event emoji")
    message: Optional[str] = Field(..., description="Event message")
    show_feedback: bool = Field(..., description="Show feedback button")
    event_id: Optional[str] = Field(
        None, description="ID of the event that triggered feedback"
    )
    detected_event_ids: Optional[list[str]] = Field(
        None, description="List of all detected event IDs"
    )


class CoreEventType(BaseModel):
    """Core event data structure."""

    event_data: dict = None
    timestamp: Optional[str] = None  # store as ISO string for consistency

    @classmethod
    def create(
        cls, timestamp: Optional[str] = None, event_data: dict = None
    ) -> "CoreEventType":
        if timestamp is None:
            timestamp = get_current_iso_timestamp()
        return cls(timestamp=timestamp, event_data=event_data)


class CoreBehaviorInstructionType(BaseModel):
    """Core behavior instruction data structure for BE."""

    behavior_instruction_data: dict = None
    timestamp: Optional[str] = None

    @classmethod
    def create(
        cls,
        timestamp: Optional[str] = None,
        behavior_instruction_data: dict = None,
    ) -> "CoreBehaviorInstructionType":
        if timestamp is None:
            timestamp = get_current_iso_timestamp()
        return cls(
            timestamp=timestamp,
            behavior_instruction_data=behavior_instruction_data,
        )


class CoreEventMessageTypeData(BaseModel):
    """Data payload for core event messages."""

    chat_message: Optional[ChatMessage] = Field(
        default=None, description="Message from user or agent"
    )
    event: Optional[CoreEventType] = Field(
        default=None, description="Event ID of an event"
    )
    behavior_instruction: Optional[CoreBehaviorInstructionType] = Field(
        default=None, description="Behavior instruction detection result"
    )
    turn_metrics: Optional[TurnMetricsData] = Field(
        default=None, description="Per-turn latency metrics"
    )


class CoreEventMessageType(BaseModel):
    """Schema for core event messages."""

    message_type: CoreMessageType
    data: CoreEventMessageTypeData
    room_id: str
    timestamp: int

    @classmethod
    def create(
        cls,
        room_id: str,
        chat_message: Optional[ChatMessage] = None,
        event_data: dict = None,
    ) -> "CoreEventMessageType":
        event = None
        if event_data:
            event = CoreEventType.create(event_data=event_data)

        return cls(
            message_type=(
                CoreMessageType.MESSAGE if chat_message else CoreMessageType.EVENT
            ),
            data=CoreEventMessageTypeData(chat_message=chat_message, event=event),
            room_id=room_id,
            timestamp=int(time.time()),
        )

    @classmethod
    def create_behavior_instruction(
        cls,
        room_id: str,
        behavior_instruction_data: dict = None,
    ) -> "CoreEventMessageType":
        """Create a behavior instruction message for BE."""
        behavior_instruction = None
        if behavior_instruction_data:
            behavior_instruction = CoreBehaviorInstructionType.create(
                behavior_instruction_data=behavior_instruction_data,
            )

        return cls(
            message_type=CoreMessageType.BEHAVIOR_INSTRUCTION,
            data=CoreEventMessageTypeData(
                behavior_instruction=behavior_instruction,
            ),
            room_id=room_id,
            timestamp=int(time.time()),
        )

    @classmethod
    def create_turn_metrics(
        cls,
        room_id: str,
        turn_metrics: TurnMetricsData,
    ) -> "CoreEventMessageType":
        """Create a per-turn latency metrics message for Core."""
        return cls(
            message_type=CoreMessageType.TURN_METRICS,
            data=CoreEventMessageTypeData(turn_metrics=turn_metrics),
            room_id=room_id,
            timestamp=int(time.time()),
        )


class CustomUIEventMessageType(BaseModel):
    """Schema for custom event sent to frontend."""

    version: str = Field(default="1.0", description="Event format version")
    data: CustomUIEventMessageTypeData = Field(..., description="Event data payload")
    timestamp: str = Field(..., description="ISO timestamp when event occurred")

    @classmethod
    def create(
        cls,
        score: Optional[int],
        emoji: Optional[str],
        message: Optional[str],
        timestamp: Optional[str] = None,
        show_feedback: Optional[bool] = True,
        detected_event_ids: Optional[list[str]] = None,
    ) -> "CustomUIEventMessageType":
        """Create a custom event with current timestamp."""
        if timestamp is None:
            timestamp = get_iso_timestamp()

        return cls(
            version="1.0",
            data=CustomUIEventMessageTypeData(
                score=score,
                emoji=emoji,
                message=message,
                show_feedback=show_feedback,
                detected_event_ids=detected_event_ids,
            ),
            timestamp=timestamp,
        )
