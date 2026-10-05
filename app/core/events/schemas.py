"""
Centralized schemas for event orchestrator and related structures.
"""

import time
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional, TypedDict

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
    START_METRICS = "start_metrics"
    LLM_USAGE = "llm_usage"
    SESSION_MEMORY = "session_memory"
    SUPERVISOR_NOTE = "supervisor_note"


class LLMUsageData(BaseModel):
    """Per-AI-call usage shipped to Core for the AI-cost (by service / model /
    task) dashboard. `service` selects the billing unit: 'llm' (tokens),
    'stt' (audio_ms), 'tts' (characters). Core sums the quantities and converts
    to estimated USD with per-service pricing."""

    service: str = "llm"
    unit: Optional[str] = None
    provider: str
    model: str
    task: str
    # LLM quantities.
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    # Prompt tokens served from the provider's cache (a cache hit) — lets a
    # cache-hit-rate metric (cached_tokens / prompt_tokens) be computed
    # downstream to verify prompt caching is actually landing.
    cached_tokens: int = 0
    # STT billable audio duration (ms) / TTS billable characters.
    audio_ms: Optional[int] = None
    characters: Optional[int] = None
    env: Optional[str] = None
    scenario_id: Optional[int] = None
    # For a call made outside any LiveKit room (the post-session actor
    # evaluation, an HTTP request): Core resolves the session from this first,
    # then falls back to the message's room_id.
    scenario_session_id: Optional[str] = None
    # Free-form correlation context Core stores verbatim on the row (e.g.
    # {"report_id": ...} for a studio rehearsal, which has no session).
    metadata: Optional[Dict[str, Any]] = None


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
    # Pure STT finalization time (LiveKit EOUMetrics.transcription_delay):
    # time to obtain the transcript after end of user speech, isolated from
    # VAD-wait/EOU-decision time which eou_delay_ms bundles together. Added
    # to pinpoint regional-language STT latency vs. endpointing config.
    stt_finalize_ms: Optional[int] = None
    llm_ttft_ms: Optional[int] = None
    tts_ttfb_ms: Optional[int] = None
    # Raw provider prompt-cache counts for generate_response's LLM call — same
    # fields/semantics as LLMUsageData.prompt_tokens/cached_tokens above, kept
    # as separate columns here (not just a rate) so the hit-rate aggregation
    # method stays a query-time decision, not baked into ingestion.
    prompt_tokens: Optional[int] = None
    cached_tokens: Optional[int] = None

    # App-stage timings (graph nodes)
    orchestration_ms: Optional[int] = None
    llm_response_ms: Optional[int] = None
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
    llm_timed_out: Optional[bool] = None
    interrupted: Optional[bool] = None
    metadata: Optional[dict] = None


class StartMetricsData(BaseModel):
    """Simulation START latency shipped to Core for the start-latency chart.

    ``start_latency_ms`` is the headline "time to first word" (agent job start
    -> the agent begins its opening dialogue); the segment fields break it down
    so the chart can stack WHERE the startup time goes. All *_ms fields are
    integer milliseconds. Emitted once per session (see
    AgentWorker._emit_start_metrics).
    """

    start_latency_ms: int
    configure_ms: Optional[int] = None
    initialize_ms: Optional[int] = None
    connect_ms: Optional[int] = None
    prep_ms: Optional[int] = None
    # Opening-statement TTS playout duration (informational; not in the total).
    opening_playout_ms: Optional[int] = None
    scenario_id: Optional[int] = None
    language: Optional[str] = None
    env: Optional[str] = None
    metadata: Optional[dict] = None


class SessionMemoryData(BaseModel):
    """End-of-session episodic memory shipped to Core once per session.

    ``summary`` is the final rolling conversation summary (see
    ROLLING_SUMMARY_* in app/core/config.py) — Core persists it case-scoped so
    the next session in the same case can carry real continuity in
    ``previousMemory`` instead of a one-sentence stub. ``language`` is the
    session's BCP-47 code (the summary is written in the conversation
    language). ``message_count`` / ``summarized_message_count`` record
    coverage: when they differ, the summary's final compaction was skipped or
    timed out and the last turns are only in the transcript rows."""

    summary: str
    language: Optional[str] = None
    message_count: int = 0
    summarized_message_count: int = 0
    env: Optional[str] = None
    # Machine-usable form of the summary (RollingSummaryStructured dump:
    # situation, disclosures[], counsellor_actions[], emotional_arc,
    # unresolved[]) so downstream consumers never re-parse prose. Optional —
    # absent for memories produced before the structured summarizer.
    structured: Optional[dict] = None


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


class SupervisorNoteData(BaseModel):
    """One live supervisor note shipped to Core as it is sent to the learner.

    The learner already has the note — it went out over the LiveKit data channel
    first — so this message is the durable copy Core persists and hands to the
    post-session debrief as context. ``seq`` is 1-based per session and is both
    the read order and Core's idempotency key, so an SQS redelivery collides
    instead of showing a duplicated hint. ``note`` is written in the session
    language, so ``language`` records which."""

    note: str
    seq: int
    turn_index: Optional[int] = None
    language: Optional[str] = None
    env: Optional[str] = None


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
    start_metrics: Optional[StartMetricsData] = Field(
        default=None, description="Per-session simulation start latency"
    )
    llm_usage: Optional[LLMUsageData] = Field(
        default=None, description="Per-LLM-call token usage"
    )
    session_memory: Optional[SessionMemoryData] = Field(
        default=None, description="End-of-session episodic memory summary"
    )
    supervisor_note: Optional[SupervisorNoteData] = Field(
        default=None, description="One live supervisor note sent mid-session"
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

    @classmethod
    def create_start_metrics(
        cls,
        room_id: str,
        start_metrics: StartMetricsData,
    ) -> "CoreEventMessageType":
        """Create a per-session simulation start-latency message for Core."""
        return cls(
            message_type=CoreMessageType.START_METRICS,
            data=CoreEventMessageTypeData(start_metrics=start_metrics),
            room_id=room_id,
            timestamp=int(time.time()),
        )

    @classmethod
    def create_llm_usage(
        cls,
        room_id: str,
        llm_usage: LLMUsageData,
    ) -> "CoreEventMessageType":
        """Create a per-LLM-call token usage message for Core. Wire shape
        mirrors turn_metrics: data.llm_usage = {...}."""
        return cls(
            message_type=CoreMessageType.LLM_USAGE,
            data=CoreEventMessageTypeData(llm_usage=llm_usage),
            room_id=room_id,
            timestamp=int(time.time()),
        )

    @classmethod
    def create_session_memory(
        cls,
        room_id: str,
        session_memory: SessionMemoryData,
    ) -> "CoreEventMessageType":
        """Create the once-per-session episodic-memory message for Core. Wire
        shape mirrors turn_metrics: data.session_memory = {...}."""
        return cls(
            message_type=CoreMessageType.SESSION_MEMORY,
            data=CoreEventMessageTypeData(session_memory=session_memory),
            room_id=room_id,
            timestamp=int(time.time()),
        )

    @classmethod
    def create_supervisor_note(
        cls,
        room_id: str,
        supervisor_note: SupervisorNoteData,
    ) -> "CoreEventMessageType":
        """Create a live-supervisor-note message for Core. Wire shape mirrors
        turn_metrics: data.supervisor_note = {...}. One per note, not per
        session."""
        return cls(
            message_type=CoreMessageType.SUPERVISOR_NOTE,
            data=CoreEventMessageTypeData(supervisor_note=supervisor_note),
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
