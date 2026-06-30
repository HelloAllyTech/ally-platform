import asyncio
import json
import os
import random
import sys
import time
from typing import Optional, Set

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, JobProcess, RoomInputOptions
from livekit.agents.cli.log import setup_logging
from livekit.plugins import noise_cancellation, silero

from app.core.agent.factory import (
    cleanup_background_tasks,
    configure_llm_client,
    configure_stt_client,
    configure_tts_client,
    create_agent_with_adapter,
    initialize_agent_state,
    parse_room_metadata,
    should_auto_start_conversation,
    should_say_opening_statement,
)
from app.core.config import settings
from app.core.constants import (
    DEFAULT_BRANCHING_LLM_CONFIG,
    DEFAULT_VAD_ACTIVATION_THRESHOLD,
    SESSION_TERMINATED_MESSAGE,
    Environment,
)
from app.core.embeddings import OpenAIEmbeddingClient
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.events.handlers import (
    create_connection_state_handler,
    create_conversation_handler,
    create_shutdown_handler,
    create_termination_handler,
    setup_interruption_detection,
)
from app.core.logger import get_logger
from app.core.metrics import turn_metrics
from app.core.queue.utils import (
    send_session_paused_message,
    send_session_resumed_message,
)
from app.core.scenario.base import Scenario
from app.core.scoring.score_keeper import ScoreKeeper
from app.core.session_clock import SessionClock
from app.llms import BaseLLMClient
from app.stt import BaseSTTClient
from app.tts import BaseTTSClient

# Register the multilingual EOU inference runner at MODULE IMPORT (not lazily per
# job): livekit-agents only creates + warms its inference-executor process when
# _InferenceRunner.registered_runners is non-empty at Worker.__init__ time, and the
# runner registers as an import side effect of this module. Without this top-level
# import the executor is never created, EOU inference returns "no inference executor"
# at the first turn, and turn detection silently falls back to VAD (feature inert).
# Gated on the kill-switch so a disabled feature spawns no inference process.
if settings.SEMANTIC_TURN_DETECTION_ENABLED:
    from livekit.plugins.turn_detector import multilingual as _eou_multilingual  # noqa: F401

logger = get_logger(__name__)
setup_logging(
    settings.LIVEKIT_LOG_LEVEL,
    devmode=settings.LIVEKIT_LOG_DEV_MODE,
    console=settings.LIVEKIT_LOG_CONSOLE,
)

# Pause/resume control channel (LiveKit data packets, topic-agnostic; clients
# branch on the JSON ``type`` field).
# Pause/resume tuning — resolved from settings (env-overridable; see config.py
# for defaults). Read once at import; env is fixed per worker process.
PAUSE_CAP_SECONDS = settings.PAUSE_CAP_SECONDS  # max single continuous pause
PAUSE_WARNING_LEAD_SECONDS = settings.PAUSE_WARNING_LEAD_SECONDS
# Hard ceiling on *cumulative* paused time per session — bounds the wall-clock a
# session can be parked via repeated sub-cap pauses.
MAX_TOTAL_PAUSE_SECONDS = settings.MAX_TOTAL_PAUSE_SECONDS

# Control-channel message types (kept in one place to avoid typo drift).
# Client → agent:
CTRL_PAUSE = "pause"
CTRL_RESUME = "resume"
# Agent → client:
CTRL_PAUSED = "paused"
CTRL_RESUMED = "resumed"
CTRL_CAP_WARNING = "cap-warning"
CTRL_CAP_ENDED = "cap-ended"


# The agent is the AUTHORITATIVE enforcer of the scenario time limit: it ends
# the session when ACTIVE elapsed time (excluding pauses) reaches the limit.
# The client timer is display + a redundant fallback only. A tiny grace lets
# the client's on-screen countdown visibly reach zero just before the agent
# tears down (avoids ending a beat "early" on sub-second clock differences).
# Env-overridable (see config.py).
MAX_DURATION_GRACE_SECONDS = settings.MAX_DURATION_GRACE_SECONDS


def _now_ms() -> int:
    """Current epoch time in milliseconds."""
    return int(time.time() * 1000)


def _parse_max_time_seconds(value: Optional[str]) -> Optional[float]:
    """Parse a scenario time limit ("HH:MM:SS") into seconds.

    Mirrors the clients' parseMaxTimeSec (parts → h:m:s, missing parts = 0) so
    the server backstop and the client timer agree on the limit. Returns None
    when absent or non-positive.
    """
    if not value:
        return None
    try:
        parts = [int(p) for p in str(value).split(":")]
    except (ValueError, AttributeError):
        return None
    parts = (parts + [0, 0, 0])[:3]
    total = parts[0] * 3600 + parts[1] * 60 + parts[2]
    return float(total) if total > 0 else None


def _resolve_stt_meta(scenario) -> tuple[str, str]:
    """(provider, model) for the configured STT, read defensively from the
    scenario language config. Used only to tag AI-cost usage events."""
    try:
        cfg = getattr(getattr(scenario, "language_config", None), "stt_config", None)
        if isinstance(cfg, dict):
            provider = cfg.get("provider") or "unknown"
            inner = cfg.get("config") if isinstance(cfg.get("config"), dict) else cfg
            model = (inner or {}).get("model") or "unknown"
            return str(provider), str(model)
    except Exception:
        pass
    return "unknown", "unknown"


def _resolve_tts_meta(scenario) -> tuple[str, str]:
    """(provider, model/voice) for the configured TTS, read defensively from
    scenario.voice. Used only to tag AI-cost usage events."""
    try:
        voice = getattr(scenario, "voice", None)
        if voice is not None:
            provider = getattr(voice, "provider", None) or "unknown"
            cfg = getattr(voice, "config", None)
            model = (
                getattr(cfg, "model", None)
                or getattr(cfg, "model_name", None)
                or getattr(voice, "name", None)
                or "unknown"
            )
            return str(provider), str(model)
    except Exception:
        pass
    return "unknown", "unknown"


def _emit_service_usage(
    _worker,
    room: str,
    *,
    service: str,
    provider: str,
    model: str,
    task: str,
    audio_ms: Optional[int] = None,
    characters: Optional[int] = None,
) -> None:
    """Best-effort AI-cost emit from the metrics hook (guarded import so a
    missing module never breaks the live session)."""
    try:
        from app.core.llm_usage.emitter import emit_ai_usage

        emit_ai_usage(
            room,
            service=service,
            provider=provider,
            model=model,
            task=task,
            audio_ms=audio_ms,
            characters=characters,
        )
    except Exception:
        logger.debug("[ai-cost] emit skipped (best-effort)", exc_info=True)


class AgentWorker:
    """
    Manages the full agent lifecycle: configuration → initialization → runtime.

    Organized in clear phases for readability:
    1. Configuration: Parse metadata, create clients (STT, TTS, LLM, embedding)
    2. Initialization: Create session, agent, orchestrator, register callbacks
    3. Runtime: Start session, initialize orchestrator, say opening statement

    For evaluation/testing:
    - Call configure() to set up clients without runtime components
    - Access attributes directly: worker.scenario, worker.stt_client, etc.
    - Methods are organized by phase, making it easy to test components independently
    """

    def __init__(self, ctx: agents.JobContext):
        """Initialize worker with job context."""
        self.ctx = ctx

        # ========== Configuration State (set in configure()) ==========
        self.scenario: Optional[Scenario] = None
        self.tts_client: Optional[BaseTTSClient] = None
        self.stt_client: Optional[BaseSTTClient] = None
        self.llm_client: Optional[BaseLLMClient] = None
        self.embedding_client: Optional[OpenAIEmbeddingClient] = None
        self.joined_iso: Optional[str] = None

        # ========== Runtime Components (set in initialize()) ==========
        self.session: Optional[AgentSession] = None
        self.event_orchestrator: Optional[EventOrchestrator] = None
        self.score_keeper: Optional[ScoreKeeper] = None
        self.agent: Optional[Agent] = None
        # Pause-aware clock (single source of active-elapsed time) and the
        # asyncio task enforcing the max-pause cap.
        self.session_clock: Optional[SessionClock] = None
        self._pause_cap_task: Optional[asyncio.Task] = None
        # Serializes pause/resume so rapid toggles can't interleave (each fully
        # applies before the next runs).
        self._control_lock = asyncio.Lock()
        # If a pause interrupts the persona mid-utterance, the cut-off line is
        # captured here so it can be re-spoken on resume.
        self._interrupted_speech_text: Optional[str] = None

        # ========== State Tracking ==========
        self.final_score_sent = False
        self._background_tasks: Set[asyncio.Task] = set()

        # Thinking-filler (plays on a separate audio track via
        # BackgroundAudioPlayer, so it can't race/preempt the real reply). We
        # drive playback ourselves on the agent's "thinking" state so we know
        # which phrase plays and can record it in the transcript.
        self._bg_audio = None
        self._filler_clips: list[tuple[str, str]] = []  # (phrase, wav_path)
        self._filler_handle = None
        # Predictive fillers: LLM-generated, refreshed by a background job from
        # the live conversation. Preferred over the static set when non-empty;
        # the static clips above stay as the fallback.
        self._dynamic_filler_clips: list[tuple[str, str]] = []  # (phrase, wav_path)
        self._predictor_task: Optional[asyncio.Task] = None
        # Recently spoken filler phrases, so we don't repeat the same one on
        # consecutive turns (random.choice has no memory). Kept short and capped
        # below the clip count so there's always a candidate to pick.
        self._recent_filler_phrases: list[str] = []
        # Delay-gated playback: a filler only plays if the reply is still pending
        # after FILLER_MIN_DELAY_MS, so fast turns get no (unnatural) filler.
        self._filler_delay_task: Optional[asyncio.Task] = None
        self._agent_thinking: bool = False

        # Comfort audio: a faint room tone played as the ambient sound on the
        # SAME BackgroundAudioPlayer track, looping for the whole session so the
        # line never sounds dead/muted between turns. Its temp WAV is deleted on
        # shutdown alongside the filler clips.
        self._comfort_clip_path: Optional[str] = None

        # Continuous back-channeling: brief listener affirmations ("mm-hmm",
        # soft "yeah") played on the SAME background track WHILE the learner is
        # still speaking on a long turn — a human "I'm listening" signal,
        # distinct from the post-turn thinking-filler. Driven off the
        # user-speaking state (see _on_backchannel_user_state / _backchannel_loop)
        # and kept sparse so it never interrupts. Clips are generated once at
        # session start in the scenario's language; deleted on shutdown.
        self._backchannel_clips: list[tuple[str, str]] = []  # (phrase, wav_path)
        self._backchannel_task: Optional[asyncio.Task] = None
        self._backchannel_handle = None
        self._user_speaking: bool = False
        # Recent back-channel phrases, so consecutive emissions don't repeat
        # (kept separate from the filler's list — different phrase pools).
        self._recent_backchannel_phrases: list[str] = []

        # Predictive interim reply: while the learner is still speaking on a long
        # turn, a fast DEDICATED model (separate from the main reply LLM) turns
        # the partial transcript into a short, non-committal holding reply; it is
        # pre-synthesized and played on the SAME background track at the VAD
        # endpoint (after the thinking-filler) to mask the real reply's latency,
        # then cut the instant the real reply speaks. The real reply is generated
        # independently and never sees the interim. See
        # app/core/livekit/interim_reply.py.
        self._interim_enabled: bool = False
        self._interim_llm_client = None
        # Per-turn state machine: idle -> generating -> ready -> playing -> done.
        self._interim_state: str = "idle"
        self._interim_armed: bool = False  # generation kicked off this turn
        # Partial transcript accumulation for the current learner turn (finalized
        # STT segments + the latest in-progress interim segment).
        self._interim_final_segments: list[str] = []
        self._interim_current_interim: str = ""
        self._interim_partial_text: str = ""
        # Monotonic timestamp of when the learner started this turn — drives the
        # "spoken >= TRIGGER_MS" gate, independent of any event clock base.
        self._user_turn_start_monotonic: Optional[float] = None
        self._interim_gen_task: Optional[asyncio.Task] = None
        self._interim_play_task: Optional[asyncio.Task] = None
        self._interim_clip: Optional[tuple[str, str]] = None  # (text, wav_path)
        self._interim_handle = None
        # All interim WAVs synthesized this session, deleted on shutdown.
        self._interim_clip_paths: list[str] = []

        # ========== Termination Handling (for entrypoint context) ==========
        # Use asyncio.Event to signal termination from graph context
        # to entrypoint context
        self._termination_event: Optional[asyncio.Event] = None
        self._termination_message: Optional[str] = None
        # Event to signal room disconnection to entrypoint
        self._room_disconnected_event: Optional[asyncio.Event] = None

    async def configure(self):
        """
        - Parse metadata and extract scenario
        - Create all clients (STT, TTS, LLM, embedding)
        - Initialize agent graph state

        After this phase, you can access:
        - self.scenario
        - self.stt_client, self.tts_client, self.llm_client, self.embedding_client
        """
        # Setup embedding client (needed for metadata parsing)
        self.embedding_client = OpenAIEmbeddingClient(
            model=settings.OPENAI_EMBEDDING_MODEL, api_key=settings.OPENAI_API_KEY
        )
        logger.debug("Created shared embedding client for semantic similarity events")
        # Set once at session start so per-turn _prepare_event_context doesn't
        # mutate a class attribute on every graph invocation.
        from app.core.events.event_types.semantic_similarity.semantic_similarity_event import (  # noqa: E501
            SemanticSimilarityEvent,
        )

        SemanticSimilarityEvent._EMBEDDING_CLIENT = self.embedding_client

        # Parse metadata
        rm_md_envelope = parse_room_metadata(
            self.ctx.job.metadata,
            embedding_client=self.embedding_client,
            branching_llm_config=DEFAULT_BRANCHING_LLM_CONFIG,
        )
        self.scenario = rm_md_envelope.scenario
        logger.debug(f"Events in scenario: {str(self.scenario.events)}")
        # Log prompt metadata for debugging dashboard edits
        prompts = getattr(self.scenario.prompt_data, "prompts", None)
        if prompts:
            default_key = "ally_ai_learn_system_base_role_instruction"
            default_prompt = prompts.get(default_key, "")
            logger.info(
                "[METADATA_PROMPTS] scenario has prompt_data.prompts with keys=%s, "
                "base_role_instruction len=%s, preview=%s",
                list(prompts.keys())[:15],
                len(default_prompt),
                (
                    (default_prompt[:150] + "...")
                    if len(default_prompt) > 150
                    else default_prompt
                ),
            )
        else:
            logger.info("[METADATA_PROMPTS] scenario has no prompt_data.prompts")

        # Configure STT and TTS clients - using utility functions
        self.stt_client = configure_stt_client(self.scenario)
        self.tts_client = configure_tts_client(self.scenario)

        # Capture STT/TTS provider+model for token-usage (AI-cost) emission in
        # the metrics hook. Read defensively off the scenario config; the live
        # billable metrics (audio duration / characters) come from LiveKit.
        self._stt_provider, self._stt_model = _resolve_stt_meta(self.scenario)
        self._tts_provider, self._tts_model = _resolve_tts_meta(self.scenario)

        # Configure LLM client
        self.llm_client = configure_llm_client(self.scenario)

        logger.info("[AgentWorker] Configuration phase complete")

        # Initialize agent state
        agent_joined_iso = initialize_agent_state(
            thread_id=self.ctx.room.name,
            scenario=self.scenario,
        )
        self.joined_iso = self.scenario.conversation_started_at or agent_joined_iso

        print("debugging: ", self.joined_iso)

    async def initialize(self):
        """
        Creates session, agent, orchestrator, and registers callbacks.
        Must be called after configure().
        """
        # Create session (needs clients from configure phase)
        self._create_session()

        # Create the pause-aware session clock from the agent-join timestamp.
        # Shared (via the graph config) by the orchestrator, the time-event
        # scheduler, and the graph nodes so they all measure active time.
        self.session_clock = SessionClock.from_iso(self.joined_iso)

        # Create ScoreKeeper first — it is injected into both EventOrchestrator
        # and the agent config so all scoring flows through one instance.
        self.score_keeper = ScoreKeeper()

        # Setup orchestrator (receives the ScoreKeeper)
        self._setup_event_orchestrator(self.score_keeper)

        # Create agent (using utility function)
        self.agent = create_agent_with_adapter(
            thread_id=self.ctx.room.name,
            room=self.ctx.room,
            scenario=self.scenario,
            agent_joined_at=self.joined_iso,
            llm_client=self.llm_client,
            embedding_client=self.embedding_client,
            event_orchestrator=self.event_orchestrator,
            tts_client=self.tts_client,
            score_keeper=self.score_keeper,
            session_clock=self.session_clock,
        )

        # Register callbacks
        self._register_callbacks()

    def _create_session(self):
        """Create agent session with STT and TTS."""
        # VAD is always prewarmed in prewarm(), so retrieve it regardless
        vad = self.ctx.proc.userdata.get("vad")
        stt_instance = self.stt_client.stt_instance
        tts_instance = self.tts_client.tts_instance

        # Semantic EOU (multilingual) layered on VAD when enabled, else the plain
        # VAD silence timeout (prior behaviour). See _resolve_turn_detection for
        # the language-coverage + graceful-fallback details.
        turn_detection, endpointing_kwargs = self._resolve_turn_detection(vad)

        self.session = AgentSession(
            stt=stt_instance,
            tts=tts_instance,
            vad=vad,
            turn_detection=turn_detection,
            **endpointing_kwargs,
        )

    def _resolve_turn_detection(self, vad) -> tuple[object, dict]:
        """Pick the turn-detection strategy + endpointing bounds for this session.

        Default (SEMANTIC_TURN_DETECTION_ENABLED, on): the LiveKit multilingual
        end-of-utterance model layered ON TOP of VAD. It reads the running
        transcript and modulates the endpointing delay between
        TURN_MIN/MAX_ENDPOINTING_DELAY — collapsing toward MIN when the utterance
        looks grammatically complete (fast reply) and extending toward MAX when
        the learner is likely mid-thought (fewer barge-ins). The win surfaces in
        the eou_delay_ms metric.

        Language coverage: the multilingual model only supports a fixed set (of
        ours: English and Hindi). For any other language (Tamil, Telugu, etc.)
        LiveKit transparently uses the plain VAD endpointing instead — exactly
        the prior behaviour, so there is no regression for unsupported languages.

        Fully defensive: with no VAD, or the flag off, or the model unavailable
        (e.g. weights weren't baked into the image), we fall back to the plain
        "vad" timeout so a session never fails to start over turn detection.
        Returns ``(turn_detection, endpointing_kwargs)``.
        """
        if not vad:
            return None, {}
        if not getattr(settings, "SEMANTIC_TURN_DETECTION_ENABLED", True):
            return "vad", {}
        try:
            from livekit.plugins.turn_detector.multilingual import MultilingualModel

            min_delay = float(getattr(settings, "TURN_MIN_ENDPOINTING_DELAY", 0.5))
            max_delay = float(getattr(settings, "TURN_MAX_ENDPOINTING_DELAY", 3.0))
            detector = MultilingualModel()
            logger.info(
                "[TURN] semantic EOU enabled (multilingual; min=%.2fs max=%.2fs); "
                "VAD fallback for unsupported languages",
                min_delay,
                max_delay,
            )
            return detector, {
                "min_endpointing_delay": min_delay,
                "max_endpointing_delay": max_delay,
            }
        except Exception as e:  # noqa: BLE001 - never fail a session over turn detection
            logger.warning(
                "[TURN] semantic EOU unavailable (%s); falling back to VAD timeout",
                e,
            )
            return "vad", {}

    def _setup_event_orchestrator(self, score_keeper=None):
        """Initialize event orchestrator with callbacks."""
        # Create termination handler that signals entrypoint context instead of
        # handling termination directly (which runs in graph context)
        termination_handler = create_termination_handler(
            session=self.session,
            ctx=self.ctx,
            background_tasks=self._background_tasks,
            worker=self,  # Pass worker reference so handler can signal termination
        )

        self.event_orchestrator = EventOrchestrator(
            scenario=self.scenario,
            thread_id=self.ctx.room.name,
            room=self.ctx.room,
            termination_callback=termination_handler,
            agent_joined_at=self.joined_iso,
            score_keeper=score_keeper,
            session_clock=self.session_clock,
        )

        # Update termination handler with orchestrator reference
        termination_handler.set_event_orchestrator(self.event_orchestrator)

        logger.info(
            f"Initialized EventOrchestrator with {len(self.scenario.events)} events"
        )

    def _register_callbacks(self):
        """Register room, session, and shutdown callbacks."""
        # Conversation handler (register on session)
        conversation_handler, state_handlers, cleanup_conversation_handler = (
            create_conversation_handler(self.ctx.room.name, self.joined_iso)
        )
        self.session.on("conversation_item_added")(conversation_handler)

        # Register state-change handlers to track when audio starts playing
        # These capture speaking start times used by conversation_handler
        self.session.on("agent_state_changed")(state_handlers["agent_state"])
        self.session.on("user_state_changed")(state_handlers["user_state"])

        # Latency metrics: LiveKit emits per-component timings (end-of-utterance
        # delay, LLM time-to-first-token, TTS time-to-first-byte). Record them
        # into the per-turn accumulator so they ship to Core with the app-stage
        # timings. Defensive: metric class shapes vary by LiveKit version, so
        # read attributes by name and never let this break the session.
        metrics_room_name = self.ctx.room.name

        @self.session.on("metrics_collected")
        def on_metrics_collected(ev):
            try:
                metric = getattr(ev, "metrics", None)
                if metric is None:
                    return
                metric_cls = type(metric).__name__
                if metric_cls == "EOUMetrics":
                    delay = getattr(metric, "end_of_utterance_delay", None)
                    if delay is not None and delay >= 0:
                        turn_metrics.record(
                            metrics_room_name, eou_delay_ms=int(delay * 1000)
                        )
                elif metric_cls == "LLMMetrics":
                    ttft = getattr(metric, "ttft", None)
                    if ttft is not None and ttft >= 0:
                        turn_metrics.record(
                            metrics_room_name, llm_ttft_ms=int(ttft * 1000)
                        )
                elif metric_cls == "TTSMetrics":
                    ttfb = getattr(metric, "ttfb", None)
                    if ttfb is not None and ttfb >= 0:
                        turn_metrics.record(
                            metrics_room_name, tts_ttfb_ms=int(ttfb * 1000)
                        )
                    # AI-cost: TTS billed per synthesized character.
                    chars = getattr(metric, "characters_count", None)
                    if chars:
                        _emit_service_usage(
                            self,
                            metrics_room_name,
                            service="tts",
                            provider=getattr(self, "_tts_provider", "unknown"),
                            model=getattr(self, "_tts_model", "unknown"),
                            task="agent_tts",
                            characters=int(chars),
                        )
                elif metric_cls == "STTMetrics":
                    # AI-cost: STT billed per audio minute. audio_duration is the
                    # pushed-audio length in seconds.
                    audio_s = getattr(metric, "audio_duration", None)
                    if audio_s and audio_s > 0:
                        _emit_service_usage(
                            self,
                            metrics_room_name,
                            service="stt",
                            provider=getattr(self, "_stt_provider", "unknown"),
                            model=getattr(self, "_stt_model", "unknown"),
                            task="agent_stt",
                            audio_ms=int(audio_s * 1000),
                        )
            except Exception:  # noqa: BLE001 - metrics must never break a session
                logger.exception("[turn-metrics] metrics_collected hook failed")

        # Store cleanup handler for shutdown
        self._cleanup_conversation_handler = cleanup_conversation_handler

        # Connection state handler
        connection_handler = create_connection_state_handler(
            event_orchestrator=self.event_orchestrator,
            room_name=self.ctx.room.name,
            final_score_sent_ref=lambda: self.final_score_sent,
            set_final_score_sent=lambda val: setattr(self, "final_score_sent", val),
            background_tasks=self._background_tasks,
            score_keeper=self.score_keeper,
        )

        @self.ctx.room.on("connection_state_changed")
        def on_connection_state_changed(state: rtc.ConnectionState):
            connection_handler(state)
            # Signal room disconnection to entrypoint to allow graceful exit
            if state == rtc.ConnectionState.CONN_DISCONNECTED:
                if self._room_disconnected_event:
                    self._room_disconnected_event.set()
                    logger.info("Room disconnected event signaled to entrypoint")

        # Pause/resume control channel: the client publishes reliable data
        # packets ({"type": "pause"|"resume"}). The handler is sync (LiveKit
        # requirement) so it schedules the async work as a tracked task.
        @self.ctx.room.on("data_received")
        def on_control_data(packet: rtc.DataPacket):
            self._handle_control_packet(packet)

        # Shutdown handler
        original_shutdown_handler = create_shutdown_handler(
            event_orchestrator=self.event_orchestrator,
            room_name=self.ctx.room.name,
            final_score_sent_ref=lambda: self.final_score_sent,
            set_final_score_sent=lambda val: setattr(self, "final_score_sent", val),
            cleanup_background_tasks=lambda: cleanup_background_tasks(
                self._background_tasks
            ),
            score_keeper=self.score_keeper,
        )

        # Wrap shutdown handler to include conversation handler cleanup
        async def shutdown_with_cleanup():
            try:
                self._cleanup_conversation_handler()
            except Exception as e:
                logger.debug(f"Error cleaning up conversation handler: {e}")
            # Drop any in-flight turn-metrics state for this room.
            turn_metrics.discard(self.ctx.room.name)
            # Stop the predictive-filler job before deleting clips so it can't
            # swap in a new generation after cleanup (it's still awaited by
            # cleanup_background_tasks in the wrapped shutdown handler).
            if self._predictor_task is not None and not self._predictor_task.done():
                self._predictor_task.cancel()
            # Stop the back-channel loop so it can't emit after teardown.
            if self._backchannel_task is not None and not self._backchannel_task.done():
                self._backchannel_task.cancel()
            self._backchannel_task = None
            # Stop interim-reply generation/playback so neither runs after teardown.
            if self._interim_gen_task is not None and not self._interim_gen_task.done():
                self._interim_gen_task.cancel()
            self._interim_gen_task = None
            if self._interim_play_task is not None and not self._interim_play_task.done():
                self._interim_play_task.cancel()
            self._interim_play_task = None
            # Tear down the background-audio track (comfort tone + filler +
            # back-channel) and delete its temp clips.
            if self._bg_audio is not None:
                try:
                    await self._bg_audio.aclose()
                except Exception as e:  # noqa: BLE001
                    logger.debug(f"Error closing BackgroundAudioPlayer: {e}")
                self._bg_audio = None
            if self._filler_clips or self._dynamic_filler_clips:
                try:
                    from app.core.livekit.filler_audio import cleanup_clips

                    cleanup_clips(
                        [path for _, path in self._filler_clips]
                        + [path for _, path in self._dynamic_filler_clips]
                    )
                except Exception:  # noqa: BLE001
                    pass
                self._filler_clips = []
                self._dynamic_filler_clips = []
            if self._backchannel_clips:
                try:
                    from app.core.livekit.filler_audio import cleanup_clips

                    cleanup_clips([path for _, path in self._backchannel_clips])
                except Exception:  # noqa: BLE001
                    pass
                self._backchannel_clips = []
            if self._interim_clip_paths:
                try:
                    from app.core.livekit.filler_audio import cleanup_clips

                    cleanup_clips(self._interim_clip_paths)
                except Exception:  # noqa: BLE001
                    pass
                self._interim_clip_paths = []
            if self._comfort_clip_path is not None:
                try:
                    from app.core.livekit.comfort_audio import cleanup_clip

                    cleanup_clip(self._comfort_clip_path)
                except Exception:  # noqa: BLE001
                    pass
                self._comfort_clip_path = None
            await original_shutdown_handler()

        shutdown_handler = shutdown_with_cleanup
        # Store for manual invocation in entrypoint
        self._shutdown_handler = shutdown_handler

        self.ctx.add_shutdown_callback(shutdown_handler)

    async def _arm_orphan_deadline(self, timeout: float = 30.0) -> None:
        """Shut down if no human participant joins within `timeout` seconds
        of the agent joining.

        Prevents a proactively dispatched agent from burning resources indefinitely
        when the user closes the tab after room creation but before connecting.
        """
        await asyncio.sleep(timeout)
        if not self.ctx.room.remote_participants:
            logger.warning(
                "[AgentWorker] No human participant joined within %.0fs — "
                "orphaned agent, shutting down.",
                timeout,
            )
            self.ctx.shutdown("orphaned_no_human")

    # ================================================================
    # Pause / Resume control
    # ================================================================

    def _handle_control_packet(self, packet: rtc.DataPacket) -> None:
        """Parse a client control packet and dispatch pause/resume.

        Runs synchronously (LiveKit handler contract) and schedules the async
        work as a tracked background task.
        """
        try:
            msg = json.loads(bytes(packet.data).decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - never let a bad packet crash the room
            logger.debug("[CONTROL] Ignoring non-JSON data packet: %s", e)
            return

        msg_type = (msg or {}).get("type")
        if msg_type == CTRL_PAUSE:
            coro = self.pause()
        elif msg_type == CTRL_RESUME:
            coro = self.resume()
        else:
            return  # not a control packet we own

        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def pause(self) -> None:
        """Serialized entry point — see _pause_impl."""
        async with self._control_lock:
            await self._pause_impl()

    async def _pause_impl(self) -> None:
        """Freeze the whole simulation: stop listening/speaking, halt the clock,
        arm the max-pause cap, and notify client + backend."""
        clock = self.session_clock
        if clock is None or clock.is_paused:
            logger.info("[PAUSE] Ignored — no clock or already paused")
            return
        if not self.ctx.room.remote_participants:
            logger.warning("[PAUSE] Ignored — no remote participant in room")
            return
        # Defense-in-depth: pause is opt-in per scenario. Ignore the packet
        # unless pause is explicitly enabled, even if a stale or tampered
        # client sends one. Only an explicit True enables (missing/False → off).
        if getattr(self.scenario, "pause_enabled", None) is not True:
            logger.warning("[PAUSE] Ignored — pause not enabled for this scenario")
            return

        logger.info("[PAUSE] Pausing simulation")
        # Freeze the clock first so any concurrent graph turn sees paused state.
        clock.pause()

        # Stop listening (no STT/turns) and stop speaking.
        try:
            self.session.input.set_audio_enabled(False)
            self.session.output.set_audio_enabled(False)
        except Exception as e:  # noqa: BLE001
            logger.warning("[PAUSE] Failed to gate audio I/O: %s", e)

        # Capture the in-flight utterance (if any) BEFORE interrupting so it can
        # be re-spoken on resume. interrupt() clears current_speech.
        self._interrupted_speech_text = self._capture_current_speech_text()

        # Cut any in-flight TTS so the persona goes silent immediately.
        try:
            await asyncio.wait_for(self.session.interrupt(), timeout=2.0)
        except Exception as e:  # noqa: BLE001
            logger.warning("[PAUSE] interrupt failed: %s", e)

        # Drop any in-flight turn-latency measurement: a turn spanning a pause
        # would otherwise finalize on resume with a response_latency_ms that
        # includes the whole paused wall-clock — a garbage outlier in the
        # latency analytics. (Counter preserved so turn_index stays unique.)
        turn_metrics.discard_inflight(self.ctx.room.name)

        # Abandon any in-flight interim reply: a clip generated before the pause
        # would be stale across the paused wall-clock gap. It re-arms naturally
        # on the next learner turn after resume.
        self._interim_reset_turn()

        # Enforce the max continuous pause (auto-end).
        self._arm_pause_cap_timer()

        # Ack the client and freeze the billing/duration clock on the backend.
        await self._publish_control({"type": CTRL_PAUSED})
        await send_session_paused_message(self.ctx.room.name, _now_ms())

    async def resume(self) -> None:
        """Serialized entry point — see _resume_impl."""
        async with self._control_lock:
            await self._resume_impl()

    async def _resume_impl(self) -> None:
        """Unfreeze the simulation. The persona stays silent and waits for the
        counselor (no auto reply)."""
        clock = self.session_clock
        if clock is None or not clock.is_paused:
            logger.info("[RESUME] Ignored — not paused")
            return

        logger.info("[RESUME] Resuming simulation")
        self._cancel_pause_cap_timer()
        clock.resume()

        try:
            self.session.input.set_audio_enabled(True)
            self.session.output.set_audio_enabled(True)
        except Exception as e:  # noqa: BLE001
            logger.warning("[RESUME] Failed to re-enable audio I/O: %s", e)

        # If the pause cut the persona off mid-utterance, re-speak that line so
        # the conversation picks up where it left off. allow_interruptions=True
        # keeps the session normal — the counselor can talk over it. The agent
        # turn loop is otherwise untouched, so subsequent turns work as usual.
        if self._interrupted_speech_text:
            text = self._interrupted_speech_text
            self._interrupted_speech_text = None
            try:
                self.session.say(text, allow_interruptions=True)
                logger.info("[RESUME] Re-speaking interrupted utterance")
            except Exception as e:  # noqa: BLE001
                logger.warning("[RESUME] Failed to re-speak utterance: %s", e)

        # Ack the client and report cumulative paused time (source of truth).
        await self._publish_control({"type": CTRL_RESUMED})
        await send_session_resumed_message(
            self.ctx.room.name, _now_ms(), int(clock.paused_offset * 1000)
        )

    def _capture_current_speech_text(self) -> Optional[str]:
        """Best-effort extraction of the text the persona is currently speaking.

        Returns the assistant text of the in-flight speech, or None if the agent
        isn't speaking (so a normal pause re-speaks nothing). Reliable for
        scripted lines (e.g. the opening statement); best-effort for
        LLM-generated turns whose text may not be fully materialized yet.
        """
        try:
            speech = getattr(self.session, "current_speech", None)
            if speech is None or speech.done():
                return None
            # Prefer the graph-stashed utterance — reliable for LLM-generated
            # turns, whose text isn't materialized in chat_items mid-stream.
            if self.session_clock and self.session_clock.last_agent_utterance:
                return self.session_clock.last_agent_utterance
            # Fallback: chat_items (covers scripted say() lines like the opener).
            parts: list[str] = []
            for item in getattr(speech, "chat_items", []) or []:
                if getattr(item, "role", "assistant") != "assistant":
                    continue
                content = getattr(item, "text_content", None)
                if not content:
                    raw = getattr(item, "content", None)
                    if isinstance(raw, list):
                        content = " ".join(str(c) for c in raw if isinstance(c, str))
                    elif isinstance(raw, str):
                        content = raw
                if content and content.strip():
                    parts.append(content.strip())
            text = " ".join(parts).strip()
            return text or None
        except Exception as e:  # noqa: BLE001
            logger.warning("[PAUSE] Could not capture in-flight utterance: %s", e)
            return None

    async def _publish_control(self, payload: dict) -> None:
        """Publish a control packet to clients (ack / cap warning / cap end)."""
        try:
            await self.ctx.room.local_participant.publish_data(
                json.dumps(payload).encode(), reliable=True
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[CONTROL] Failed to publish %s: %s", payload, e)

    def _arm_pause_cap_timer(self) -> None:
        """(Re)arm the pause cap for this pause.

        The cap is the smaller of the per-pause limit and the session's
        *remaining* cumulative-pause budget, so neither a single long pause nor
        many repeated pauses can hold the room open beyond the bounds.
        """
        self._cancel_pause_cap_timer()
        banked = self.session_clock.paused_offset if self.session_clock else 0.0
        remaining_total = max(0.0, MAX_TOTAL_PAUSE_SECONDS - banked)
        cap = min(PAUSE_CAP_SECONDS, remaining_total)
        task = asyncio.create_task(self._pause_cap_countdown(cap))
        self._pause_cap_task = task
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    def _cancel_pause_cap_timer(self) -> None:
        if self._pause_cap_task and not self._pause_cap_task.done():
            self._pause_cap_task.cancel()
        self._pause_cap_task = None

    async def _pause_cap_countdown(self, cap_seconds: float) -> None:
        """Warn the client near the pause cap, then auto-end if still paused.

        ``cap_seconds`` already accounts for the cumulative-pause budget. Uses
        wall-clock sleep on purpose: the cap bounds *real* paused time so an
        abandoned/parked session cannot hold a live room indefinitely.
        """
        try:
            warn_at = max(0.0, cap_seconds - PAUSE_WARNING_LEAD_SECONDS)
            if warn_at > 0:
                await asyncio.sleep(warn_at)
                await self._publish_control(
                    {
                        "type": CTRL_CAP_WARNING,
                        "secondsRemaining": int(cap_seconds - warn_at),
                    }
                )
            # Sleep whatever remains until the cap (the full cap when the budget
            # is already near-exhausted and there was no room to warn).
            await asyncio.sleep(cap_seconds - warn_at)
            logger.warning(
                "[PAUSE] Pause cap reached (%.0fs; cumulative budget %.0fs) — "
                "auto-ending session",
                cap_seconds,
                MAX_TOTAL_PAUSE_SECONDS,
            )
            await self._publish_control({"type": CTRL_CAP_ENDED})
            # Shut down via the normal path (sends final score, frees checkpoint;
            # backend closes the still-open pause interval on session end).
            self.ctx.shutdown("pause_cap_exceeded")
        except asyncio.CancelledError:
            logger.info("[PAUSE] Cap timer cancelled (session resumed)")

    async def _arm_max_duration_enforcer(self) -> None:
        """Authoritatively end the session when ACTIVE elapsed time reaches the
        scenario limit. This is the PRIMARY enforcer (the client timer is just
        display + a redundant fallback) so a tampered/throttled client cannot
        extend the session. Uses the pause-aware clock, so paused time is
        excluded — a pause never eats into the limit.
        """
        scn = self.scenario
        if scn is None or not getattr(scn, "timer_mode", False):
            return
        limit = _parse_max_time_seconds(getattr(scn, "max_time_value", None))
        if not limit or self.session_clock is None:
            return

        try:
            await self.session_clock.sleep(limit + MAX_DURATION_GRACE_SECONDS)
        except asyncio.CancelledError:
            return

        logger.info(
            "[MAX_DURATION] Active time reached scenario limit (%.0fs) — "
            "ending session (authoritative enforcement)",
            limit,
        )
        self.ctx.shutdown("max_duration_exceeded")

    def _resolve_comfort_audio(self):
        """Build the comfort-audio ambient source, or None when disabled.

        Returns a LiveKit ``AudioConfig`` wrapping an INFINITE in-memory room-tone
        iterator (played as the BackgroundAudioPlayer ambient sound), or ``None``
        when comfort audio is off or synthesis fails. In-memory (not a temp WAV)
        on purpose: a file-backed ambient re-opens/decodes the clip every loop,
        and if that stalls past the mixer's per-stream timeout (e.g. while a
        thinking-filler is also decoding) the mixer cancels + closes the ambient
        generator and drops it for good — comfort would then stop the first time
        a filler plays. An in-memory loop yields instantly and can't be dropped.
        Best-effort: never raises.
        """
        try:
            from app.core.livekit.comfort_audio import (
                comfort_ambient_source,
                is_comfort_audio_enabled,
            )

            if not is_comfort_audio_enabled(self.scenario):
                _pd = getattr(self.scenario, "prompt_data", None)
                logger.info(
                    "[COMFORT] disabled (global_enabled=%s comfort_audio_enabled=%s)",
                    getattr(settings, "COMFORT_AUDIO_ENABLED", None),
                    getattr(_pd, "comfort_audio_enabled", None),
                )
                return None

            source = comfort_ambient_source()
            if source is None:
                return None

            from livekit.agents import AudioConfig

            volume = float(getattr(settings, "COMFORT_AUDIO_VOLUME", 0.15))
            logger.info(
                "[COMFORT] room tone enabled (volume=%.2f, in-memory loop)", volume
            )
            return AudioConfig(source, volume=volume)
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[COMFORT] setup failed (continuing without): %s", e)
            return None

    async def _setup_background_audio(self) -> None:
        """Start the shared background-audio track (comfort + filler + back-channel).

        All three naturalness levers ride one LiveKit BackgroundAudioPlayer (its
        own published track, so none can race or preempt the agent's real reply,
        unlike session.say() on the shared speech channel):

        - Comfort audio: a faint room tone set as the player's ``ambient_sound``,
          looped for the whole session so the line never sounds dead/muted.
        - Thinking filler: scenario/predictive phrases we play ourselves on the
          agent's "thinking" state (see _on_filler_agent_state) so we know which
          phrase plays and can record it in the transcript.
        - Back-channel: brief listener affirmations played while the LEARNER is
          still speaking on a long turn (see _on_backchannel_user_state).

        The player is created when ANY layer is on. Fully best-effort: any
        failure leaves the session running without background audio.
        """
        try:
            from app.core.livekit.fillers import (
                is_filler_enabled,
                resolve_filler_phrases,
            )

            # ---- Comfort audio (ambient room tone) ----
            comfort_source = self._resolve_comfort_audio()

            # ---- Thinking filler ----
            # Gate: the filler feature must be on for this session. Static
            # phrases may be empty (a scenario can rely purely on predictive
            # fillers), so we check the feature flag separately from the phrases.
            predictive_on = bool(getattr(settings, "PREDICTIVE_FILLER_ENABLED", False))
            filler_on = False
            if is_filler_enabled(self.scenario):
                from app.core.livekit.filler_audio import synthesize_filler_clips

                phrases = resolve_filler_phrases(self.scenario)
                if phrases:
                    logger.info("[FILLER] resolved %d static phrase(s)", len(phrases))
                    self._filler_clips = await synthesize_filler_clips(
                        self.tts_client, phrases
                    )
                    logger.info(
                        "[FILLER] synthesized %d static clip(s)",
                        len(self._filler_clips),
                    )
                # The filler can play if it has static clips now or will get
                # predictive ones; otherwise there's nothing it could ever play.
                filler_on = bool(self._filler_clips) or predictive_on
                if not filler_on:
                    logger.info(
                        "[FILLER] no static phrases and predictive disabled — no filler"
                    )
            else:
                _pd = getattr(self.scenario, "prompt_data", None)
                logger.info(
                    "[FILLER] not enabled for this session "
                    "(global_enabled=%s filler_enabled=%s) — no filler",
                    getattr(settings, "FILLER_GLOBALLY_ENABLED", None),
                    getattr(_pd, "filler_enabled", None),
                )

            # ---- Continuous back-channeling (listener affirmations) ----
            # Brief "mm-hmm"/"yeah" clips played WHILE the learner speaks on a
            # long turn (see _on_backchannel_user_state). Global flag, default on.
            backchannel_on = await self._resolve_backchannel_clips()

            # ---- Predictive interim reply ----
            # Resolved before the player gate so an interim-only session still
            # publishes the background track. Handlers are registered after the
            # player starts (below).
            from app.core.livekit.interim_reply import is_interim_reply_enabled

            self._interim_enabled = is_interim_reply_enabled(self.scenario)

            # Nothing to play on any layer — don't publish a track.
            if (
                comfort_source is None
                and not filler_on
                and not backchannel_on
                and not self._interim_enabled
            ):
                return

            from app.core.livekit.resilient_bg_audio import (
                ResilientBackgroundAudioPlayer,
            )

            # ambient_sound auto-loops for the whole session (comfort tone). No
            # thinking_sound: we drive filler playback on "thinking" ourselves so
            # we know which phrase is spoken (the auto thinking_sound picks a clip
            # at random and doesn't expose which) — required to record it in the
            # transcript. Still its own published track, so it can't race the reply.
            # ResilientBackgroundAudioPlayer (not the stock player) so a transient
            # capture_frame error can't permanently silence the shared track.
            if comfort_source is not None:
                self._bg_audio = ResilientBackgroundAudioPlayer(
                    ambient_sound=comfort_source
                )
            else:
                self._bg_audio = ResilientBackgroundAudioPlayer()
            await self._bg_audio.start(room=self.ctx.room)
            logger.info(
                "[BG_AUDIO] BackgroundAudioPlayer started "
                "(comfort=%s static_clips=%d predictive=%s backchannel=%s)",
                comfort_source is not None,
                len(self._filler_clips),
                predictive_on,
                backchannel_on,
            )

            # Back-channeling rides the user-speaking state, independent of the
            # thinking-filler — register it before any filler-only early return.
            if backchannel_on:
                self.session.on("user_state_changed")(self._on_backchannel_user_state)
                logger.info(
                    "[BACKCHANNEL] enabled (%d clip(s)) — driven off user-speaking",
                    len(self._backchannel_clips),
                )

            # Interim reply: build the dedicated fast LLM client and register its
            # handlers. Independent of the filler gate (it has its own), so wire
            # it before the filler-only early return below.
            if self._interim_enabled:
                self._setup_interim_reply()

            if not filler_on:
                # No thinking-filler: the comfort tone needs no per-turn driver,
                # and back-channeling (if on) is driven by its own handler above.
                return

            self.session.on("agent_state_changed")(self._on_filler_agent_state)

            # Start the background predictive-filler job (best-effort). It reads
            # the live conversation every interval and refreshes
            # self._dynamic_filler_clips, which playback prefers over the static
            # set. Tracked in _background_tasks so it's cancelled on shutdown.
            if predictive_on:
                self._predictor_task = asyncio.create_task(
                    self._predictive_filler_loop()
                )
                self._background_tasks.add(self._predictor_task)
                self._predictor_task.add_done_callback(self._background_tasks.discard)
                logger.info("[FILLER] predictive filler loop started")
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[BG_AUDIO] setup failed (continuing without): %s", e)
            self._bg_audio = None

    def _on_filler_agent_state(self, ev) -> None:
        """Decide whether to play a filler when the agent starts "thinking".

        Rather than firing on every turn (which sounds unnatural), we defer:
        only if the reply is STILL pending after FILLER_MIN_DELAY_MS do we play a
        filler — fast replies leave no gap to mask. Leaving "thinking" cancels a
        pending wait and stops any filler already playing.

        Best-effort: never raises into the session.
        """
        try:
            if self._bg_audio is None:
                return
            if getattr(ev, "new_state", None) == "thinking":
                self._agent_thinking = True
                # Don't stack: a filler or a pending wait is already in flight.
                if self._filler_handle is not None and not self._filler_handle.done():
                    return
                if (
                    self._filler_delay_task is not None
                    and not self._filler_delay_task.done()
                ):
                    return
                created_at = getattr(ev, "created_at", None)
                self._filler_delay_task = asyncio.create_task(
                    self._delayed_filler_play(created_at)
                )
                self._background_tasks.add(self._filler_delay_task)
                self._filler_delay_task.add_done_callback(
                    self._background_tasks.discard
                )
            else:
                # Reply is ready / turn moved on.
                self._agent_thinking = False
                if (
                    self._filler_delay_task is not None
                    and not self._filler_delay_task.done()
                ):
                    self._filler_delay_task.cancel()
                if self._filler_handle is not None and not self._filler_handle.done():
                    self._filler_handle.stop()
                    self._filler_handle = None
        except Exception as e:  # noqa: BLE001 - filler must never break a session
            logger.warning("[FILLER] agent-state handler error: %s", e)

    async def _delayed_filler_play(self, created_at) -> None:
        """Play a filler only if the reply is still pending after a short wait.

        Waits a randomized delay in [FILLER_MIN_DELAY_MS, FILLER_MAX_DELAY_MS],
        then bails if the agent already left "thinking" (reply ready → no gap to
        mask). Even when there is a gap, plays only FILLER_PLAY_PROBABILITY of
        the time so fillers aren't used on every turn. Best-effort; cancelled
        when the agent stops thinking.
        """
        try:
            import random as _random

            lo = float(getattr(settings, "FILLER_MIN_DELAY_MS", 300.0))
            hi = float(getattr(settings, "FILLER_MAX_DELAY_MS", 600.0))
            if hi < lo:
                lo, hi = hi, lo
            delay_s = max(0.0, _random.uniform(lo, hi) / 1000.0)
            await asyncio.sleep(delay_s)

            # Reply became ready within the delay — no awkward gap, no filler.
            if not self._agent_thinking or self._bg_audio is None:
                return
            if self._filler_handle is not None and not self._filler_handle.done():
                return
            clips = self._dynamic_filler_clips or self._filler_clips
            if not clips:
                return

            # There's a real pause — but don't fill on every one. Roll the dice.
            probability = float(getattr(settings, "FILLER_PLAY_PROBABILITY", 0.6))
            if _random.random() > probability:
                logger.info("[FILLER] skipped this turn (probability gate)")
                return

            from livekit.agents import AudioConfig

            phrase, path = self._pick_filler_clip(clips)
            self._filler_handle = self._bg_audio.play(AudioConfig(path))
            # The filler becomes audible now (after the wait); report that time
            # as first-audio for response_latency_ms and the transcript.
            play_ts = (created_at + delay_s) if created_at is not None else None
            self._emit_filler_transcript(phrase, play_ts)
            if play_ts is not None:
                turn_metrics.note_filler_started(self.ctx.room.name, play_ts)
            logger.info(
                "[FILLER] playing %r after %.0fms wait (reply still pending)",
                phrase,
                delay_s * 1000,
            )
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - filler must never break a session
            logger.warning("[FILLER] delayed play error: %s", e)

    def _pick_filler_clip(self, clips: list, recent: Optional[list] = None) -> tuple:
        """Pick a clip, avoiding phrases played recently.

        random.choice alone can land on the same phrase back-to-back, which
        sounds like the agent is stuck. We exclude recently spoken phrases when
        alternatives exist, and remember the last few (capped below the clip
        count so there's always a candidate). With a single clip it necessarily
        repeats. Phrase text is the key, so this also suppresses repeats across
        predictive regenerations.

        ``recent`` is the list to read/update in place (defaults to the
        thinking-filler's; the back-channel loop passes its own so the two
        phrase pools don't cross-contaminate).
        """
        import random as _random

        recent_list = recent if recent is not None else self._recent_filler_phrases
        recent_set = set(recent_list)
        candidates = [c for c in clips if c[0] not in recent_set] or clips
        choice = _random.choice(candidates)

        # Remember up to (clip_count - 1) recent phrases, max 3, so the exclusion
        # can never empty the candidate pool. Mutate in place so the caller's
        # list (an instance attribute) stays updated.
        max_remember = max(1, min(len(clips) - 1, 3))
        recent_list.append(choice[0])
        recent_list[:] = recent_list[-max_remember:]
        return choice

    def _emit_filler_transcript(self, phrase: str, created_at) -> None:
        """Send the spoken filler phrase to Core as a CLIENT transcript line so
        the transcript reflects what the agent actually said. Fire-and-forget."""
        try:
            from app.core.events.base import ChatMessage
            from app.core.events.handlers import (
                calculate_start_time,
                send_event_to_queue,
            )
            from app.core.events.schemas import CoreEventMessageType

            start_time = (
                calculate_start_time(created_at, self.joined_iso)
                if created_at
                else None
            )
            chat_message = ChatMessage(
                role="CLIENT",
                content=phrase,
                start_time=start_time,
                end_time=start_time,
            )
            core_event = CoreEventMessageType.create(
                room_id=self.ctx.room.name, chat_message=chat_message
            )
            task = asyncio.create_task(
                send_event_to_queue(core_event.model_dump_json())
            )
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)
        except Exception as e:  # noqa: BLE001 - filler must never break a turn
            logger.warning("[FILLER] failed to emit filler transcript: %s", e)

    # ================================================================
    # Continuous back-channeling (listener affirmations)
    # ================================================================

    async def _resolve_backchannel_clips(self) -> bool:
        """Generate + synthesize the back-channel clips for this session.

        Best-effort: when back-channeling is globally enabled, asks the LLM for
        short listener affirmations in the scenario's language (editable
        ``filler/backchannel`` prompt) and synthesizes them to temp WAVs on
        ``self._backchannel_clips``. Returns True only if at least one clip is
        ready (the caller uses this to decide whether to publish the track and
        register the handler). Never raises.
        """
        try:
            from app.core.livekit.backchannel import (
                generate_backchannel_phrases,
                is_backchannel_enabled,
            )

            if not is_backchannel_enabled(self.scenario):
                logger.info(
                    "[BACKCHANNEL] disabled (global kill-switch off or "
                    "per-simulation continuous_backchanneling off)"
                )
                return False

            count = int(getattr(settings, "BACKCHANNEL_COUNT", 6))
            phrases = await generate_backchannel_phrases(
                self.llm_client, self.scenario, count
            )
            if not phrases:
                logger.info("[BACKCHANNEL] no phrases generated — no back-channel")
                return False

            from app.core.livekit.filler_audio import synthesize_filler_clips

            self._backchannel_clips = await synthesize_filler_clips(
                self.tts_client, phrases
            )
            logger.info(
                "[BACKCHANNEL] synthesized %d clip(s) from %d phrase(s)",
                len(self._backchannel_clips),
                len(phrases),
            )
            return bool(self._backchannel_clips)
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[BACKCHANNEL] setup failed (continuing without): %s", e)
            self._backchannel_clips = []
            return False

    def _on_backchannel_user_state(self, ev) -> None:
        """Start/stop the back-channel loop on the user-speaking state.

        The loop lives only while the learner holds the floor: entering
        "speaking" starts it (if not already running); leaving "speaking" cancels
        it and stops any clip still playing, so a back-channel can never spill
        past the learner's turn into the agent's reply.

        Best-effort: never raises into the session.
        """
        try:
            if self._bg_audio is None or not self._backchannel_clips:
                return
            if getattr(ev, "new_state", None) == "speaking":
                self._user_speaking = True
                if self._backchannel_task is None or self._backchannel_task.done():
                    self._backchannel_task = asyncio.create_task(
                        self._backchannel_loop()
                    )
                    self._background_tasks.add(self._backchannel_task)
                    self._backchannel_task.add_done_callback(
                        self._background_tasks.discard
                    )
            else:
                # Learner stopped holding the floor — stop emitting immediately.
                self._user_speaking = False
                if (
                    self._backchannel_task is not None
                    and not self._backchannel_task.done()
                ):
                    self._backchannel_task.cancel()
                self._backchannel_task = None
                if (
                    self._backchannel_handle is not None
                    and not self._backchannel_handle.done()
                ):
                    self._backchannel_handle.stop()
                self._backchannel_handle = None
        except Exception as e:  # noqa: BLE001 - back-channel must never break a session
            logger.warning("[BACKCHANNEL] user-state handler error: %s", e)

    async def _backchannel_loop(self) -> None:
        """Emit sparse listener affirmations while the learner keeps speaking.

        Heuristic, driven off the user-speaking state:
          1. Long-utterance gate — wait BACKCHANNEL_MIN_UTTERANCE_MS before the
             first affirmation. Short turns get nothing (a "mm-hmm" over a
             one-liner is just noise). If the learner stops first, the
             state-change handler cancels this task during the wait.
          2. Then loop while still speaking: wait a randomized gap in
             [MIN_GAP_MS, MAX_GAP_MS] (the half-second-plus lull between
             affirmations), and emit ONE clip behind a probability gate. The
             randomized spacing + probability keep it sparse, so it reads as a
             human listening signal rather than an interruption.

        Every clip plays on the background track at a soft volume, so it can
        never preempt the agent's real reply. Best-effort; cancelled when the
        learner stops speaking.
        """
        try:
            import random as _random

            from livekit.agents import AudioConfig

            min_utterance_s = (
                float(getattr(settings, "BACKCHANNEL_MIN_UTTERANCE_MS", 4000.0))
                / 1000.0
            )
            # Long-utterance gate. Cancelled mid-wait if the learner stops.
            await asyncio.sleep(max(0.0, min_utterance_s))

            volume = float(getattr(settings, "BACKCHANNEL_VOLUME", 0.6))
            probability = float(getattr(settings, "BACKCHANNEL_PLAY_PROBABILITY", 0.5))

            while self._user_speaking and self._bg_audio is not None:
                lo = float(getattr(settings, "BACKCHANNEL_MIN_GAP_MS", 3500.0))
                hi = float(getattr(settings, "BACKCHANNEL_MAX_GAP_MS", 7000.0))
                if hi < lo:
                    lo, hi = hi, lo
                gap_s = max(0.0, _random.uniform(lo, hi) / 1000.0)
                await asyncio.sleep(gap_s)

                # Learner may have stopped during the gap.
                if not self._user_speaking or self._bg_audio is None:
                    break
                # Keep it sparse: don't emit on every gap.
                if _random.random() > probability:
                    continue
                # Don't stack over an affirmation still playing.
                if (
                    self._backchannel_handle is not None
                    and not self._backchannel_handle.done()
                ):
                    continue
                if not self._backchannel_clips:
                    break

                phrase, path = self._pick_filler_clip(
                    self._backchannel_clips,
                    recent=self._recent_backchannel_phrases,
                )
                self._backchannel_handle = self._bg_audio.play(
                    AudioConfig(path, volume=volume)
                )
                logger.info("[BACKCHANNEL] emitted %r while learner speaking", phrase)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - back-channel must never break a session
            logger.warning("[BACKCHANNEL] loop error: %s", e)

    # ================================================================
    # Predictive interim reply (latency mask)
    # ================================================================

    def _setup_interim_reply(self) -> None:
        """Build the dedicated fast LLM client and register interim handlers.

        Best-effort: on any failure the interim feature is disabled for the
        session and the rest of the background audio is unaffected. Called from
        _setup_background_audio after the player starts, only when interim is
        enabled for this session.
        """
        try:
            from app.llms.factory import create_llm_client

            language_code = (
                getattr(
                    getattr(self.scenario, "language_config", None),
                    "language_code",
                    None,
                )
                or "en-US"
            )
            self._interim_llm_client = create_llm_client(
                llm_config={
                    "provider": getattr(
                        settings, "INTERIM_REPLY_MODEL_PROVIDER", "openai"
                    ),
                    "config": {
                        "model": getattr(settings, "INTERIM_REPLY_MODEL", "gpt-4o-mini")
                    },
                },
                language_code=language_code,
            )
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] fast-model client setup failed; disabling: %s", e)
            self._interim_enabled = False
            self._interim_llm_client = None
            return

        # Track the learner's turn (arm clock + reset) and read partial transcripts.
        self.session.on("user_state_changed")(self._on_interim_user_state)
        self.session.on("user_input_transcribed")(self._on_user_input_transcribed)
        # Drive playback on the agent's thinking->speaking transitions.
        self.session.on("agent_state_changed")(self._on_interim_agent_state)
        logger.info(
            "[INTERIM] enabled (model=%s, trigger=%.0fms, min_words=%d)",
            getattr(settings, "INTERIM_REPLY_MODEL", "?"),
            float(getattr(settings, "INTERIM_REPLY_TRIGGER_MS", 6000.0)),
            int(getattr(settings, "INTERIM_REPLY_MIN_WORDS", 8)),
        )

    def _on_interim_user_state(self, ev) -> None:
        """Reset interim state and (re)start the turn clock when the learner speaks.

        Leaving "speaking" needs no action here — playback is driven off the
        agent's "thinking" state. A fresh "speaking" (new turn OR a resume after
        a false endpoint) drops any prior interim and restarts the gate clock so
        a quick resume can't instantly re-trigger. Best-effort; never raises.
        """
        try:
            if not self._interim_enabled:
                return
            if getattr(ev, "new_state", None) == "speaking":
                import time

                self._interim_reset_turn()
                self._user_speaking = True
                self._user_turn_start_monotonic = time.monotonic()
            else:
                self._user_speaking = False
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] user-state handler error: %s", e)

    def _on_user_input_transcribed(self, ev) -> None:
        """Accumulate the learner's partial transcript and arm generation once.

        Fires repeatedly while the learner speaks (interim, is_final=False) and
        once per finalized segment (is_final=True). When the learner has spoken
        >= INTERIM_REPLY_TRIGGER_MS and the partial has >= INTERIM_REPLY_MIN_WORDS,
        snapshot it and kick off generation a single time. Best-effort.
        """
        try:
            if not self._interim_enabled:
                return
            text = (getattr(ev, "transcript", "") or "").strip()
            is_final = bool(getattr(ev, "is_final", False))
            if is_final:
                if text:
                    self._interim_final_segments.append(text)
                self._interim_current_interim = ""
            else:
                self._interim_current_interim = text
            partial = " ".join(
                [*self._interim_final_segments, self._interim_current_interim]
            ).strip()
            self._interim_partial_text = partial

            # Arm once per turn, only while the learner is still speaking (on an
            # interim event — never a final at the endpoint, which would start a
            # generation too late to ever be used), after both gates pass.
            if is_final or self._interim_armed or self._interim_state != "idle":
                return
            if self._bg_audio is None or self._user_turn_start_monotonic is None:
                return

            import time

            trigger_s = (
                float(getattr(settings, "INTERIM_REPLY_TRIGGER_MS", 6000.0)) / 1000.0
            )
            elapsed = time.monotonic() - self._user_turn_start_monotonic
            if elapsed < trigger_s:
                return
            if len(partial.split()) < int(
                getattr(settings, "INTERIM_REPLY_MIN_WORDS", 8)
            ):
                return

            self._interim_armed = True
            self._interim_state = "generating"
            logger.info(
                "[INTERIM] armed at %.1fs (%d words) — generating",
                elapsed,
                len(partial.split()),
            )
            self._interim_gen_task = asyncio.create_task(
                self._interim_generate(partial)
            )
            self._background_tasks.add(self._interim_gen_task)
            self._interim_gen_task.add_done_callback(self._background_tasks.discard)
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] transcribed handler error: %s", e)

    async def _interim_generate(self, partial_text: str) -> None:
        """Generate the interim text (fast model) and synthesize it to audio.

        On success stores a ready clip (state -> "ready"); on any failure/timeout
        leaves no interim for the turn (state -> "idle"). Best-effort.
        """
        try:
            from app.core.livekit.filler_audio import (
                cleanup_clips,
                synthesize_filler_clips,
            )
            from app.core.livekit.interim_reply import generate_interim_reply

            messages = self._read_conversation_history()
            reply = await generate_interim_reply(
                self._interim_llm_client, self.scenario, messages, partial_text
            )
            if not reply:
                if self._interim_state == "generating":
                    self._interim_state = "idle"
                return

            tts_timeout_s = (
                float(getattr(settings, "INTERIM_REPLY_TTS_TIMEOUT_MS", 2500.0))
                / 1000.0
            )
            clips = await asyncio.wait_for(
                synthesize_filler_clips(self.tts_client, [reply]),
                timeout=tts_timeout_s,
            )
            if not clips:
                if self._interim_state == "generating":
                    self._interim_state = "idle"
                return

            # The turn may have ended/reset while we synthesized — only commit if
            # still generating for this turn; otherwise discard the fresh clip.
            if self._interim_state != "generating":
                cleanup_clips([p for _, p in clips])
                return

            self._interim_clip = clips[0]
            self._interim_clip_paths.append(clips[0][1])
            self._interim_state = "ready"
            logger.info("[INTERIM] ready: %r", clips[0][0])
        except asyncio.CancelledError:
            if self._interim_state == "generating":
                self._interim_state = "idle"
            raise
        except asyncio.TimeoutError:
            logger.info("[INTERIM] TTS synth timed out; no interim this turn")
            if self._interim_state == "generating":
                self._interim_state = "idle"
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] generate error: %s", e)
            if self._interim_state == "generating":
                self._interim_state = "idle"

    def _on_interim_agent_state(self, ev) -> None:
        """Drive interim playback off the agent's state.

        Entering "thinking" (real reply being generated) starts the play task,
        which plays the ready interim after the filler. Any other transition
        (notably "speaking" = real reply TTS begins) cuts the interim so two
        voices never overlap across the two tracks. Best-effort.
        """
        try:
            if not self._interim_enabled or self._bg_audio is None:
                return
            if getattr(ev, "new_state", None) == "thinking":
                if self._interim_state in ("ready", "generating") and (
                    self._interim_play_task is None or self._interim_play_task.done()
                ):
                    thinking_ts = getattr(ev, "created_at", None)
                    self._interim_play_task = asyncio.create_task(
                        self._interim_play_after_filler(thinking_ts)
                    )
                    self._background_tasks.add(self._interim_play_task)
                    self._interim_play_task.add_done_callback(
                        self._background_tasks.discard
                    )
            else:
                self._interim_cutover()
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] agent-state handler error: %s", e)

    async def _interim_play_after_filler(self, thinking_ts) -> None:
        """Play the ready interim on the background track, chained after the filler.

        Waits out the thinking-filler's decision/playback so the two never
        overlap on the single track, waits (bounded) for the clip to be ready if
        generation is still finishing, then plays it — unless the real reply has
        started, the learner resumed, or generation failed. Best-effort;
        cancelled at cutover.
        """
        try:
            import time

            from livekit.agents import AudioConfig

            start_wait = time.monotonic()
            # Let the filler's randomized delayed-play decision resolve first.
            filler_max_s = (
                float(getattr(settings, "FILLER_MAX_DELAY_MS", 600.0)) / 1000.0
            )
            await asyncio.sleep(max(0.0, filler_max_s) + 0.05)

            # Wait for the clip to be ready (generation may finish just after the
            # endpoint) AND any thinking-filler to finish. Bounded backstop; the
            # cutover cancels this task the instant the real reply speaks.
            llm_to = float(getattr(settings, "INTERIM_REPLY_LLM_TIMEOUT_MS", 1500.0))
            tts_to = float(getattr(settings, "INTERIM_REPLY_TTS_TIMEOUT_MS", 2500.0))
            cap = time.monotonic() + (llm_to + tts_to) / 1000.0 + 1.0
            while True:
                if self._interim_state in ("playing", "done", "idle"):
                    return
                if self._bg_audio is None or self._user_speaking:
                    return
                filler_playing = (
                    self._filler_handle is not None
                    and not self._filler_handle.done()
                )
                if self._interim_state == "ready" and not filler_playing:
                    break
                if time.monotonic() > cap:
                    return
                await asyncio.sleep(0.05)

            clip = self._interim_clip
            if clip is None:
                return
            text, path = clip
            volume = float(getattr(settings, "INTERIM_REPLY_VOLUME", 0.9))
            self._interim_handle = self._bg_audio.play(
                AudioConfig(path, volume=volume)
            )
            self._interim_state = "playing"

            waited = time.monotonic() - start_wait
            play_ts = (thinking_ts + waited) if thinking_ts is not None else None
            # Record the interim as a real CLIENT turn, and credit it as
            # first-audio for response_latency_ms (earliest wins, so a filler that
            # played before keeps priority).
            self._emit_interim_transcript(text, play_ts)
            if play_ts is not None:
                turn_metrics.note_filler_started(self.ctx.room.name, play_ts)
            logger.info("[INTERIM] playing %r", text)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] play error: %s", e)

    def _interim_cutover(self) -> None:
        """Cut the interim the instant the real reply takes over (or turn ends)."""
        if self._interim_play_task is not None and not self._interim_play_task.done():
            self._interim_play_task.cancel()
        self._interim_play_task = None
        if self._interim_handle is not None and not self._interim_handle.done():
            self._interim_handle.stop()
        self._interim_handle = None
        if self._interim_gen_task is not None and not self._interim_gen_task.done():
            self._interim_gen_task.cancel()
        self._interim_gen_task = None
        if self._interim_state != "idle":
            self._interim_state = "done"

    def _interim_reset_turn(self) -> None:
        """Drop all per-turn interim state (new turn, pause, or barge-in)."""
        if self._interim_play_task is not None and not self._interim_play_task.done():
            self._interim_play_task.cancel()
        self._interim_play_task = None
        if self._interim_gen_task is not None and not self._interim_gen_task.done():
            self._interim_gen_task.cancel()
        self._interim_gen_task = None
        if self._interim_handle is not None and not self._interim_handle.done():
            self._interim_handle.stop()
        self._interim_handle = None
        # The clip's temp WAV is cleaned at shutdown via _interim_clip_paths.
        self._interim_clip = None
        self._interim_armed = False
        self._interim_final_segments = []
        self._interim_current_interim = ""
        self._interim_partial_text = ""
        self._interim_state = "idle"

    def _emit_interim_transcript(self, text: str, created_at) -> None:
        """Record the interim reply as a CLIENT transcript line (a real agent turn).

        Unlike the thinking-filler (also a CLIENT line, but a discardable hedge
        excluded from the transcript record convention), the interim is a genuine
        — if non-committal — utterance the learner heard, so it is recorded. The
        real reply follows as its own CLIENT line. Fire-and-forget; never raises.
        """
        try:
            from app.core.events.base import ChatMessage
            from app.core.events.handlers import (
                calculate_start_time,
                send_event_to_queue,
            )
            from app.core.events.schemas import CoreEventMessageType

            start_time = (
                calculate_start_time(created_at, self.joined_iso)
                if created_at
                else None
            )
            chat_message = ChatMessage(
                role="CLIENT",
                content=text,
                start_time=start_time,
                end_time=start_time,
            )
            core_event = CoreEventMessageType.create(
                room_id=self.ctx.room.name, chat_message=chat_message
            )
            task = asyncio.create_task(
                send_event_to_queue(core_event.model_dump_json())
            )
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)
        except Exception as e:  # noqa: BLE001 - interim must never break a turn
            logger.warning("[INTERIM] failed to emit interim transcript: %s", e)

    def _read_conversation_history(self) -> list:
        """Snapshot the live conversation messages for this room.

        Reads from the LangGraph checkpoint keyed by the room name (the
        thread_id). Best-effort: returns [] if state isn't available yet.
        """
        try:
            from app.core.graph import agent_graph

            snapshot = agent_graph.get_state(
                {"configurable": {"thread_id": self.ctx.room.name}}
            )
            if snapshot and getattr(snapshot, "values", None):
                return snapshot.values.get("messages", []) or []
        except Exception as e:  # noqa: BLE001
            logger.debug("[FILLER] predictive: could not read history: %s", e)
        return []

    async def _predictive_filler_loop(self) -> None:
        """Periodically regenerate predictive fillers from the live conversation.

        Every PREDICTIVE_FILLER_INTERVAL_SECONDS: read the conversation, ask the
        LLM for fresh short fillers, synthesize them, and atomically replace
        self._dynamic_filler_clips (deleting the prior generation one cycle later
        so a clip can't be removed while it's still playing). Skips the LLM/TTS
        work when no new turns have arrived since the last refresh. Fully
        best-effort — on any failure it keeps the previous (or static) fillers.
        """
        from app.core.livekit.filler_audio import cleanup_clips, synthesize_filler_clips
        from app.core.livekit.predictive_filler import generate_predictive_fillers

        interval = float(getattr(settings, "PREDICTIVE_FILLER_INTERVAL_SECONDS", 10.0))
        count = int(getattr(settings, "PREDICTIVE_FILLER_COUNT", 5))
        last_msg_count = -1
        # Clips replaced last cycle — deleted one cycle later, after any play
        # handle referencing them has long finished (fillers play for ~1-2s,
        # cycles are ~10s apart).
        pending_cleanup: list[tuple[str, str]] = []

        try:
            while True:
                await asyncio.sleep(interval)

                cleanup_clips([p for _, p in pending_cleanup])
                pending_cleanup = []

                messages = self._read_conversation_history()
                # Need at least one exchange, and skip if nothing new was said.
                if len(messages) < 1 or len(messages) == last_msg_count:
                    continue

                phrases = await generate_predictive_fillers(
                    self.llm_client, self.scenario, messages, count
                )
                if not phrases:
                    continue

                clips = await synthesize_filler_clips(self.tts_client, phrases)
                if not clips:
                    continue

                # Atomic swap (single-threaded event loop): playback picks up the
                # new clips on the next "thinking". Old clips are cleaned next cycle.
                pending_cleanup = self._dynamic_filler_clips
                self._dynamic_filler_clips = clips
                last_msg_count = len(messages)
                logger.info(
                    "[FILLER] predictive: refreshed %d clip(s) from %d message(s)",
                    len(clips),
                    len(messages),
                )
        except asyncio.CancelledError:
            pass
        finally:
            # Best-effort cleanup of the deferred set on exit; the current
            # dynamic clips are cleaned in shutdown_with_cleanup.
            try:
                cleanup_clips([p for _, p in pending_cleanup])
            except Exception:  # noqa: BLE001
                pass

    async def start(self):
        """
        Connects to room, initializes orchestrator, sets up interruption detection,
        and says opening statement.
        """
        # Initialize termination event for entrypoint-based termination handling
        self._termination_event = asyncio.Event()
        # Initialize room disconnection event for entrypoint keepalive
        self._room_disconnected_event = asyncio.Event()

        # Start session and connect
        try:
            logger.info("[AgentWorker] Phase 3: Connecting to room...")
            await self.session.start(
                # ... (rest of the args identical)
                room=self.ctx.room,
                agent=self.agent,
                room_input_options=RoomInputOptions(
                    noise_cancellation=noise_cancellation.BVC(),
                ),
            )

            # Connect to room with timeout
            logger.info("[AgentWorker] Phase 3: Joining room...")
            await self.ctx.connect()
            logger.info("[AgentWorker] Phase 3: Started and joined room.")

            # Arm orphan deadline: if no human joins within 30s the agent was
            # dispatched proactively but the user never connected — exit cleanly.
            orphan_task = asyncio.create_task(self._arm_orphan_deadline(timeout=30.0))
            self._background_tasks.add(orphan_task)
            orphan_task.add_done_callback(self._background_tasks.discard)

            # Authoritative server-side enforcement of the scenario time limit
            # (active time). The client timer is display + redundant fallback.
            max_dur_task = asyncio.create_task(self._arm_max_duration_enforcer())
            self._background_tasks.add(max_dur_task)
            max_dur_task.add_done_callback(self._background_tasks.discard)
        except Exception as e:
            logger.exception(f"[AgentWorker] Failed to start/join room: {e}")
            logger.info(f"[AgentWorker] Phase 3: Failed to start/join room: {e}")
            raise

        # Setup interruption detection
        setup_interruption_detection(self.session)

        # Initialize event orchestrator (only after session is connected)
        await self.event_orchestrator.initialize()

        # Set up the shared background-audio track — comfort room tone and the
        # thinking-filler (best-effort; never blocks or breaks the session).
        await self._setup_background_audio()

        if should_say_opening_statement(
            scenario=self.scenario,
            event_orchestrator=self.event_orchestrator,
        ):
            statement = random.choice(self.scenario.prompt_data.opening_statements)
            logger.info(f"[AgentWorker] Saying opening statement: {statement}")
            # Stash so a pause mid-opener can re-speak it on resume (the opening
            # statement is said directly, not via generate_response).
            if self.session_clock is not None:
                self.session_clock.last_agent_utterance = statement
            # Best-effort: if the user disconnects during startup the session
            # may already be closing, in which case say() raises
            # "AgentSession is closing, cannot use say()". That must not crash
            # the job — the session is ending anyway.
            try:
                handler = self.session.say(statement)
                logger.info("[AgentWorker] Waiting for opening statement playout...")
                await handler.wait_for_playout()
                logger.info("[AgentWorker] Opening statement playout complete.")
            except Exception as e:
                logger.warning(
                    f"[AgentWorker] Skipped opening statement (session not "
                    f"available, likely closing): {e}"
                )
        elif should_auto_start_conversation(
            scenario=self.scenario,
            event_orchestrator=self.event_orchestrator,
        ):
            # No scripted opening statement — kick off the agent loop so the
            # character opens the conversation via the LLM instead of staying
            # silent. This is best-effort: a failure here must NOT break the
            # session. The agent is already listening after session.start(), so
            # even if the auto-start turn doesn't fire the conversation still
            # works as soon as the user speaks.
            logger.info(
                "[AgentWorker] No opening statement; auto-starting agent turn "
                "via generate_reply()."
            )
            try:
                self.session.generate_reply()
            except Exception as e:
                logger.warning(
                    f"[AgentWorker] Auto-start generate_reply() failed; agent "
                    f"will respond once the user speaks: {e}"
                )

    async def shutdown(self):
        """
        Manually trigger the shutdown sequence.

        This calls the registered shutdown handler which ensures:
        - Helper tasks are cleaned up
        - Final scores are sent
        - Conversation logging is ended
        - Checkpoint data for this session is freed
        """
        logger.info("[AgentWorker] Manual shutdown triggered")
        if hasattr(self, "_shutdown_handler") and self._shutdown_handler:
            await self._shutdown_handler()
        else:
            logger.warning("[AgentWorker] No shutdown handler registered!")

        # Free checkpoint memory for this session
        try:
            from app.core.graph import cleanup_simulation_checkpoints

            cleanup_simulation_checkpoints(self.ctx.room.name)
        except Exception as e:
            logger.warning("[AgentWorker] Failed to cleanup checkpoints: %s", e)

    async def _handle_termination_in_entrypoint_context(self):
        """
        Background task that waits for termination signal and handles it
        in entrypoint context (not graph context).

        This allows termination audio to play reliably because it runs
        in the main async context, not the graph context.
        """
        if not self._termination_event:
            return

        try:
            # Wait for termination event to be set
            await self._termination_event.wait()

            logger.info(
                "[SIMULATION_PROMPT] CONVERSATION_END room=%s termination_triggered",
                self.ctx.room.name,
            )

            # Validate termination message exists and is not empty
            if not self._termination_message or not self._termination_message.strip():
                logger.error(
                    f"Termination event triggered but no valid message found. "
                    f"Message value: '{self._termination_message}'. "
                    f"This indicates a configuration error - termination should "
                    f"not proceed without a valid termination message. "
                    f"Aborting termination to prevent silent shutdown."
                )
                # Don't shutdown - this is a configuration error that should be fixed
                return

            # The termination message plays as-is (plain text); no voice-parameter
            # generation is applied.
            termination_text_to_say = self._termination_message

            # Step 2: Interrupt any current speech to prevent other utterances
            # from playing
            try:
                await asyncio.wait_for(self.session.interrupt(), timeout=2.0)
            except (asyncio.TimeoutError, Exception) as e:
                logger.warning(f"Error interrupting speech: {e}. Continuing anyway.")

            # Step 3: Play termination audio in entrypoint context
            try:
                handler = self.session.say(
                    termination_text_to_say, allow_interruptions=False
                )

                # Wait for playout
                try:
                    await asyncio.wait_for(handler.wait_for_playout(), timeout=15.0)
                except (asyncio.TimeoutError, asyncio.CancelledError) as e:
                    logger.warning(
                        f"Termination audio did not complete: {e}. "
                        "Proceeding with shutdown anyway."
                    )
            except Exception as e:
                logger.warning(
                    f"Failed to play termination audio in entrypoint context: {e}. "
                    "Proceeding with shutdown."
                )

            # Shutdown after audio completes (or if it failed)
            self.ctx.shutdown(SESSION_TERMINATED_MESSAGE)

        except Exception as e:
            logger.exception(f"Error in termination handler task: {e}")
            # Ensure shutdown happens even if there's an error
            try:
                self.ctx.shutdown(SESSION_TERMINATED_MESSAGE)
            except Exception:
                pass


async def entrypoint(ctx: agents.JobContext):
    logger.info(f"!!! ENTRYPOINT CALLED for job {ctx.job.id} !!!")
    """
    Main agent entrypoint

    This function can be used with:
        agent = Agent(options=WorkerOptions(...))
        await agent.run_from_notebook(entrypoint)
    """
    # Opt-in concurrency/freeze diagnostics. No-op unless
    # AGENT_DIAGNOSTICS_INTERVAL is set in the environment. Wrapped in
    # try/except so a bug in diagnostics can never prevent a job from running.
    try:
        from app.core.diagnostics import start_diagnostics

        start_diagnostics()
    except Exception as _diag_exc:
        logger.warning("Failed to start diagnostics, continuing: %r", _diag_exc)

    worker = AgentWorker(ctx)
    logger.info(f"[AgentWorker] Starting job {ctx.job.id}...")
    await worker.configure()  # Phase 1: Configure clients
    logger.info(f"[AgentWorker] Job {ctx.job.id} configured.")
    await worker.initialize()  # Phase 2: Create session, agent, orchestrator
    logger.info(f"[AgentWorker] Job {ctx.job.id} initialized.")
    await worker.start()  # Phase 3: Connect and start
    logger.info(f"[AgentWorker] Job {ctx.job.id} started.")

    # Start background task to handle termination in entrypoint context
    # This allows termination audio to play reliably (runs in main async context)
    termination_task = asyncio.create_task(
        worker._handle_termination_in_entrypoint_context()
    )
    worker._background_tasks.add(termination_task)
    termination_task.add_done_callback(worker._background_tasks.discard)

    logger.info("Termination handler task started in entrypoint context")

    # CRITICAL FIX: Wait for either termination or room disconnection
    # This keeps the entrypoint function running for the duration of the conversation
    # Without this, the function returns immediately and LiveKit terminates the agent
    # Skip waiting in test environment to prevent tests from hanging
    is_test_env = "pytest" in sys.modules or "PYTEST_CURRENT_TEST" in os.environ

    # Safety check: Only wait if events are initialized and not in test environment
    if (
        not is_test_env
        and worker._termination_event is not None
        and worker._room_disconnected_event is not None
    ):
        termination_triggered = False
        try:
            # Wait for either termination event or room disconnection
            logger.info(
                "[AgentWorker] Waiting for termination or room disconnection..."
            )
            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(worker._termination_event.wait()),
                    asyncio.create_task(worker._room_disconnected_event.wait()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # Cancel the pending task
            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            termination_triggered = worker._termination_event.is_set()
            logger.info(
                f"[AgentWorker] Waiting completed. Done count: {len(done)}. "
                f"Termination triggered: {termination_triggered}"
            )

            # CRITICAL: When termination triggered, wait for termination handler
            # to play the goodbye message before shutdown. Otherwise we would
            # cancel it via cleanup_background_tasks and the user never hears it.
            if termination_triggered:
                logger.info(
                    "[AgentWorker] Waiting for termination audio to complete..."
                )
                try:
                    await asyncio.wait_for(termination_task, timeout=30.0)
                    logger.info("[AgentWorker] Termination audio completed.")
                except asyncio.TimeoutError:
                    logger.warning(
                        "[AgentWorker] Termination audio timed out after 30s. "
                        "Proceeding with shutdown."
                    )
                except asyncio.CancelledError:
                    logger.warning(
                        "[AgentWorker] Termination task was cancelled. "
                        "Proceeding with shutdown."
                    )

            logger.info("Entrypoint waiting completed - agent will shutdown")
        except Exception as e:
            logger.exception(f"Error waiting for conversation end: {e}")
            logger.info(f"[AgentWorker] Error in entrypoint: {e}")
            # Ensure we don't hang if there's an error
            if worker._room_disconnected_event:
                worker._room_disconnected_event.set()
        finally:
            logger.info("[AgentWorker] Triggering shutdown callback...")
            await worker.shutdown()
            logger.info("[AgentWorker] Entrypoint returning. Job finished.")
    else:
        logger.warning(
            "Events not initialized - skipping wait. "
            "This may occur in tests or if start() failed."
        )


def prewarm(proc: JobProcess):
    logger.info("!!! PREWARM CALLED !!!")
    """Prewarm VAD model for faster startup."""
    proc.userdata["vad"] = silero.VAD.load(
        activation_threshold=DEFAULT_VAD_ACTIVATION_THRESHOLD
    )


if __name__ == "__main__":
    agent_name = "" if settings.ENV == Environment.LOCAL else settings.AGENT_NAME
    agents.cli.run_app(
        agents.WorkerOptions(
            agent_name=agent_name,
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            num_idle_processes=2,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
            ws_url=settings.LIVEKIT_URL,
            # Increased from 10 to 600 seconds (10 minutes) for longer conversations
            drain_timeout=600,
            job_memory_warn_mb=650,
            initialize_process_timeout=120,
        )
    )
