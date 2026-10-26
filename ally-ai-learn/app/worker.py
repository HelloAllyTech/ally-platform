import asyncio
import functools
import json
import os
import random
import sys
import time
from typing import Optional, Set

from livekit import agents, rtc
from livekit.agents import (
    Agent,
    AgentSession,
    JobProcess,
    RoomInputOptions,
    RoomOutputOptions,
)
from livekit.plugins import noise_cancellation, silero

from app.core.agent.factory import (
    cleanup_background_tasks,
    configure_llm_client,
    configure_stt_client,
    configure_tts_client,
    create_agent_with_adapter,
    initialize_agent_state,
    parse_room_metadata,
    resolve_job_metadata,
    should_auto_start_conversation,
    should_say_opening_statement,
)
from app.core.config import settings
from app.core.constants import (
    DEFAULT_BRANCHING_LLM_CONFIG,
    DEFAULT_LANGUAGE_CODE,
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
from app.core.fallback_lines import tts_failure_fallback_line
from app.core.livekit.audio_filters import (
    session_livekit_url,
    supports_noise_cancellation,
)
from app.core.livekit.text_chat import text_chat_room_options
from app.core.livekit.video_actor import (
    attach_video_actor,
    defers_attach,
    human_participants,
    is_video_actor_enabled,
    start_video_actor,
)
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import (
    get_logger,
    make_child_logging_forward_only,
    patch_livekit_parent_logger,
    setup_livekit_logging,
)
from app.core.metrics import turn_metrics
from app.core.queue.utils import (
    send_session_paused_message,
    send_session_resumed_message,
)
from app.core.scenario.base import Scenario
from app.core.scoring.score_keeper import ScoreKeeper
from app.core.session_clock import SessionClock
from app.core.tasks import spawn_background_task
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
    from livekit.plugins.turn_detector import (  # noqa: F401
        multilingual as _eou_multilingual,
    )

logger = get_logger(__name__)


class _SkipWorkingMemoryPool(Exception):
    """Internal: the scenario has not opted into the client working memory."""


setup_livekit_logging(
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
# Agent's own LiveKit connection state, so the client can show a "reconnecting"
# state rather than presenting a live-looking but mute call. The client's SDK
# sees its OWN connection; this reports the AGENT's, which can drop
# independently. State is one of CONN_STATE_RECONNECTING / CONN_STATE_CONNECTED.
#
# Note the inherent limitation: a "reconnecting" packet published while the
# agent's own transport is down will usually NOT arrive. The reliable edge is
# the "connected" one, published after recovery — that is what lets a client
# clear a reconnecting state it inferred itself. Both are best-effort by
# nature, never load-bearing for correctness.
CTRL_CONNECTION_STATE = "connection-state"
CONN_STATE_RECONNECTING = "reconnecting"
CONN_STATE_CONNECTED = "connected"
# A technical fault the learner would otherwise only experience as silence.
# ``fatal: true`` means the session is being torn down now (nothing the learner
# can do); ``fatal: false`` means the session is still live but degraded.
# ``reason`` is the same string passed to ctx.shutdown, for support/debugging —
# it is NOT user-facing copy and must not be rendered verbatim.
CTRL_SESSION_FAULT = "session-fault"

# Minimum gap between spoken recoveries from a lost-audio TTS failure (see
# _register_tts_error_fallback). The recovery line is synthesized on the SAME
# instance that just failed, so an unthrottled one-per-error reaction turns a
# provider outage into a burst of failing say() calls — each of which is
# another unrecoverable error counting toward AgentSession's own close
# threshold. One line per window is enough for the learner: it either works
# (and the session carries on) or it doesn't (and the existing close handler
# owns the teardown).
TTS_FAILURE_FALLBACK_COOLDOWN_S = 20.0


# The agent is the AUTHORITATIVE enforcer of the scenario time limit: it ends
# the session when ACTIVE elapsed time (excluding pauses) reaches the limit.
# The client timer is display + a redundant fallback only. A tiny grace lets
# the client's on-screen countdown visibly reach zero just before the agent
# tears down (avoids ending a beat "early" on sub-second clock differences).
# Env-overridable (see config.py).
MAX_DURATION_GRACE_SECONDS = settings.MAX_DURATION_GRACE_SECONDS

# shutdown_with_cleanup's own teardown steps — none of these persist score or
# memory, so unlike finalize_session they gain nothing from running long. Left
# unbounded, any one of them stalling (e.g. a slow network call tearing down
# the BVC audio track) stacks directly on top of on_shutdown's own ~19s
# budget (see WorkerOptions' shutdown_process_timeout comment) and can push
# the whole chain past the SDK's shutdown_process_timeout, getting the
# process SIGUSR1-killed mid-finalize (observed live: "process did not exit
# in time, killing process" / exit code -10, recurring days after that
# budget was first tuned). Capped short so a stall can only ever cost a few
# seconds, never the rest of the shutdown window.
SUPERVISOR_NOTES_CLOSE_TIMEOUT = 3.0
BG_AUDIO_CLOSE_TIMEOUT = 3.0
# Video-actor teardown budget. Shorter than the audio one: its tracks are
# cosmetic, so a renderer that will not let go must not eat into the shutdown
# deadline that the session's own finalization needs.
VIDEO_ACTOR_CLOSE_TIMEOUT = 2.0
BACKGROUND_TASKS_CLEANUP_TIMEOUT = 3.0


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

        # Startup-latency instrumentation: per-segment elapsed times (ms) filled
        # in during configure/initialize/start and emitted as one [START_TIMING]
        # line by the entrypoint, so we can see which segment dominates the delay
        # before the agent speaks its opening line. Log-only; never gates logic.
        self._timing: dict[str, float] = {}

        # Thinking-filler (plays on a separate audio track via
        # BackgroundAudioPlayer, so it can't race/preempt the real reply). We
        # drive playback ourselves on the agent's "thinking" state so we know
        # which phrase plays and can record it in the transcript.
        self._bg_audio = None
        self._filler_handle = None
        # EXPERIMENTAL AI video actor (app/core/livekit/video_actor.py). Stays
        # None for every session that has not opted in at BOTH gates, which is
        # every session today. Its `publishes_audio` is the only thing that lets
        # the session suppress its own audio output, so nothing else may set it.
        self._video_actor = None
        # The deferred attach runs while the session is already talking, so the
        # handle lands here mid-session rather than before session.start. Held
        # separately so shutdown can cancel the wait before closing the vendor.
        self._video_actor_task: Optional[asyncio.Task] = None
        # ONE accumulating pool of in-memory clips for the whole session (static
        # Studio phrases, the session-start seed batch, per-exchange batches and
        # in-turn batches all land here). Accumulating rather than replacing is
        # what stops a long session cycling through five phrases; selection
        # applies the recency/type/duration rules. See filler_pool.FillerPool.
        self._filler_pool = None
        self._predictor_task: Optional[asyncio.Task] = None
        # Connection-isolated LLM client for filler generation, so those calls
        # can't contend with the real reply's in-flight call on the same
        # connection — see _setup_predictive_filler_llm_client.
        self._predictive_filler_llm_client = None
        # Predicts this turn's reply latency from the session's own history, so
        # playback decides immediately instead of waiting to find out.
        self._gap_predictor = None
        self._filler_enabled: bool = False
        self._agent_thinking: bool = False
        # Per-turn playback bookkeeping: how many fillers have played this turn
        # (capped), and the continuation watcher that fills a silence after one
        # ends. Reset when the turn moves on.
        self._filler_turn_count: int = 0
        self._filler_consecutive_turns: int = 0
        self._filler_played_this_turn: bool = False
        # Guards the run-length accounting below from firing twice per turn:
        # LiveKit's AgentState cycles listening->thinking->speaking->listening,
        # so leaving "thinking" is followed by a second non-thinking event
        # (speaking->listening) before the next turn's "thinking". Settle once
        # per turn, on the first of those, then wait for the next "thinking".
        self._filler_turn_settled: bool = True
        self._filler_continuation_task: Optional[asyncio.Task] = None
        # Set as soon as the filler decision for a turn resolves (played, or
        # declined), so the interim reply chains on the actual event instead of
        # sleeping out the old worst-case delay.
        self._filler_decided = asyncio.Event()
        # In-turn generation: fires once mid-utterance so the played filler has
        # seen what the learner is actually saying.
        self._filler_in_turn_task: Optional[asyncio.Task] = None
        self._filler_in_turn_armed: bool = False
        # Session counters, logged once at shutdown: how much work the layer did
        # and how well the cache served it.
        self._filler_stats: dict = {
            "llm_calls": 0,
            "clips_synthesized": 0,
            "played": 0,
            "continuations": 0,
            "distinct_played": set(),
            "first_clip_ready_s": None,
        }
        # Early trigger (experimental, off by default): start a filler at VAD
        # end-of-speech rather than after endpointing completes.
        self._filler_early_task: Optional[asyncio.Task] = None
        # Raised when the character finishes speaking, which is when the pool may
        # want refreshing — the pipeline is idle and a new turn just landed.
        self._filler_regen_signal = asyncio.Event()

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
        # In-memory clips (see filler_clips.FillerClip) — no temp files.
        self._backchannel_clips: list = []
        self._backchannel_task: Optional[asyncio.Task] = None
        self._backchannel_handle = None
        self._user_speaking: bool = False
        # Recent back-channel phrases, so consecutive emissions don't repeat
        # (kept separate from the filler's pool — different phrase sets).
        self._recent_backchannel_phrases: list[str] = []

        # Whether this session's voice can render clips at all (the clip policy
        # in BaseTTSClient.allows_clip_synthesis). Decided once in
        # _setup_background_audio; False means no filler, back-channel or
        # interim layer, and none of their LLM calls.
        self._clip_tts_on: bool = False
        #: Clip-less voice taking only the bundled breath/sigh openers.
        self._asset_openers_only: bool = False

        # Interim generator, for scenarios WITHOUT working memory (working
        # memory writes its own interim into the delivery plan): while the
        # learner is still speaking on a long turn, a fast DEDICATED model turns
        # the partial transcript into a short, non-committal holding line,
        # pre-rendered and handed to the OpenerPlayer, which plays it under the
        # same timing rules as any interim. See app/core/livekit/interim_reply.py.
        self._interim_enabled: bool = False
        self._interim_llm_client = None
        # Per-turn state machine: idle -> generating -> ready (handed over).
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

        # Delivery plan (DELIVERY_PLAN_ENABLED): how each reply STARTS. The
        # holder is shared with the graph through configurable — its planners
        # write the next plan into it, generate_response reads what opener was
        # already said — and OpenerPlayer plays the plan on the background
        # track. Built unconditionally (it is inert until `active`), because
        # the agent and its configurable are created before background audio
        # knows whether any opener can play. See app/core/livekit/delivery.py.
        from app.core.livekit.delivery import TurnDelivery

        self.turn_delivery = TurnDelivery()
        self._opener_player = None

        # ========== Termination Handling (for entrypoint context) ==========
        # Use asyncio.Event to signal termination from graph context
        # to entrypoint context
        self._termination_event: Optional[asyncio.Event] = None
        self._termination_message: Optional[str] = None
        # Event to signal room disconnection to entrypoint
        self._room_disconnected_event: Optional[asyncio.Event] = None

        # Mid-session stall watchdog (armed in initialize()): detects a wedged
        # session (learner turn left unanswered), dumps stacks, and fails it
        # cleanly. See app/core/session_watchdog.py.
        self._stall_watchdog = None
        self._loop = None

        # Loop-free score/memory delivery for the watchdog's force-exit path
        # (built in _register_callbacks). See app/core/emergency_finalize.py.
        self._emergency_finalizer = None

        # True between CONN_RECONNECTING and the next CONN_CONNECTED, so the
        # recovery signal is only sent when a problem was actually reported.
        self._connection_recovering = False

        # The exact TTS object handed to AgentSession (captured in
        # _create_session) plus the last time we spoke a recovery line for one
        # of its failures — see _register_tts_error_fallback.
        self._session_tts_instance = None
        self._last_tts_fallback_at: Optional[float] = None

    async def configure(self):
        """
        - Parse metadata and extract scenario
        - Create all clients (STT, TTS, LLM, embedding)
        - Initialize agent graph state

        After this phase, you can access:
        - self.scenario
        - self.stt_client, self.tts_client, self.llm_client, self.embedding_client
        """
        # Setup embedding client (needed for metadata parsing). Semantic-similarity/
        # paraphrase-detection events only run with an OpenAI key configured;
        # self.embedding_client is already Optional and null-checked at every
        # consumption site, so leaving it None here safely disables just those
        # events for an Ollama-only (no OpenAI key) session.
        if settings.OPENAI_API_KEY:
            self.embedding_client = OpenAIEmbeddingClient(
                model=settings.OPENAI_EMBEDDING_MODEL,
                api_key=settings.OPENAI_API_KEY,
                # Attributes its usage (event_embedding, working_memory_
                # embedding) to this session, wherever the call is made from.
                room_id=self._usage_room_id(),
            )
            logger.debug(
                "Created shared embedding client for semantic similarity events"
            )
            # Set once at session start so per-turn _prepare_event_context doesn't
            # mutate a class attribute on every graph invocation.
            from app.core.events.event_types.semantic_similarity.semantic_similarity_event import (  # noqa: E501
                SemanticSimilarityEvent,
            )

            SemanticSimilarityEvent._EMBEDDING_CLIENT = self.embedding_client
        else:
            logger.info(
                "No OPENAI_API_KEY configured — "
                "semantic-similarity/paraphrase-detection "
                "events are disabled for this session."
            )

        # Resolve then parse metadata. Slim dispatches (metadataFetch pointer)
        # are fetched from ally-be here — after assignment, off LiveKit's 3s
        # dispatch window; inline payloads pass through untouched.
        raw_metadata = await resolve_job_metadata(self.ctx.job.metadata)
        rm_md_envelope = parse_room_metadata(
            raw_metadata,
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

        # Configure STT and TTS clients - using utility functions. A text-chat
        # roleplay has neither: the learner types, the reply is published as
        # text, and leaving both None is what keeps every voice-only feature
        # below (audio tags, fillers, opener clips, TTS-failure recovery) off.
        if self._is_text_chat:
            self.stt_client = None
            self.tts_client = None
            logger.info(
                "[TEXT_CHAT] text-chat roleplay — no STT/TTS (room=%s)",
                self.ctx.room.name,
            )
        else:
            self.stt_client = configure_stt_client(self.scenario)
            self.tts_client = configure_tts_client(self.scenario)

        # Capture STT/TTS provider+model for token-usage (AI-cost) emission in
        # the metrics hook. Read defensively off the scenario config; the live
        # billable metrics (audio duration / characters) come from LiveKit.
        if self._is_text_chat:
            # Nothing is transcribed or synthesized, so nothing is attributed.
            self._stt_provider = self._stt_model = None
            self._tts_provider = self._tts_model = None
        else:
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

        # Rolling-summary store (episodic memory): worker-owned like the
        # SessionClock. Written by compact_history's detached task, read by
        # generate_response for prompt composition and by finalize_session for
        # the end-of-session session_memory message.
        from app.core.graph.knowledge_retrieval import RetrievedContextStore
        from app.core.graph.rolling_summary import RollingSummaryStore

        self.rolling_summary_store = RollingSummaryStore()
        # Async knowledge retrieval (stale-while-revalidate) handoff.
        self.retrieved_context_store = RetrievedContextStore()
        # The client's working memory (docs/client-working-memory-design.md).
        # Worker-owned for the same reason as the two above: agent_graph is
        # compiled once at import and shared by every concurrent session in this
        # process, so the per-session run config is the only place per-session
        # identity exists.
        #
        # Constructed unconditionally; whether anything READS it is decided per
        # scenario by the `{client_working_memory}` placeholder in the selected
        # main-agent prompt (design §6.1), so a scenario that has not opted in
        # neither renders the block nor pays for the call that fills it.
        from app.core.graph.prompt import prompt_declares_client_working_memory
        from app.core.working_memory import ClientWorkingMemoryStore, build_corpus

        # THE LADDER IS THE SCENARIO'S, not the framework's.
        #
        # An author who wrote "Dis-engaged, feeling discouraged and confused" ->
        # "Feels heard and is open to sharing" -> "Explores fears and
        # preferences" -> "Confident to draw boundary assertively" has written a
        # stance ladder. Making them climb a fixed five-rung one and mapping
        # between the two lost content whenever they wrote more than five bands,
        # and described the client in generic terms when they had authored
        # specific ones.
        #
        # States arrive pre-sorted by scoreLower ascending, so their order IS
        # the intended progression. Falls back to the generic five when a
        # scenario defines no states.
        from app.core.working_memory.state import STANCES

        _states = getattr(getattr(self.scenario, "prompt_data", None), "states", None)
        _ladder = tuple(
            str(st.get("name")).strip()
            for st in (_states or [])
            if isinstance(st, dict) and str(st.get("name") or "").strip()
        )
        if len(_ladder) != len(set(_ladder)):
            # Duplicate rung names would make `ladder.index()` ambiguous and
            # silently pin two bands to one rung.
            logger.warning(
                "[working-memory] scenario states have duplicate names %s — "
                "falling back to the generic ladder",
                _ladder,
            )
            _ladder = ()
        if len(_ladder) < 2:
            _ladder = tuple(STANCES)
        logger.info(
            "[working-memory] ladder (%d rungs): %s",
            len(_ladder),
            " -> ".join(_ladder),
        )
        self.client_working_memory_store = ClientWorkingMemoryStore(ladder=_ladder)

        # The pool `salient_backstory` is recalled FROM (phase 6). Built once,
        # here, because it never changes during a session and because chunking
        # on the reply path would be latency spent on an unchanging answer.
        #
        # This is what replaces dumping `character_profile_text` into every
        # turn's prompt: the same material, ranked per turn against what the
        # learner just said, five facts instead of the whole biography. Scenario
        # knowledge folds into the same pool so a personal memory and a case-file
        # detail compete on relevance rather than occupying separate blocks.
        # Gated on the scenario's opt-in. Without this the pool was built and
        # EMBEDDED on every session in the fleet — an embedding API call per
        # session, at setup, for a pool that nothing would read. The updater
        # only runs for an opted-in scenario, so the same gate belongs here.
        _cwm_prompt_data = getattr(self.scenario, "prompt_data", None)
        _cwm_opted_in = _cwm_prompt_data is not None and (
            prompt_declares_client_working_memory(_cwm_prompt_data)
        )

        # ALWAYS log the opt-in decision, at INFO, with the REASON.
        #
        # This is the one line that says whether the feature ran. Without it the
        # off state is indistinguishable from the on state from the outside: a
        # non-opted-in session produces a complete transcript, a good score and
        # no errors, and simply lacks the block. That is exactly how a prod
        # session ran for a full 8 exchanges looking perfect while the feature
        # was silently disabled — the prompt was file-backed, so ally-be never
        # dispatched it (getPromptsForScenarioSession filters
        # useDashboardOverrideOnly) and the placeholder check found nothing.
        #
        # The old signal for the off path was logger.debug, and prod runs at
        # INFO, so the only way to tell was correlating [PROMPT_SOURCE] lines in
        # CloudWatch. Anyone authoring a scenario against this feature needs to
        # be able to answer "did it engage?" without that.
        if _cwm_opted_in:
            # Which FORM, and for the split form which SECTIONS.
            #
            # The block form makes "did it engage?" a yes/no. The split form
            # adds a state that could not exist before: opted in and HALF
            # rendered, where a prompt declares some sections and omits others.
            # That session produces a complete transcript, a good score and no
            # errors — the same shape of invisible failure this log was added
            # for in the first place, one level down. So report the sections by
            # name rather than the fact of engagement.
            from app.core.graph.prompt import declared_working_memory_sections
            from app.core.working_memory.render import SECTION_VARIABLES

            _cwm_sections = declared_working_memory_sections(_cwm_prompt_data)
            if not _cwm_sections:
                _how = "the {client_working_memory} block placeholder"
            elif len(_cwm_sections) == len(SECTION_VARIABLES):
                _how = "all %d working_memory_* section placeholders" % len(
                    SECTION_VARIABLES
                )
            else:
                _missing = [
                    name for name in SECTION_VARIABLES if name not in _cwm_sections
                ]
                _how = (
                    "%d of %d working_memory_* section placeholders — NOT "
                    "rendering: %s. Add them to the prompt body if that was "
                    "not deliberate."
                ) % (
                    len(_cwm_sections),
                    len(SECTION_VARIABLES),
                    ", ".join(_missing),
                )
            logger.info(
                "[working-memory] ENGAGED room=%s — scenario opted in via %s",
                self.ctx.room.name,
                _how,
            )
        else:
            if _cwm_prompt_data is None:
                _why = "no prompt_data on the scenario"
            else:
                _why = (
                    "the selected main-agent prompt declares neither "
                    "{client_working_memory} nor any working_memory_* section "
                    "placeholder — if it should, add them to the prompt's "
                    "live version in the Skills Store"
                )
            logger.info(
                "[working-memory] NOT ENGAGED room=%s — %s",
                self.ctx.room.name,
                _why,
            )

        try:
            if not _cwm_opted_in:
                raise _SkipWorkingMemoryPool
            self.client_working_memory_store.corpus = build_corpus(
                character_profile_text=getattr(
                    _cwm_prompt_data, "character_profile_text", None
                ),
                retrieved_context=None,
            )
            # Embed the pool for the semantic half of recall (§7.3), as a
            # DETACHED task rather than inline. Setup is already off the reply
            # path, but it is NOT off the join path, and this repo has a history
            # of "agent joins but doesn't speak" — an embedding batch between
            # dispatch and the opening line is exactly the kind of thing that
            # turns into a silent join delay. Recall ranks lexically until the
            # vectors land, which is a weaker ranking and not a broken one.
            if (
                self.embedding_client is not None
                and self.client_working_memory_store.corpus
            ):
                from app.core.working_memory.corpus import attach_vectors

                async def _embed_pool() -> None:
                    await attach_vectors(
                        self.client_working_memory_store.corpus,
                        self._working_memory_embed_many(),
                    )

                _pool_task = asyncio.create_task(_embed_pool())
                # Tracked, so teardown cancels it instead of leaving a task
                # holding the embedding client past session end.
                self._background_tasks.add(_pool_task)
                _pool_task.add_done_callback(self._background_tasks.discard)
        except _SkipWorkingMemoryPool:
            logger.debug("[working-memory] pool skipped: scenario has not opted in")
        except Exception as _corpus_error:  # noqa: BLE001
            # Recall having nothing to draw on is a quiet degradation; failing
            # session setup over it would not be.
            logger.warning(
                "[working-memory] backstory pool build failed: %s", _corpus_error
            )

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
            rolling_summary_store=self.rolling_summary_store,
            retrieved_context_store=self.retrieved_context_store,
            client_working_memory_store=self.client_working_memory_store,
            turn_delivery=self.turn_delivery,
        )

        # Register callbacks
        self._register_callbacks()

        # Arm the mid-session stall watchdog now that the session + handlers
        # exist. Best-effort; never blocks session start.
        self._setup_stall_watchdog()

    def _setup_stall_watchdog(self) -> None:
        """Arm the per-session stall watchdog.

        Detects the wedge signature (a finalized learner turn with no agent
        response for the configured threshold), dumps every thread's stack so the
        hang is locatable, ends the session cleanly, and — if the event loop is
        truly blocked — force-exits this (per-job) process so the room frees.
        Fully guarded: any failure leaves the session running without it.

        Before that force-exit it runs the EmergencyFinalizer synchronously on
        the watchdog thread, so the learner's score and session memory are
        still delivered. os._exit runs no shutdown callback, so without this
        the wedged session was never scored at all — see
        app/core/emergency_finalize.py.
        """
        if not getattr(settings, "SESSION_STALL_WATCHDOG_ENABLED", True):
            return
        try:
            from app.core.session_watchdog import SessionStallWatchdog

            self._loop = asyncio.get_running_loop()
            room = self.ctx.room.name

            def _on_stall() -> None:
                # Scheduled onto the event loop. If the loop is blocked this never
                # runs, and the watchdog's force-exit escalation frees the room.
                try:
                    self._loop.call_soon_threadsafe(
                        lambda: self.ctx.shutdown("watchdog_session_stall")
                    )
                except Exception:  # noqa: BLE001
                    logger.exception("[WATCHDOG] failed to schedule shutdown")

            def _on_force_exit() -> None:
                """Deliver score + memory without the event loop (see module
                docstring). Guarded again here so a missing finalizer can never
                stop the force-exit."""
                finalizer = getattr(self, "_emergency_finalizer", None)
                if finalizer is None:
                    logger.error(
                        "[WATCHDOG] no EmergencyFinalizer for room=%s — the "
                        "final score cannot be delivered on the force-exit path",
                        room,
                    )
                    return
                # `final_score_sent` is set when the connection-state handler
                # SPAWNS the finalize task, not when it finishes — so on a
                # blocked loop it can be True while nothing was actually sent.
                # Only treat it as delivered when no finalize task is still
                # pending. Erring toward a duplicate end-of-session message is
                # deliberate: Core re-applies the same score, whereas a missed
                # send loses the session.
                _pending = getattr(self, "_finalize_task_ref", None) or []
                _finalize_incomplete = bool(_pending) and not _pending[0].done()
                if self.final_score_sent and not _finalize_incomplete:
                    logger.info(
                        "[WATCHDOG] score already sent for room=%s; skipping "
                        "emergency finalize",
                        room,
                    )
                    return
                finalizer.flush_sync(reason="watchdog_force_exit")

            wd = SessionStallWatchdog(
                on_stall=_on_stall,
                on_force_exit=_on_force_exit,
                threshold_s=getattr(settings, "SESSION_STALL_THRESHOLD_S", 75.0),
                poll_s=getattr(settings, "SESSION_STALL_POLL_S", 5.0),
                force_exit_grace_s=getattr(
                    settings, "SESSION_STALL_FORCE_EXIT_GRACE_S", 30.0
                ),
                force_exit_enabled=getattr(
                    settings, "SESSION_STALL_FORCE_EXIT_ENABLED", True
                ),
                room=room,
            )
            self._stall_watchdog = wd

            # A finalized learner turn (role "user") arms the timer; the agent
            # producing output clears it.
            @self.session.on("conversation_item_added")
            def _wd_on_item(ev):
                try:
                    role = getattr(getattr(ev, "item", None), "role", None)
                    if role == "user":
                        wd.note_user_turn_finalized()
                    elif role == "assistant":
                        wd.note_agent_response()
                except Exception:  # noqa: BLE001
                    pass

            # Clear only when the agent actually PRODUCES audio ("speaking"), not
            # merely when it starts "thinking" — so a hang after thinking is still
            # caught.
            @self.session.on("agent_state_changed")
            def _wd_on_agent_state(ev):
                try:
                    if getattr(ev, "new_state", None) == "speaking":
                        wd.note_agent_response()
                except Exception:  # noqa: BLE001
                    pass

            wd.start()
            logger.info(
                "[WATCHDOG] stall watchdog armed (threshold=%.0fs, room=%s)",
                getattr(settings, "SESSION_STALL_THRESHOLD_S", 75.0),
                room,
            )
        except Exception:  # noqa: BLE001 - watchdog must never break a session
            logger.exception("[WATCHDOG] failed to arm; continuing without it")
            self._stall_watchdog = None

    @property
    def _is_text_chat(self) -> bool:
        """Whether this job is a text-chat roleplay (audio off both ways).

        None-safe: read before configure() has parsed the scenario, and by
        tests that build a worker without one — both mean a voice session.
        """
        return bool(getattr(self.scenario, "is_text_chat", False))

    def _create_session(self):
        """Create agent session with STT and TTS."""
        if self._is_text_chat:
            # Text chat: no STT, TTS, VAD or turn detection. Each typed message
            # IS the end of the learner's turn, so there is nothing to detect.
            # user_away_timeout is off because "away" is derived from voice
            # activity, which a typing learner never produces — left on, it
            # would flag every learner as away while they compose a reply.
            self._session_tts_instance = None
            self.session = AgentSession(user_away_timeout=None)
            return

        # VAD is always prewarmed in prewarm(), so retrieve it regardless
        vad = self.ctx.proc.userdata.get("vad")
        stt_instance = self.stt_client.stt_instance
        tts_instance = self.tts_client.tts_instance

        # Semantic EOU (multilingual) layered on VAD when enabled, else the plain
        # VAD silence timeout (prior behaviour). See _resolve_turn_detection for
        # the language-coverage + graceful-fallback details.
        turn_detection, endpointing_kwargs = self._resolve_turn_detection(vad)

        # Keep the exact instance we hand over: it is the one the session's own
        # error handling listens on, and the one _register_tts_error_fallback
        # must attach to (tts_instance is a lazily-built property, so reading it
        # again is a per-client convention, not a guarantee — see
        # BaseTTSClient.create_clip_tts).
        self._session_tts_instance = tts_instance

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

        ally-be always sends this session's endpointing bounds (admin-configured
        globally on the Settings page) via room metadata → prompt_data.turn_min/
        max_endpointing_delay. This is the production path, not a per-sim
        experiment: the value read here IS the platform's configured min/max.
        settings.TURN_MIN/MAX_ENDPOINTING_DELAY (the local env-var defaults) are
        a fallback-of-last-resort, used only when that metadata is missing or
        fails validation — e.g. ally-be is unreachable, a cached room-metadata
        blob predates this field, or a non-numeric/invalid pair somehow arrives.
        The admin form and the ally-be DTO both reject max <= min, but stored
        data is never trusted here: the pair is applied only when both are
        present and 0 < min < max, otherwise the session falls back to the
        local defaults and logs why. PromptData is built from a hand-maintained
        mapped_data dict in Scenario._build_prompt_data, so the mapping for
        these two fields matters — it's covered by a test.

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
            # Overlay ally-be's configured pair (all-or-nothing) on the local defaults.
            min_delay, max_delay = self._apply_configured_endpointing(
                min_delay, max_delay
            )
            # The EOU model weights are loaded once per WORKER by the inference
            # executor (registered at module import — see the top-of-file note),
            # so this per-job construction is a lightweight handle to that
            # executor, NOT a weight load. It also requires the job context, so
            # it cannot be prewarmed. Timed here so [START_TIMING] can confirm it
            # stays cheap (if it ever isn't, revisit).
            _eou_t0 = time.monotonic()
            detector = MultilingualModel()
            self._timing["eou_load_ms"] = (time.monotonic() - _eou_t0) * 1000
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
        except (
            Exception
        ) as e:  # noqa: BLE001 - never fail a session over turn detection
            logger.warning(
                "[TURN] semantic EOU unavailable (%s); falling back to VAD timeout",
                e,
            )
            return "vad", {}

    def _apply_configured_endpointing(
        self, min_delay: float, max_delay: float
    ) -> tuple[float, float]:
        """Overlay ally-be's admin-configured endpointing pair on the local
        env-var defaults.

        ally-be always populates prompt_data.turn_min/max_endpointing_delay
        from its global Settings-page value, so in normal operation this pair
        IS what gets applied — the local defaults (`min_delay`/`max_delay` as
        passed in) only surface when that value is absent or invalid. Applied
        all-or-nothing: a half-configured or nonsensical pair (either bound
        missing, non-numeric, <= 0, or min >= max) leaves BOTH local defaults
        in place rather than mixing a configured bound with a default one,
        which would be near-impossible to reason about from a log line. The
        admin form and the ally-be DTO already reject max <= min; this guard
        is for stale/cached room metadata or anything written straight
        through the API.
        """
        prompt_data = getattr(self.scenario, "prompt_data", None)
        raw_min = getattr(prompt_data, "turn_min_endpointing_delay", None)
        raw_max = getattr(prompt_data, "turn_max_endpointing_delay", None)
        if raw_min is None and raw_max is None:
            return min_delay, max_delay
        try:
            configured_min = float(raw_min)
            configured_max = float(raw_max)
        except (TypeError, ValueError):
            logger.warning(
                "[TURN] configured endpointing ignored (non-numeric min=%r "
                "max=%r); using local defaults %.2fs/%.2fs",
                raw_min,
                raw_max,
                min_delay,
                max_delay,
            )
            return min_delay, max_delay
        if not (0 < configured_min < configured_max):
            logger.warning(
                "[TURN] configured endpointing ignored (invalid pair min=%.2fs "
                "max=%.2fs; need 0 < min < max); using local defaults "
                "%.2fs/%.2fs",
                configured_min,
                configured_max,
                min_delay,
                max_delay,
            )
            return min_delay, max_delay
        logger.info(
            "[TURN] configured endpointing applied: min=%.2fs max=%.2fs "
            "(local defaults were %.2fs/%.2fs)",
            configured_min,
            configured_max,
            min_delay,
            max_delay,
        )
        return configured_min, configured_max

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

        # Zombie-room safety net: AgentSession CLOSES ITSELF after a few
        # unrecoverable LLM/STT/TTS errors (agent_session._on_error) — but the
        # job and room live on, leaving the learner (or v2v tester) talking to
        # a corpse until they give up. Observed in prod 2026-08-20 (Marathi:
        # Sarvam clip-synthesis failures closed the session mid-reply; the
        # room sat silent ~100s to idle timeout). On an error-close, shut the
        # job down so the session ends visibly instead of silently.
        @self.session.on("close")
        def _on_session_close(ev):
            try:
                reason = getattr(ev, "reason", None)
                error = getattr(ev, "error", None)
                if str(getattr(reason, "value", reason)) == "error" or error:
                    logger.error(
                        "[SESSION] AgentSession closed with error (%s) — "
                        "shutting down job so the room doesn't zombie",
                        error,
                    )
                    # Tell the client WHY before tearing down, so the learner
                    # sees "something broke" instead of a call that just stops.
                    # A spoken apology is NOT possible here: the AgentSession
                    # is already closed, so session.say() raises "AgentSession
                    # is closing, cannot use say()" — and the failure that got
                    # us here is usually TTS itself. The structured signal is
                    # the only channel left. Scheduled as a task because this
                    # handler is sync (LiveKit contract); the shutdown happens
                    # inside it, AFTER the publish, so the packet is not raced
                    # by room teardown.
                    task = asyncio.create_task(
                        self._fault_then_shutdown("agent_session_error")
                    )
                    self._background_tasks.add(task)
                    task.add_done_callback(self._background_tasks.discard)
            except Exception:  # noqa: BLE001 - never break close handling
                logger.exception("[SESSION] close handler failed")
                # The teardown matters more than the notification: if
                # scheduling the announce failed, still end the job so the
                # room cannot zombie (the behaviour this handler was added
                # for in the first place).
                try:
                    self.ctx.shutdown("agent_session_error")
                except Exception:  # noqa: BLE001
                    logger.exception("[SESSION] fallback shutdown failed")

        # The complementary case to the close handler above: ONE failed
        # synthesis, which never accumulates to a close and costs the learner a
        # whole turn of audio in silence. A text chat synthesizes nothing.
        if not self._is_text_chat:
            self._register_tts_error_fallback()

        # Conversation handler (register on session)
        conversation_handler, state_handlers, cleanup_conversation_handler = (
            create_conversation_handler(
                self.ctx.room.name,
                self.joined_iso,
                background_tasks=self._background_tasks,
            )
        )
        self.session.on("conversation_item_added")(conversation_handler)

        # Live supervisor notes: a second, cheap LLM watching the same committed
        # turns, which occasionally sends the learner a coaching hint shown in
        # the session sidebar. Opt-in per simulation and entirely off the voice
        # path — see app/core/supervisor/service.py.
        self._setup_supervisor_notes()

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
                    # transcription_delay = time to obtain the transcript after
                    # end of user speech, i.e. pure STT finalization time,
                    # isolated from VAD-wait/EOU-decision (which eou_delay_ms
                    # bundles together). Key lever for regional-language latency.
                    stt_delay = getattr(metric, "transcription_delay", None)
                    if stt_delay is not None and stt_delay >= 0:
                        turn_metrics.record(
                            metrics_room_name, stt_finalize_ms=int(stt_delay * 1000)
                        )
                elif metric_cls == "LLMMetrics":
                    ttft = getattr(metric, "ttft", None)
                    if ttft is not None and ttft >= 0:
                        turn_metrics.record(
                            metrics_room_name, llm_ttft_ms=int(ttft * 1000)
                        )
                        # Same number the filler's gap predictor learns from: how
                        # long this session's model actually takes to first token.
                        self._observe_reply_latency(llm_ttft_ms=ttft * 1000)
                elif metric_cls == "TTSMetrics":
                    ttfb = getattr(metric, "ttfb", None)
                    if ttfb is not None and ttfb >= 0:
                        turn_metrics.record(
                            metrics_room_name, tts_ttfb_ms=int(ttfb * 1000)
                        )
                        self._observe_reply_latency(tts_ttfb_ms=ttfb * 1000)
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

        # Session-memory context forwarded to finalize_session by both the
        # connection-state and shutdown handlers (the finalize guard ensures
        # only one of them actually emits).
        _memory_language_code = (
            self.scenario.language_config.language_code
            if getattr(self.scenario, "language_config", None)
            else None
        )
        _memory_prompt_data = getattr(self.scenario, "prompt_data", None)

        # Loop-free fallback delivery of the SAME payload, for the one path
        # that cannot use finalize_session: the stall watchdog's os._exit.
        # Built here (not in the watchdog) so it shares the exact sources
        # finalize_session reads — ScoreKeeper and the RollingSummaryStore.
        try:
            from app.core.emergency_finalize import EmergencyFinalizer

            self._emergency_finalizer = EmergencyFinalizer(
                room_id=self.ctx.room.name,
                thread_id=self.ctx.room.name,
                score_keeper=self.score_keeper,
                rolling_summary_store=self.rolling_summary_store,
                client_working_memory_store=self.client_working_memory_store,
                language_code=_memory_language_code,
            )
        except Exception:  # noqa: BLE001 - never break session setup over this
            logger.exception(
                "[EMERGENCY-FINALIZE] could not build finalizer; a wedged "
                "session would lose its score"
            )
            self._emergency_finalizer = None

        # Shared single-slot ref so the shutdown handler can DRAIN the
        # finalize task the connection-state handler spawns on disconnect
        # (instead of cleanup cancelling it mid-LLM-call — which silently
        # dropped session memory for short sessions).
        self._finalize_task_ref: list = []

        # Connection state handler
        connection_handler = create_connection_state_handler(
            event_orchestrator=self.event_orchestrator,
            room_name=self.ctx.room.name,
            final_score_sent_ref=lambda: self.final_score_sent,
            set_final_score_sent=lambda val: setattr(self, "final_score_sent", val),
            background_tasks=self._background_tasks,
            score_keeper=self.score_keeper,
            llm_client=self.llm_client,
            language_code=_memory_language_code,
            prompt_data=_memory_prompt_data,
            rolling_summary_store=self.rolling_summary_store,
            client_working_memory_store=self.client_working_memory_store,
            finalize_task_ref=self._finalize_task_ref,
        )

        @self.ctx.room.on("connection_state_changed")
        def on_connection_state_changed(state: rtc.ConnectionState):
            connection_handler(state)
            self._handle_reconnection_state(state)
            # Signal room disconnection to entrypoint to allow graceful exit
            if state == rtc.ConnectionState.CONN_DISCONNECTED:
                if self._room_disconnected_event:
                    self._room_disconnected_event.set()
                    logger.info("Room disconnected event signaled to entrypoint")

        # The agent's own connection to LiveKit can stay healthy after the
        # human leaves — the bot (and any commissioned avatar) is still a
        # participant, so the room never goes empty and
        # connection_state_changed never fires CONN_DISCONNECTED. Without
        # this, a learner who clicks "Leave" mid-session leaves the job (and
        # the backend's session record) running until a scenario TIME/SCORE
        # termination or max_duration_exceeded eventually closes it — during
        # which "start afresh" reconnects to this same still-ACTIVE session.
        # React the moment the room empties of humans, the same way
        # _arm_orphan_deadline reacts when no human ever joins.
        @self.ctx.room.on("participant_disconnected")
        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            self._shutdown_if_room_emptied_of_humans(participant)

        # Pause/resume control channel: the client publishes reliable data
        # packets ({"type": "pause"|"resume"}). The handler is sync (LiveKit
        # requirement) so it schedules the async work as a tracked task.
        @self.ctx.room.on("data_received")
        def on_control_data(packet: rtc.DataPacket):
            self._handle_control_packet(packet)

        # Shutdown handler
        async def _cleanup_background_tasks_bounded():
            # cleanup_background_tasks() cancels every tracked task then
            # gathers them — normally near-instant, but a task that swallows
            # CancelledError (e.g. stuck inside a shielded network call) can
            # hang the gather indefinitely. Capped so that alone can't blow
            # the shutdown budget; the tasks were already cancel()-requested,
            # so giving up on the wait here is safe.
            try:
                await asyncio.wait_for(
                    cleanup_background_tasks(self._background_tasks),
                    timeout=BACKGROUND_TASKS_CLEANUP_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "cleanup_background_tasks did not finish within %ss; "
                    "some background tasks may still be running as the "
                    "process exits",
                    BACKGROUND_TASKS_CLEANUP_TIMEOUT,
                )

        original_shutdown_handler = create_shutdown_handler(
            event_orchestrator=self.event_orchestrator,
            room_name=self.ctx.room.name,
            final_score_sent_ref=lambda: self.final_score_sent,
            set_final_score_sent=lambda val: setattr(self, "final_score_sent", val),
            cleanup_background_tasks=_cleanup_background_tasks_bounded,
            score_keeper=self.score_keeper,
            llm_client=self.llm_client,
            language_code=_memory_language_code,
            prompt_data=_memory_prompt_data,
            rolling_summary_store=self.rolling_summary_store,
            client_working_memory_store=self.client_working_memory_store,
            finalize_task_ref=self._finalize_task_ref,
        )

        # Wrap shutdown handler to include conversation handler cleanup
        async def shutdown_with_cleanup():
            # Stop the stall watchdog first so a clean shutdown cancels its
            # force-exit escalation.
            if self._stall_watchdog is not None:
                try:
                    self._stall_watchdog.stop()
                except Exception:  # noqa: BLE001
                    pass
            try:
                self._cleanup_conversation_handler()
            except Exception as e:
                logger.debug(f"Error cleaning up conversation handler: {e}")
            # Drop any in-flight turn-metrics state for this room.
            turn_metrics.discard(self.ctx.room.name)
            # Cancel any in-flight working-memory update. The record dies with
            # this worker instance; a detached update would not.
            try:
                self.client_working_memory_store.discard()
            except Exception as e:  # noqa: BLE001 - teardown must not raise
                logger.debug(f"Error discarding working-memory store: {e}")
            # Stop the predictive-filler job before deleting clips so it can't
            # swap in a new generation after cleanup (it's still awaited by
            # cleanup_background_tasks in the wrapped shutdown handler).
            if self._predictor_task is not None and not self._predictor_task.done():
                self._predictor_task.cancel()
            # Stop the back-channel loop so it can't emit after teardown.
            if self._backchannel_task is not None and not self._backchannel_task.done():
                self._backchannel_task.cancel()
            self._backchannel_task = None
            # Stop interim generation so it can't run after teardown.
            if self._interim_gen_task is not None and not self._interim_gen_task.done():
                self._interim_gen_task.cancel()
            self._interim_gen_task = None
            # Cancel any supervisor note still being generated — the learner is
            # gone, so it has nowhere to land. Notes already sent are persisted.
            if getattr(self, "_supervisor_notes", None) is not None:
                try:
                    await asyncio.wait_for(
                        self._supervisor_notes.aclose(),
                        timeout=SUPERVISOR_NOTES_CLOSE_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "Supervisor notes aclose() did not finish within %ss; "
                        "continuing shutdown",
                        SUPERVISOR_NOTES_CLOSE_TIMEOUT,
                    )
                except Exception as e:  # noqa: BLE001
                    logger.debug(f"Error closing supervisor notes: {e}")
                self._supervisor_notes = None
            # Tear down the background-audio track (comfort tone + filler +
            # back-channel).
            if self._bg_audio is not None:
                try:
                    await asyncio.wait_for(
                        self._bg_audio.aclose(), timeout=BG_AUDIO_CLOSE_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "BackgroundAudioPlayer aclose() did not finish within "
                        "%ss; continuing shutdown",
                        BG_AUDIO_CLOSE_TIMEOUT,
                    )
                except Exception as e:  # noqa: BLE001
                    logger.debug(f"Error closing BackgroundAudioPlayer: {e}")
                self._bg_audio = None
            # Stop a deferred attach that is still waiting on its vendor, so it
            # cannot swap the session's audio onto an avatar during teardown.
            # The handle it registered before dialling out is already in
            # _video_actor, so cancelling here does not orphan the vendor
            # conversation — the close below still ends it.
            if self._video_actor_task is not None and not self._video_actor_task.done():
                self._video_actor_task.cancel()
            self._video_actor_task = None
            # Tear down the video actor's tracks. aclose() swallows its own
            # errors, so this cannot stall or fail a shutdown that is already
            # under a deadline.
            if getattr(self, "_video_actor", None) is not None:
                try:
                    await asyncio.wait_for(
                        self._video_actor.aclose(), timeout=VIDEO_ACTOR_CLOSE_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "Video actor aclose() did not finish within %ss; "
                        "continuing shutdown",
                        VIDEO_ACTOR_CLOSE_TIMEOUT,
                    )
                except Exception as e:  # noqa: BLE001
                    logger.debug(f"Error closing video actor: {e}")
                self._video_actor = None
            # Filler / back-channel / interim clips are in-memory frames, so
            # there are no temp files to delete — dropping the references is the
            # whole of the cleanup. Log what the layer cost first.
            self._log_filler_session_stats()
            if self._opener_player is not None:
                logger.info(
                    "[OPENER] session totals: %s plans=%d",
                    {
                        k: v
                        for k, v in self._opener_player.stats.items()
                        if isinstance(v, int)
                    },
                    self.turn_delivery.plans_received,
                )
                self._opener_player.shutdown()
                self._opener_player = None
            self.turn_delivery.active = False
            self._filler_pool = None
            self._backchannel_clips = []
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

    def _register_tts_error_fallback(self) -> None:
        """Recover the learner's turn when synthesis fails but the reply text
        survives.

        LiveKit tees the reply's text stream into two independent consumers: one
        synthesizes audio, the other accumulates the transcript and commits it
        to the chat context unconditionally. The synthesis task is awaited via
        ``wait_if_not_interrupted`` — an ``asyncio.gather(...,
        return_exceptions=True)`` whose results are never inspected — so once
        the plugin's own retries are exhausted the failure is swallowed and the
        transcript still commits. ``AgentSession._on_error`` closes the session
        only after FOUR consecutive unrecoverable TTS errors, and resets that
        count the next time the agent reaches "speaking".

        Net effect, and exactly what was reported from a course roleplay: the
        actor goes silent for one turn, its dialogue is in the transcript
        anyway, the session carries on, and nothing surfaces beyond a log line.
        The ``session.on("close")`` handler above covers the four-in-a-row case;
        this covers the isolated one it cannot see.

        We cannot re-speak the lost line — ``TTSError`` carries only a label and
        the exception, never the text — so the learner gets the same treatment
        as an LLM timeout: a short spoken line inviting them to say it again,
        which is both an audible "still here" and the thing that drives a fresh
        turn (and a fresh synthesis attempt). The client additionally gets a
        NON-fatal session-fault so it need not present a degraded call as
        healthy, mirroring the opening-statement stall path.
        """
        tts_instance = self._session_tts_instance
        if tts_instance is None or not hasattr(tts_instance, "on"):
            logger.warning(
                "[TTS] no TTS instance to watch for synthesis errors — a lost "
                "turn would be silent (room=%s)",
                getattr(self.ctx.room, "name", "?"),
            )
            return

        def _on_tts_error(error) -> None:
            try:
                # Recoverable errors are the plugin's own retry loop talking;
                # the audio still lands, so reacting would be noise.
                if getattr(error, "recoverable", True):
                    return
                logger.error(
                    "[TTS] unrecoverable synthesis error (label=%s, room=%s) — "
                    "this turn's audio is LOST though its text still reaches "
                    "the transcript; speaking a recovery line. Session stays "
                    "open (the close handler owns repeated failures).",
                    getattr(error, "label", "?"),
                    getattr(self.ctx.room, "name", "?"),
                    exc_info=getattr(error, "error", None),
                )
                self._schedule_tts_failure_recovery()
            except Exception:  # noqa: BLE001 - never break TTS error handling
                logger.exception("[TTS] error handler failed")

        tts_instance.on("error", _on_tts_error)

    def _schedule_tts_failure_recovery(self) -> None:
        """Throttle, then schedule the spoken recovery (the handler is sync)."""
        now = time.monotonic()
        last = self._last_tts_fallback_at
        if last is not None and (now - last) < TTS_FAILURE_FALLBACK_COOLDOWN_S:
            logger.warning(
                "[TTS] recovery line suppressed — another synthesis failure "
                "within %.0fs (room=%s)",
                TTS_FAILURE_FALLBACK_COOLDOWN_S,
                getattr(self.ctx.room, "name", "?"),
            )
            return
        self._last_tts_fallback_at = now
        task = asyncio.create_task(self._speak_tts_failure_recovery())
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def _speak_tts_failure_recovery(self) -> None:
        """Speak the recovery line, then tell the client the session is degraded.

        Speaking first: it is the part the learner experiences, and say() only
        enqueues (the failed speech handle is already unwinding, so this plays
        straight after it). The signal is informational and must not delay it.
        """
        session = self.session
        if session is not None:
            try:
                lang_config = getattr(
                    getattr(self, "scenario", None), "language_config", None
                )
                language_code = (
                    lang_config.language_code if lang_config is not None else None
                )
                line = tts_failure_fallback_line(language_code)
                # Interruptible: the learner may already be talking into the
                # silence, and they must be able to talk over this.
                session.say(line, allow_interruptions=True)
                logger.info(
                    "[TTS] spoke synthesis-failure recovery line (language=%s, "
                    "room=%s)",
                    language_code or DEFAULT_LANGUAGE_CODE,
                    getattr(self.ctx.room, "name", "?"),
                )
            except Exception as e:  # noqa: BLE001 - a lost turn is not fatal
                # Typically "AgentSession is closing, cannot use say()" (the
                # close handler is taking over) or the same broken TTS again.
                logger.warning("[TTS] recovery line could not be spoken: %s", e)
        try:
            await asyncio.wait_for(
                self._publish_session_fault("tts_synthesis_failed", fatal=False),
                timeout=2.0,
            )
        except Exception:  # noqa: BLE001 - includes TimeoutError
            logger.debug("[TTS] could not signal the synthesis failure to client")

    async def _attach_video_actor(self, livekit_url: Optional[str]) -> None:
        """Bring the video actor up while the session is already talking.

        Runs as a background task so nothing about it is on the startup path.
        The learner hears the character on the agent's own audio track from the
        first word; the speech moves onto the avatar only once its video is
        verified live, and stays where it is if the vendor never renders.

        See app/core/livekit/video_actor.py for why the swap is safe and why the
        vendor's own output has to be taken back the instant its start()
        returns.
        """

        def _hold(handle) -> None:
            # Registered before the avatar is verified, so a learner who leaves
            # mid-render still gets the vendor conversation ended by shutdown.
            # The handle says publishes_audio=False until the swap commits.
            self._video_actor = handle

        try:
            handle = await attach_video_actor(
                session=self.session,
                room=self.ctx.room,
                scenario=self.scenario,
                # The URL this job's room actually lives on, not the one the
                # worker registered with. Same distinction the Krisp gate draws.
                livekit_url=livekit_url,
                on_vendor_session=_hold,
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - a live session must not care
            logger.warning(f"[AgentWorker] Video actor attach failed: {e}")
            return

        if handle is None:
            # attach_video_actor has already logged why and torn the vendor
            # down. self._video_actor may still hold the closed handle; its
            # aclose() is idempotent, so shutdown is unaffected.
            return
        self._video_actor = handle
        # The transport just changed under the metrics. Every turn from here
        # measures latency to the moment audio is handed to the VENDOR rather
        # than to the moment it is audible, so the rows have to say so.
        self._note_speech_transport()

    async def _arm_orphan_deadline(self, timeout: float = 30.0) -> None:
        """Shut down if no human participant joins within `timeout` seconds
        of the agent joining.

        Prevents a proactively dispatched agent from burning resources indefinitely
        when the user closes the tab after room creation but before connecting.
        """
        await asyncio.sleep(timeout)
        # Count PEOPLE, not participants. A hosted video actor joins the room
        # as its own participant, so a bare remote_participants check would
        # read the avatar we commissioned as company and leave an abandoned
        # session running — holding a worker slot and a metered vendor
        # conversation open until the max-duration cap. See
        # app/core/livekit/video_actor.py.
        if not human_participants(self.ctx.room):
            logger.warning(
                "[AgentWorker] No human participant joined within %.0fs — "
                "orphaned agent, shutting down.",
                timeout,
            )
            self.ctx.shutdown("orphaned_no_human")

    def _shutdown_if_room_emptied_of_humans(
        self, participant: "rtc.RemoteParticipant"
    ) -> None:
        """Room callback for "participant_disconnected": if that was the
        last human in the room, end the session now.

        Without this, a learner who leaves mid-session (e.g. the "Leave"
        confirmation) leaves the job running — the bot (and any commissioned
        avatar) is still a participant, so the room never empties and
        connection_state_changed never fires CONN_DISCONNECTED — until a
        scenario TIME/SCORE termination or max_duration_exceeded eventually
        closes it. Until then the backend's session record stays ACTIVE, so
        starting afresh reconnects to this same session instead of a new one.
        """
        if human_participants(self.ctx.room):
            return
        logger.info(
            "[AgentWorker] Last human participant (%s) left the room — "
            "shutting down so the session finalizes instead of staying "
            "ACTIVE.",
            getattr(participant, "identity", None),
        )
        self.ctx.shutdown("human_left_session")

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
        # Humans only, for the same reason as the orphan deadline above.
        if not human_participants(self.ctx.room):
            logger.warning("[PAUSE] Ignored — no remote participant in room")
            return
        # Defense-in-depth: pause is opt-in per scenario. Ignore the packet
        # unless pause is explicitly enabled, even if a stale or tampered
        # client sends one. Only an explicit True enables (missing/False → off).
        if getattr(self.scenario, "pause_enabled", None) is not True:
            logger.warning("[PAUSE] Ignored — pause not enabled for this scenario")
            return
        # Pause gates audio I/O, which a text chat does not have; the chat
        # client offers no pause control, so a packet here is stale or forged.
        if self._is_text_chat:
            logger.warning("[PAUSE] Ignored — text-chat session has no pause")
            return

        logger.info("[PAUSE] Pausing simulation")
        # Freeze the clock first so any concurrent graph turn sees paused state.
        clock.pause()

        # Suspend the stall watchdog — nothing is owed while paused.
        if self._stall_watchdog is not None:
            self._stall_watchdog.suspend()

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

        # Opportunistic episodic-memory compaction: the pause is free time
        # (no turn in flight, nobody waiting on a reply), so fold everything
        # beyond the verbatim tail into the rolling summary now. ADDITIVE to
        # the per-turn cadence compaction — never a replacement for it.
        try:
            from app.core.graph.rolling_summary import maybe_compact_on_pause

            maybe_compact_on_pause(
                thread_id=self.ctx.room.name,
                store=getattr(self, "rolling_summary_store", None),
                llm_client=getattr(self, "llm_client", None),
                prompt_data=getattr(self.scenario, "prompt_data", None),
            )
        except Exception:  # noqa: BLE001 - memory must never break a pause
            logger.exception("[PAUSE] pause-compaction scheduling failed")

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

    def _handle_reconnection_state(self, state: "rtc.ConnectionState") -> None:
        """App-level handling for a transient LiveKit reconnect (CONN_RECONNECTING).

        Previously only CONN_DISCONNECTED was handled, so a blip the SDK was
        actively retrying got no handling at all. Two things happen here:

        1. **The stall watchdog is suspended.** This is the substantive fix. The
           watchdog arms on a finalized learner turn and force-exits the job if
           no agent response follows within SESSION_STALL_THRESHOLD_S. During a
           reconnect the agent legitimately cannot respond, so a reconnect
           lasting longer than the threshold would have killed a session that
           was about to recover — turning a recoverable blip into a lost
           session. Suspending only clears the "response owed" debt; the next
           learner turn re-arms it, so the watchdog is not weakened.
        2. **The client is told**, so it can show a recovering state instead of
           a live-looking mute call. Best-effort — see CTRL_CONNECTION_STATE for
           why the "reconnecting" edge may not arrive and the "connected" one is
           the reliable signal.
        """
        try:
            reconnecting = getattr(rtc.ConnectionState, "CONN_RECONNECTING", None)
            connected = getattr(rtc.ConnectionState, "CONN_CONNECTED", None)
            if reconnecting is not None and state == reconnecting:
                logger.warning(
                    "[CONN] LiveKit connection RECONNECTING (room=%s) — the SDK "
                    "is retrying; suspending the stall watchdog so a recoverable "
                    "blip is not treated as a wedged session",
                    self.ctx.room.name,
                )
                self._connection_recovering = True
                if self._stall_watchdog is not None:
                    self._stall_watchdog.suspend()
                self._schedule_connection_state_signal(CONN_STATE_RECONNECTING)
            elif connected is not None and state == connected:
                # Only announce recovery if we actually reported a problem, so
                # the initial connect does not emit a spurious "recovered".
                if getattr(self, "_connection_recovering", False):
                    logger.info(
                        "[CONN] LiveKit connection RECOVERED (room=%s)",
                        self.ctx.room.name,
                    )
                    self._connection_recovering = False
                    self._schedule_connection_state_signal(CONN_STATE_CONNECTED)
        except Exception:  # noqa: BLE001 - a state hook must never break a session
            logger.exception("[CONN] reconnection-state handling failed")

    def _schedule_connection_state_signal(self, conn_state: str) -> None:
        """Publish a connection-state packet from a sync LiveKit handler."""
        try:
            task = asyncio.create_task(
                self._publish_control(
                    {"type": CTRL_CONNECTION_STATE, "state": conn_state}
                )
            )
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)
        except Exception:  # noqa: BLE001
            logger.debug("[CONN] could not schedule %s signal", conn_state)

    async def _publish_session_fault(self, reason: str, *, fatal: bool) -> None:
        """Tell the client a technical fault happened (see CTRL_SESSION_FAULT).

        Best-effort by design: the faults this covers are exactly the ones that
        may also have broken the transport. A failed publish must never stop the
        teardown that follows it.
        """
        await self._publish_control(
            {"type": CTRL_SESSION_FAULT, "reason": reason, "fatal": bool(fatal)}
        )

    async def _fault_then_shutdown(self, reason: str) -> None:
        """Announce a fatal fault to the client, then shut the job down.

        Ordering matters: ctx.shutdown tears the room down, so a packet
        published after it never reaches the learner (the pre-existing
        `cap-ended` path has this same race). Publishing first, under a short
        timeout, gives the signal a chance to land without letting a wedged
        transport delay the teardown.
        """
        try:
            await asyncio.wait_for(
                self._publish_session_fault(reason, fatal=True), timeout=2.0
            )
        except Exception:  # noqa: BLE001 - includes TimeoutError
            logger.warning(
                "[SESSION] could not deliver session-fault signal (%s) before "
                "shutdown",
                reason,
            )
        try:
            self.ctx.shutdown(reason)
        except Exception:  # noqa: BLE001
            logger.exception("[SESSION] shutdown(%s) failed", reason)

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

    async def _resolve_comfort_audio(self):
        """Build the comfort-audio ambient source, or None when disabled.

        Returns a LiveKit ``AudioConfig`` wrapping an INFINITE in-memory ambient
        iterator (played as the BackgroundAudioPlayer ambient sound), or ``None``
        when comfort audio is off or synthesis fails. The source is either a
        superadmin-uploaded track (per-sim ``comfort_audio_url``, fetched +
        decoded into memory) or, when no track is set / the fetch fails, the
        synthesized room tone. In-memory (not a temp WAV) on purpose: a
        file-backed ambient re-opens/decodes the clip every loop, and if that
        stalls past the mixer's per-stream timeout (e.g. while a thinking-filler
        is also decoding) the mixer cancels + closes the ambient generator and
        drops it for good — comfort would then stop the first time a filler
        plays. An in-memory loop yields instantly and can't be dropped.

        Volume is the per-sim ``comfort_audio_volume`` when set, else the global
        ``COMFORT_AUDIO_VOLUME`` default. Async because the uploaded-track fetch
        is network I/O — it is bounded by a timeout so it never delays the
        opening statement. Best-effort: never raises.
        """
        try:
            from app.core.livekit.comfort_audio import (
                comfort_ambient_source,
                fetch_and_decode_comfort_source,
                is_comfort_audio_enabled,
            )

            _pd = getattr(self.scenario, "prompt_data", None)

            if not is_comfort_audio_enabled(self.scenario):
                logger.info(
                    "[COMFORT] disabled (global_enabled=%s comfort_audio_enabled=%s)",
                    getattr(settings, "COMFORT_AUDIO_ENABLED", None),
                    getattr(_pd, "comfort_audio_enabled", None),
                )
                return None

            url = getattr(_pd, "comfort_audio_url", None)
            source = None
            if url:
                timeout_s = float(
                    getattr(settings, "COMFORT_AUDIO_FETCH_TIMEOUT_S", 4.0)
                )
                max_bytes = int(
                    getattr(settings, "COMFORT_AUDIO_MAX_BYTES", 20 * 1024 * 1024)
                )
                try:
                    source = await asyncio.wait_for(
                        fetch_and_decode_comfort_source(
                            url, timeout_s=timeout_s, max_bytes=max_bytes
                        ),
                        timeout=timeout_s + 1.0,
                    )
                except Exception as e:  # noqa: BLE001 - fall back on any failure
                    logger.warning(
                        "[COMFORT] uploaded track unavailable, "
                        "falling back to tone: %s",
                        e,
                    )
                    source = None

            used_upload = source is not None
            if source is None:
                source = comfort_ambient_source()
            if source is None:
                return None

            from livekit.agents import AudioConfig

            vol = getattr(_pd, "comfort_audio_volume", None)
            volume = (
                float(vol)
                if vol is not None
                else float(getattr(settings, "COMFORT_AUDIO_VOLUME", 0.15))
            )
            volume = max(0.0, min(1.0, volume))
            logger.info(
                "[COMFORT] room tone enabled "
                "(volume=%.2f, in-memory loop, uploaded=%s)",
                volume,
                used_upload,
            )
            return AudioConfig(source, volume=volume)
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[COMFORT] setup failed (continuing without): %s", e)
            return None

    async def _setup_background_audio(self) -> None:
        """Publish the shared background-audio track (comfort + filler + back-channel).

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

        LATENCY: this runs on the session-start critical path, BEFORE the opening
        statement, so it only does cheap work here — resolve the in-memory comfort
        tone, decide (via pure flag checks, no LLM/TTS) whether any layer could
        play, and publish the track. The expensive per-layer synthesis (the
        back-channel LLM call + all filler/back-channel TTS) is moved off the
        opening path into _setup_deferred_naturalness(), spawned as a background
        task — those clips aren't needed until later turns (the filler is
        delay-gated; the back-channel needs BACKCHANNEL_MIN_UTTERANCE_MS into a
        learner turn), so synthesizing them here would only delay the opening.

        The player is created when ANY layer COULD play. Fully best-effort: any
        failure leaves the session running without background audio.
        """
        try:
            from app.core.livekit.backchannel import is_backchannel_enabled
            from app.core.livekit.filler_clips import clip_tts_available
            from app.core.livekit.fillers import is_filler_enabled
            from app.core.livekit.interim_reply import is_interim_reply_enabled

            # ---- Comfort audio (ambient room tone) ---- cheap, in-memory PCM.
            comfort_source = await self._resolve_comfort_audio()

            # Pure flag checks (no LLM/TTS): decide whether each layer COULD play,
            # so we can publish the track now and defer the actual synthesis.
            # Filler, back-channel and interim are all heard only as clips, so
            # a voice that renders none (generative, or not isolatable) turns
            # all three off here — before their LLM calls, not after them.
            predictive_on = bool(getattr(settings, "PREDICTIVE_FILLER_ENABLED", False))
            self._clip_tts_on = clip_tts_available(self.tts_client)
            filler_possible = self._clip_tts_on and is_filler_enabled(self.scenario)
            backchannel_possible = self._clip_tts_on and is_backchannel_enabled(
                self.scenario
            )
            from app.core.graph.prompt import prompt_declares_client_working_memory

            _prompt_data = getattr(self.scenario, "prompt_data", None)
            # Working-memory scenarios get their interim from the updater; the
            # generator is for the rest. One interim source per session.
            self._interim_enabled = (
                self._clip_tts_on
                and is_interim_reply_enabled(self.scenario)
                and self._delivery_mode()
                and not (
                    _prompt_data is not None
                    and prompt_declares_client_working_memory(_prompt_data)
                )
            )
            # A voice that renders no clips (Gemini-TTS, Hume and other
            # generative voices the clip policy refuses) can still take the
            # bundled breath and sigh openers: they are recordings, not a second
            # generation of the voice. Without masking, eleven_v3 sessions were
            # reply-first at p50 ~5s in prod (2026-09-29..10-01) before v3 was
            # allowed clips on its own model and settings.
            self._asset_openers_only = (
                not self._clip_tts_on
                and is_filler_enabled(self.scenario)
                and self._delivery_mode()
                and self._has_asset_openers()
            )
            # The generator's line is played by the OpenerPlayer, as the one
            # interim of the turn — never chained after a filler as a second
            # holding sentence (the "hum → pause → sentence → reply" pattern
            # learners found scripted).

            # Nothing to play on any layer — don't publish a track.
            if (
                comfort_source is None
                and not filler_possible
                and not backchannel_possible
                and not self._interim_enabled
                and not self._asset_openers_only
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
                "(comfort=%s clip_tts=%s filler_possible=%s predictive=%s "
                "backchannel_possible=%s interim=%s)",
                comfort_source is not None,
                self._clip_tts_on,
                filler_possible,
                predictive_on,
                backchannel_possible,
                self._interim_enabled,
            )
            if self._asset_openers_only:
                logger.info("[OPENER] clip-less voice: breath/sigh openers only")
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[BG_AUDIO] setup failed (continuing without): %s", e)
            self._bg_audio = None
            return

        # Comfort tone only: nothing below would produce a clip.
        if not self._clip_tts_on and not self._asset_openers_only:
            return

        # Defer the expensive per-layer work (back-channel LLM call + filler/
        # back-channel TTS synthesis + interim client build + handler wiring) off
        # the opening-statement critical path. Tracked so it's cancelled on
        # shutdown. Best-effort inside the task — never awaited here.
        deferred_task = asyncio.create_task(self._setup_deferred_naturalness())
        self._background_tasks.add(deferred_task)
        deferred_task.add_done_callback(self._background_tasks.discard)

    def _setup_supervisor_notes(self) -> None:
        """Wire the live-supervisor LLM to committed learner turns.

        Opt-in per simulation (Studio: supervisorNotesEnabled) behind a global
        kill-switch, so this is a no-op for almost every session. Cheap enough
        to build inline — one LLM client, no network — and the handler it
        registers only ever schedules detached work, so nothing here or
        downstream can add latency to a reply. Best-effort: a failure leaves the
        session running without notes rather than not running.
        """
        self._supervisor_notes = None
        try:
            from app.core.constants import DEFAULT_LANGUAGE_CODE
            from app.core.events.handlers import extract_content
            from app.core.supervisor import (
                SupervisorNotesService,
                is_supervisor_notes_enabled,
            )
            from app.llms.factory import create_llm_client

            if not is_supervisor_notes_enabled(self.scenario):
                return

            prompt_data = getattr(self.scenario, "prompt_data", None)
            language_code = (
                self.scenario.language_config.language_code
                if getattr(self.scenario, "language_config", None)
                else None
            )
            # The human-readable name ("Tamil (India)") is a far stronger signal
            # to the model than the bare BCP-47 code; fall back to the code, and
            # then to a description, so the note is never written in the wrong
            # language just because the label is missing.
            language_label = (
                getattr(prompt_data, "language_label", None)
                or language_code
                or "the language the learner is speaking"
            )

            supervisor_llm = create_llm_client(
                llm_config={
                    "provider": settings.SUPERVISOR_NOTES_PROVIDER,
                    "config": {
                        "model": settings.SUPERVISOR_NOTES_MODEL,
                        "temperature": 0,
                    },
                },
                language_code=language_code or DEFAULT_LANGUAGE_CODE,
            )

            self._supervisor_notes = SupervisorNotesService(
                self.ctx.room,
                supervisor_llm,
                room_id=self.ctx.room.name,
                language_label=language_label,
                language_code=language_code,
                scenario_id=getattr(self.scenario, "id", None),
                prompt_data=prompt_data,
                # The clock is the single source of truth for paused-ness, and
                # it is what the pause control channel flips.
                is_paused=lambda: bool(getattr(self.session_clock, "is_paused", False)),
            )

            supervisor = self._supervisor_notes
            # Learner turns only. Counted here rather than reusing the metrics
            # turn index so the min-gap between notes is measured in the thing it
            # is about — how many times the learner has spoken.
            learner_turns = [0]

            @self.session.on("conversation_item_added")
            def _on_item_for_supervisor(event):
                try:
                    role = getattr(getattr(event, "item", None), "role", None)
                    text = extract_content(event.item)
                    if role == "assistant":
                        supervisor.record_turn("client", text)
                        return
                    supervisor.record_turn("learner", text)
                    if not (text or "").strip():
                        return
                    learner_turns[0] += 1
                    supervisor.on_learner_turn_committed(learner_turns[0])
                except Exception:  # noqa: BLE001 - never break a turn
                    logger.exception("[supervisor] item handler failed")

            logger.info(
                "[supervisor] live notes enabled (model=%s, max=%d, min_gap=%d, "
                "timeout=%.1fs, language=%s)",
                settings.SUPERVISOR_NOTES_MODEL,
                settings.SUPERVISOR_NOTES_MAX_PER_SESSION,
                settings.SUPERVISOR_NOTES_MIN_TURN_GAP,
                settings.SUPERVISOR_NOTES_TIMEOUT_S,
                language_label,
            )
        except Exception:  # noqa: BLE001 - a session must start without notes
            self._supervisor_notes = None
            # Enabled-but-inert: the toggle was on, the tab renders, and nothing
            # else distinguishes this from a healthy quiet session — without
            # room/scenario context here, finding this in logs means already
            # knowing which worker process to look at.
            logger.exception(
                "[supervisor] room=%s scenario=%s setup failed — session "
                "continues silently, no live notes this session",
                self.ctx.room.name,
                getattr(self.scenario, "id", None),
            )

    async def _setup_deferred_naturalness(self) -> None:
        """Build the filler pool + back-channel clips and wire their handlers.

        Split out of _setup_background_audio and run as a background task so the
        LLM calls and TTS syntheses never delay the opening statement. The
        BackgroundAudioPlayer track is already published by the caller; this only
        fills in the clips and registers the handlers that drive them.

        Order matters for time-to-first-usable-clip: the STATIC Studio phrases
        (no LLM call, and usually already in the worker's clip cache) are
        rendered first so something is playable as early as possible, then the
        seed batch — generated from the character alone, with no conversation —
        makes context-free but in-character fillers available before the
        learner's first turn. Previously nothing was playable until an exchange
        had completed and a 10s timer had come round.

        Every playback handler guards on ``self._bg_audio`` / an empty pool, so a
        turn beginning before this finishes simply gets no filler. Best-effort:
        any failure leaves the session running with whatever did resolve.
        """
        if self._bg_audio is None or not (
            self._clip_tts_on or self._asset_openers_only
        ):
            return
        try:
            import time as _time

            from app.core.livekit.filler_clips import synthesize_clips
            from app.core.livekit.filler_pool import FillerPool
            from app.core.livekit.fillers import (
                is_filler_enabled,
                resolve_filler_phrases,
            )
            from app.core.livekit.gap_predictor import GapPredictor

            predictive_on = bool(getattr(settings, "PREDICTIVE_FILLER_ENABLED", False))
            started = _time.monotonic()

            # ---- Delivery-plan openers (replaces the filler path below) ----
            # Falls through to the legacy filler when nothing could be rendered,
            # so a delivery-layer failure degrades to the old behaviour rather
            # than to silence.
            if self._delivery_mode():
                await self._setup_opener_player()
            if not self._clip_tts_on:
                # Asset openers were the only layer this voice could take.
                return
            if self._opener_player is not None:
                if self._interim_enabled:
                    self._setup_interim_reply()
                backchannel_on = await self._resolve_backchannel_clips()
                if backchannel_on:
                    self.session.on("user_state_changed")(
                        self._on_backchannel_user_state
                    )
                    logger.info(
                        "[BACKCHANNEL] enabled (%d clip(s)) — driven off user-speaking",
                        len(self._backchannel_clips),
                    )
                return

            # ---- Thinking filler ----
            filler_on = False
            if is_filler_enabled(self.scenario):
                self._filler_pool = FillerPool(
                    max_clips=int(getattr(settings, "FILLER_POOL_MAX_CLIPS", 40)),
                    repeat_window_plays=int(
                        getattr(settings, "FILLER_REPEAT_WINDOW_PLAYS", 12)
                    ),
                )
                self._gap_predictor = GapPredictor(prior_ms=self._gap_prior_ms())
                language = self._filler_language()

                phrases = resolve_filler_phrases(self.scenario)
                if phrases:
                    clips = await synthesize_clips(
                        self.tts_client,
                        phrases,
                        language=language,
                        source="static",
                        **self._clip_usage(),
                    )
                    self._filler_stats["clips_synthesized"] += len(clips)
                    self._filler_pool.add(clips)
                    logger.info(
                        "[FILLER] %d static clip(s) ready from %d Studio phrase(s)",
                        len(clips),
                        len(phrases),
                    )

                if predictive_on:
                    self._setup_predictive_filler_llm_client()
                    if getattr(settings, "FILLER_SEED_ON_START", True):
                        await self._generate_fillers(source="seed")

                filler_on = len(self._filler_pool) > 0 or predictive_on
                if len(self._filler_pool):
                    self._filler_stats["first_clip_ready_s"] = round(
                        _time.monotonic() - started, 2
                    )
                if not filler_on:
                    logger.info(
                        "[FILLER] no static phrases and predictive disabled — no filler"
                    )

            # ---- Continuous back-channeling (listener affirmations) ----
            backchannel_on = await self._resolve_backchannel_clips()
            if backchannel_on:
                self.session.on("user_state_changed")(self._on_backchannel_user_state)
                logger.info(
                    "[BACKCHANNEL] enabled (%d clip(s)) — driven off user-speaking",
                    len(self._backchannel_clips),
                )

            if not filler_on:
                return

            self._filler_enabled = True
            self.session.on("agent_state_changed")(self._on_filler_agent_state)
            # In-turn generation and the (experimental) early trigger both hang
            # off the learner's own speech, not the agent's state.
            self.session.on("user_state_changed")(self._on_filler_user_state)
            if getattr(settings, "FILLER_IN_TURN_ENABLED", True) and predictive_on:
                self.session.on("user_input_transcribed")(
                    self._on_filler_input_transcribed
                )

            # Regenerate per exchange (when the character finishes speaking and
            # the pipeline is idle) instead of on a free-running timer, so the
            # call never overlaps the real reply's request and skips entirely
            # while the pool still holds unheard phrases.
            if predictive_on:
                self._predictor_task = asyncio.create_task(
                    self._predictive_filler_loop()
                )
                self._background_tasks.add(self._predictor_task)
                self._predictor_task.add_done_callback(self._background_tasks.discard)
                logger.info("[FILLER] exchange-driven regeneration armed")
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning(
                "[BG_AUDIO] deferred naturalness setup failed (continuing "
                "without): %s",
                e,
            )

    def _delivery_mode(self) -> bool:
        """Whether turn openers come from the delivery plan this session.

        Same scenario gate as the filler it replaces (Studio's fillerEnabled +
        the global kill-switch), plus the rollback flag. Clip availability is
        checked by the caller: no clips, no openers, no planner calls.
        """
        try:
            from app.core.livekit.fillers import is_filler_enabled
            from app.core.livekit.opener_catalog import catalog_available

            # catalog_available: a catalog that fails to load must fall back to
            # the legacy filler, never to a session with no opener at all.
            return (
                bool(getattr(settings, "DELIVERY_PLAN_ENABLED", True))
                and is_filler_enabled(self.scenario)
                and catalog_available()
            )
        except Exception:  # noqa: BLE001 - a gate must never break setup
            return False

    def _is_generative_elevenlabs(self) -> bool:
        model = str(getattr(self, "_tts_model", "") or "").lower()
        return "eleven" in model and ("v3" in model or "v4" in model)

    def _interim_tts_timeout_ms(self) -> float:
        """How long the interim's render may take for this voice."""
        if self._is_generative_elevenlabs():
            return float(settings.INTERIM_REPLY_TTS_TIMEOUT_GENERATIVE_MS)
        return float(getattr(settings, "INTERIM_REPLY_TTS_TIMEOUT_MS", 2500.0))

    def _gap_prior_ms(self) -> float:
        """The wait to assume before this session has measured its own.

        Per voice model, because the voice dominates it: an ElevenLabs v3
        voice's first audio byte alone is ~1.8 s.
        """
        if self._is_generative_elevenlabs():
            return float(settings.GAP_PRIOR_GENERATIVE_MS)
        return float(settings.FILLER_GAP_PRIOR_MS)

    def _has_asset_openers(self) -> bool:
        """Whether this session's catalog holds any bundled-audio opener."""
        try:
            from app.core.livekit.opener_catalog import build_session_catalog

            catalog = build_session_catalog(
                self._filler_language(), gender=self._voice_gender()
            )
            return any(e.is_asset for e in catalog.entries.values())
        except Exception:  # noqa: BLE001 - a gate must never break setup
            return False

    def _voice_gender(self) -> Optional[str]:
        """The character voice's gender, for gendered opener assets, or None.

        The VOICE's own gender first (it is what the breath has to match),
        then the persona's. Read defensively: an unknown gender only means the
        breath and sigh openers are left out.
        """
        from app.core.livekit.opener_catalog import normalize_gender

        scenario = self.scenario
        voice_config = getattr(getattr(scenario, "voice", None), "config", None)
        return normalize_gender(getattr(voice_config, "gender", None)) or (
            normalize_gender(
                getattr(getattr(scenario, "prompt_data", None), "gender", None)
            )
        )

    async def _setup_opener_player(self) -> None:
        """Build the session catalog, render it, and wire the opener handlers.

        Runs in the deferred naturalness task, so rendering never delays the
        opening statement. The catalog is fixed, so after the first session on
        a worker most renders are cache hits. Best-effort: with nothing
        rendered the session simply runs without openers.
        """
        import time as _time

        from app.core.livekit.filler_clips import synthesize_clips
        from app.core.livekit.fillers import resolve_filler_phrases
        from app.core.livekit.gap_predictor import GapPredictor
        from app.core.livekit.opener_catalog import build_session_catalog
        from app.core.livekit.opener_player import OpenerPlayer
        from app.core.livekit.opener_policy import OpenerPolicy, PolicyConfig

        started = _time.monotonic()
        self._gap_predictor = GapPredictor(prior_ms=self._gap_prior_ms())
        self.turn_delivery.catalog = build_session_catalog(
            self._filler_language(),
            studio_fillers=resolve_filler_phrases(self.scenario),
            gender=self._voice_gender(),
        )
        if not self._clip_tts_on:
            # Nothing spoken can render for this voice: keep the planner and
            # the policy to what can actually play.
            catalog = self.turn_delivery.catalog
            catalog.entries = {k: e for k, e in catalog.entries.items() if e.is_asset}
        policy = OpenerPolicy(
            PolicyConfig(
                min_gap_ms=float(getattr(settings, "FILLER_PREDICTED_GAP_MS", 700.0)),
                hold_min_ms=float(settings.OPENER_HOLD_MIN_MS),
                hold_max_ms=float(settings.OPENER_HOLD_MAX_MS),
                long_hold_min_ms=float(settings.OPENER_LONG_HOLD_MIN_MS),
                long_hold_max_ms=float(settings.OPENER_LONG_HOLD_MAX_MS),
                piece_gap_ms=float(settings.OPENER_PIECE_GAP_MS),
                piece_gap_growth=float(settings.OPENER_PIECE_GAP_GROWTH),
                tail_ms=float(settings.OPENER_TAIL_MS),
                max_pieces=int(settings.OPENER_MAX_INTERIM_PIECES),
                max_speech_share=float(settings.OPENER_MAX_SPEECH_SHARE),
                body_min_gap_turns=int(settings.OPENER_BODY_MIN_GAP_TURNS),
                pause_only_max_gap_ms=float(settings.OPENER_PAUSE_ONLY_MAX_GAP_MS),
                repeat_window=int(settings.OPENER_REPEAT_WINDOW),
            )
        )

        async def _synthesize(phrases, source):
            if not self._clip_tts_on:
                return []  # spoken interim pieces would be a second voice
            clips = await synthesize_clips(
                self.tts_client,
                phrases,
                language=self._filler_language(),
                source=source,
                # Interim pieces are written for one turn; caching them would
                # only evict fillers that do repeat.
                use_cache=source != "interim",
                **self._clip_usage(),
            )
            self._filler_stats["clips_synthesized"] += len(clips)
            return clips

        player = OpenerPlayer(
            room_name=self.ctx.room.name,
            turn_delivery=self.turn_delivery,
            policy=policy,
            bg_audio_getter=lambda: self._bg_audio,
            predicted_gap_ms=self._predicted_gap_ms,
            synthesize=_synthesize,
            emit_filler_transcript=self._emit_filler_transcript,
            emit_interim_transcript=self._emit_interim_transcript,
            voice_on_avatar=self._voice_on_avatar,
            observe_wait=self._observe_measured_wait,
        )
        playable = await player.render_catalog()
        if not playable:
            logger.info("[OPENER] no catalog entry rendered — no openers this session")
            return
        self._opener_player = player
        self._filler_stats["first_clip_ready_s"] = round(_time.monotonic() - started, 2)
        self.turn_delivery.on_plan(player.on_plan)
        self.session.on("agent_state_changed")(
            lambda ev: player.on_agent_state(
                getattr(ev, "new_state", None), getattr(ev, "created_at", None)
            )
        )
        self.session.on("user_state_changed")(
            lambda ev: player.on_user_state(getattr(ev, "new_state", None))
        )
        self.session.on("user_input_transcribed")(
            lambda ev: player.on_transcript(
                getattr(ev, "transcript", None), bool(getattr(ev, "is_final", False))
            )
        )
        self.turn_delivery.active = True
        from app.core.graph.prompt import prompt_declares_client_working_memory

        prompt_data = getattr(self.scenario, "prompt_data", None)
        uses_wm = prompt_data is not None and prompt_declares_client_working_memory(
            prompt_data
        )
        logger.info(
            "[OPENER] enabled: %d of %d catalog entries playable (language=%s, "
            "planner=%s)",
            playable,
            len(self.turn_delivery.catalog.entries),
            self.turn_delivery.catalog.language,
            # Without working memory there is no plan: fillers and pauses,
            # plus the interim generator's line when it is enabled.
            "working_memory" if uses_wm else "none",
        )

    def _log_filler_session_stats(self) -> None:
        """Log what the filler layer cost and delivered this session.

        One line, at shutdown, carrying the numbers that say whether the layer is
        working: how many LLM calls and TTS syntheses it actually made (versus
        the up-to-six-per-minute the old timer made), how well the shared clip
        cache served it, how many distinct phrases the learner heard, and how
        soon the first clip was ready. Without these the cost side of the feature
        is invisible — the per-turn metrics only describe playback.
        """
        try:
            stats = self._filler_stats
            if not stats.get("played") and not stats.get("llm_calls"):
                return
            from app.core.livekit.filler_clips import cache_stats

            cache = cache_stats()
            played = int(stats.get("played") or 0)
            distinct = len(stats.get("distinct_played") or ())
            logger.info(
                "[FILLER] session totals: played=%d (distinct=%d, continuations=%d) "
                "llm_calls=%d clips_synthesized=%d cache_hits=%d cache_misses=%d "
                "cache_size=%d first_clip_ready=%ss",
                played,
                distinct,
                int(stats.get("continuations") or 0),
                int(stats.get("llm_calls") or 0),
                int(stats.get("clips_synthesized") or 0),
                cache.get("hits", 0),
                cache.get("misses", 0),
                cache.get("size", 0),
                stats.get("first_clip_ready_s"),
            )
        except Exception:  # noqa: BLE001 - teardown must not raise
            pass

    def _observe_reply_latency(
        self,
        llm_ttft_ms: Optional[float] = None,
        tts_ttfb_ms: Optional[float] = None,
    ) -> None:
        """Teach the gap predictor from a component timing as it arrives.

        The two halves of one turn's wait arrive as separate LiveKit metrics
        events. They are PAIRED into one observation per turn: folding each in
        alone made the average converge on the mean of the two rather than their
        sum, which in prod predicted 0.39x the real gap and chose clips far too
        short for it (see GapPredictor.observe_llm_ttft).
        """
        predictor = self._gap_predictor
        if predictor is None:
            return
        try:
            if llm_ttft_ms is not None:
                predictor.observe_llm_ttft(llm_ttft_ms)
            if tts_ttfb_ms is not None:
                predictor.observe_tts_ttfb(tts_ttfb_ms)
        except Exception:  # noqa: BLE001 - prediction must never break a turn
            pass

    def _pick_backchannel_clip(self):
        """Pick a back-channel clip, avoiding the ones just used.

        Kept separate from the filler pool: back-channels are a different set of
        sounds for a different moment (listening, not thinking), and mixing the
        two would let a hesitation play while the learner is mid-sentence.
        """
        import random as _random

        clips = self._backchannel_clips
        if not clips:
            return None
        recent = set(self._recent_backchannel_phrases)
        candidates = [c for c in clips if c.phrase not in recent] or clips
        choice = _random.choice(candidates)
        max_remember = max(1, min(len(clips) - 1, 3))
        self._recent_backchannel_phrases.append(choice.phrase)
        self._recent_backchannel_phrases[:] = self._recent_backchannel_phrases[
            -max_remember:
        ]
        return choice

    def _usage_room_id(self) -> Optional[str]:
        """The LiveKit room name, which attributes a model call to a session.

        Passed explicitly to the calls the worker makes from its own tasks
        (fillers, interim, back-channel, clip TTS): those run outside the graph
        run, where the context var ``get_room_id`` reads is unset and reports
        "unknown". Read defensively so usage bookkeeping can never break the
        call it rides on.
        """
        return getattr(getattr(getattr(self, "ctx", None), "room", None), "name", None)

    def _working_memory_embed_many(self):
        """The backstory-pool embedder, recorded as working_memory_embedding.

        The pool is embedded in a detached task at setup, outside any graph
        run, so the room is passed explicitly.
        """
        return functools.partial(
            self.embedding_client.get_embeddings_batch,
            task=LLMTask.WORKING_MEMORY_EMBEDDING.value,
            room_id=self._usage_room_id(),
        )

    def _clip_usage(self) -> dict:
        """``synthesize_clips`` kwargs that record clip TTS as ``clip_tts``.

        Provider and model are the same values ``agent_tts`` rows carry: the
        clip instance is an isolated clone of the session's TTS client, so it
        bills at the same rate — but it is not the AgentSession's instance, so
        LiveKit's metrics hook never counts it.
        """
        return {
            "usage_room_id": self._usage_room_id(),
            "usage_provider": getattr(self, "_tts_provider", None),
            "usage_model": getattr(self, "_tts_model", None),
        }

    def _filler_language(self) -> str:
        """The session's BCP-47 code, used as part of the clip cache key."""
        return (
            getattr(
                getattr(self.scenario, "language_config", None), "language_code", None
            )
            or "unknown"
        )

    async def _generate_fillers(
        self,
        source: str,
        partial_text: Optional[str] = None,
    ) -> int:
        """Generate one batch of fillers and render it into the pool.

        ``source`` selects which generation moment this is — "seed" (character
        only, at session start), "exchange" (conversation so far, between turns)
        or "in_turn" (the learner's partial transcript, mid-utterance). Returns
        how many new clips reached the pool; 0 on any failure, which simply
        leaves the pool as it was.
        """
        pool = self._filler_pool
        if pool is None or self._predictive_filler_llm_client is None:
            return 0
        try:
            from app.core.livekit.filler_clips import synthesize_clips
            from app.core.livekit.predictive_filler import (
                generate_in_turn_fillers,
                generate_predictive_fillers,
                generate_seed_fillers,
            )

            count = int(getattr(settings, "PREDICTIVE_FILLER_COUNT", 8))
            if source == "seed":
                options = await generate_seed_fillers(
                    self._predictive_filler_llm_client,
                    self.scenario,
                    count,
                    room_id=self._usage_room_id(),
                )
            elif source == "in_turn":
                options = await generate_in_turn_fillers(
                    self._predictive_filler_llm_client,
                    self.scenario,
                    self._read_conversation_history(),
                    partial_text or "",
                    count=int(getattr(settings, "FILLER_IN_TURN_COUNT", 3)),
                    timeout_s=float(
                        getattr(settings, "FILLER_IN_TURN_TIMEOUT_MS", 2500.0)
                    )
                    / 1000.0,
                    room_id=self._usage_room_id(),
                )
            else:
                messages = self._read_conversation_history()
                if not messages:
                    return 0
                options = await generate_predictive_fillers(
                    self._predictive_filler_llm_client,
                    self.scenario,
                    messages,
                    count,
                    recent_fillers=pool.phrases,
                    room_id=self._usage_room_id(),
                )
            self._filler_stats["llm_calls"] += 1
            if not options:
                return 0

            requests = [(text, ftype, 0) for text, ftype in options]
            # A phrase about to be heard a second time gets a second RENDERING,
            # so the repeat is a different take rather than the same waveform.
            if getattr(settings, "FILLER_RENDER_VARIANTS", True):
                requests.extend(pool.variant_needed())

            clips = await synthesize_clips(
                self.tts_client,
                requests,
                language=self._filler_language(),
                source=source,
                **self._clip_usage(),
            )
            self._filler_stats["clips_synthesized"] += len(clips)
            added = pool.add(clips)
            logger.info(
                "[FILLER] %s batch: %d option(s) -> %d clip(s), %d new (pool=%d)",
                source,
                len(options),
                len(clips),
                added,
                len(pool),
            )
            return added
        except Exception as e:  # noqa: BLE001 - a filler must never break a session
            logger.warning("[FILLER] %s generation failed: %s", source, e)
            return 0

    # ================================================================
    # Thinking-filler playback
    # ================================================================

    def _observe_measured_wait(self, wait_ms: float) -> None:
        """Teach the gap predictor a turn's real wait (thinking -> reply audio)."""
        try:
            if self._gap_predictor is not None:
                self._gap_predictor.observe_wait(wait_ms)
        except Exception:  # noqa: BLE001 - prediction must never break a turn
            pass

    def _predicted_gap_ms(self) -> float:
        """How long the learner is about to wait for the real reply, in ms."""
        if self._gap_predictor is None:
            return float(getattr(settings, "FILLER_GAP_PRIOR_MS", 900.0))
        return self._gap_predictor.predict_ms()

    def _should_play_filler(self, predicted_ms: float) -> tuple[bool, str]:
        """Decide whether this turn gets a filler. Returns (play, reason).

        The predictor replaces the old "sleep and see": a turn whose reply will
        land quickly has no gap worth masking, and a filler inserted into it
        sounds like an affectation rather than thought. Above the certainty
        threshold a filler always plays; in between, the probability gate keeps
        it from being mechanical. A run of filler turns is capped regardless —
        a character who hesitates before every single reply reads as broken,
        however slow the turns genuinely are.
        """
        import random as _random

        # First, because it is the only reason that is not about this turn's
        # gap at all. Deciding it later would record a suppressed turn as
        # "skipped_fast_turn" or "skipped_probability" and quietly bend the
        # filler-decision distribution the dashboards read.
        if self._voice_on_avatar():
            return False, "skipped_video_actor"

        floor_ms = float(getattr(settings, "FILLER_PREDICTED_GAP_MS", 700.0))
        certain_ms = float(getattr(settings, "FILLER_CERTAIN_GAP_MS", 1200.0))
        if predicted_ms < floor_ms:
            return False, "skipped_fast_turn"

        max_run = int(getattr(settings, "FILLER_MAX_CONSECUTIVE_TURNS", 3))
        if max_run > 0 and self._filler_consecutive_turns >= max_run:
            return False, "skipped_probability"

        if predicted_ms >= certain_ms:
            return True, "played"
        probability = float(getattr(settings, "FILLER_PLAY_PROBABILITY", 0.6))
        if _random.random() > probability:
            return False, "skipped_probability"
        return True, "played"

    async def _delayed_filler_decision(self, created_at) -> None:
        """Decide filler playback the old way: wait, then see if it's still needed.

        Used only when FILLER_GAP_PREDICTION_ENABLED=False. Sleeps a randomized
        FILLER_MIN/MAX_DELAY_MS window — spending exactly the latency the
        predictor exists to avoid — and only then checks whether the reply is
        still pending. FILLER_PLAY_PROBABILITY alone gates the decision, since
        there is no predicted gap here to compare against a certainty threshold.
        """
        try:
            import random as _random

            lo = float(getattr(settings, "FILLER_MIN_DELAY_MS", 300.0))
            hi = float(getattr(settings, "FILLER_MAX_DELAY_MS", 600.0))
            if hi < lo:
                lo, hi = hi, lo
            await asyncio.sleep(max(0.0, _random.uniform(lo, hi) / 1000.0))

            if (
                not self._agent_thinking
                or self._bg_audio is None
                or self._filler_turn_count > 0
            ):
                self._filler_decided.set()
                return

            probability = float(getattr(settings, "FILLER_PLAY_PROBABILITY", 0.6))
            if _random.random() > probability:
                self._filler_consecutive_turns = 0
                turn_metrics.note_filler_decision(
                    self.ctx.room.name, "skipped_probability"
                )
                logger.info("[FILLER] skipped this turn (probability gate)")
                self._filler_decided.set()
                return

            await self._play_filler(created_at, hi, first=True)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - filler must never break a session
            logger.warning("[FILLER] delayed decision error: %s", e)
            self._filler_decided.set()

    def _on_filler_agent_state(self, ev) -> None:
        """Start or stop filler playback on the agent's thinking state.

        Entering "thinking" decides immediately from the predicted gap and, when
        it plays, does so at once — the clip's first frame is the agent's first
        audio, with no deliberate wait in front of it. Leaving "thinking" means
        the real reply is taking over: stop anything still playing and flush the
        buffered tail so it can't bleed over the reply on the other track.

        FILLER_GAP_PREDICTION_ENABLED=False is the rollback lever: it skips the
        predictor entirely and falls back to waiting out FILLER_MIN/MAX_DELAY_MS
        before deciding, exactly as the feature worked before prediction existed.

        Best-effort: never raises into the session.
        """
        try:
            if self._bg_audio is None:
                return
            if getattr(ev, "new_state", None) == "thinking":
                self._filler_turn_settled = False
                if self._filler_pool is None:
                    return
                self._agent_thinking = True
                if self._filler_handle is not None and not self._filler_handle.done():
                    return
                if self._filler_turn_count > 0:
                    # Already handled this turn (e.g. the early trigger fired).
                    return
                created_at = getattr(ev, "created_at", None)
                if not bool(getattr(settings, "FILLER_GAP_PREDICTION_ENABLED", True)):
                    task = asyncio.create_task(
                        self._delayed_filler_decision(created_at)
                    )
                    self._background_tasks.add(task)
                    task.add_done_callback(self._background_tasks.discard)
                    return
                predicted_ms = self._predicted_gap_ms()
                play, reason = self._should_play_filler(predicted_ms)
                if not play:
                    self._filler_consecutive_turns = 0
                    turn_metrics.note_filler_decision(
                        self.ctx.room.name,
                        reason,
                        fillerPredictedGapMs=int(predicted_ms),
                    )
                    logger.info(
                        "[FILLER] %s (predicted gap %.0fms)", reason, predicted_ms
                    )
                    self._filler_decided.set()
                    return
                task = asyncio.create_task(
                    self._play_filler(created_at, predicted_ms, first=True)
                )
                self._background_tasks.add(task)
                task.add_done_callback(self._background_tasks.discard)
            else:
                if getattr(ev, "new_state", None) == "listening":
                    # The character has stopped speaking: the pipeline is idle and
                    # the conversation has just gained a turn, so this is the
                    # cheapest possible moment to refresh the pool.
                    self._filler_regen_signal.set()
                self._agent_thinking = False
                self._stop_filler()
                if not self._filler_turn_settled:
                    self._filler_turn_settled = True
                    self._filler_consecutive_turns = (
                        self._filler_consecutive_turns + 1
                        if self._filler_played_this_turn
                        else 0
                    )
                    self._filler_turn_count = 0
                    self._filler_played_this_turn = False
                self._filler_decided.set()
        except Exception as e:  # noqa: BLE001 - filler must never break a session
            logger.warning("[FILLER] agent-state handler error: %s", e)

    def _speech_on_avatar(self) -> bool:
        """Whether a video actor is carrying the character's speech right now.

        The literal transport question, and nothing else. ``publishes_audio``
        flips at the moment of the swap, not when an avatar was merely
        requested, so this is False for the whole of a deferred session's
        pre-attach window.

        Kept separate from ``_voice_on_avatar`` below because that one also
        consults a preference. Reporting the transport must not depend on a
        setting about fillers: turning VIDEO_ACTOR_MUTE_VOICE_LAYERS off would
        otherwise relabel every avatar turn as a plain audio one and quietly
        corrupt the latency segmentation.
        """
        actor = getattr(self, "_video_actor", None)
        return actor is not None and actor.publishes_audio

    def _note_speech_transport(self) -> None:
        """Tell the turn metrics which output is carrying the speech now.

        Called once the session is running and again when a video actor
        attaches, which is the only time the answer changes. Turns finalized
        before the attach keep 'room' and turns after get 'avatar', so a single
        deferred session's rows legitimately carry both — see
        turn_metrics.SPEECH_TRANSPORTS for why the distinction is not cosmetic.
        """
        try:
            turn_metrics.note_tts_model(
                self.ctx.room.name,
                getattr(self, "_tts_provider", None),
                getattr(self, "_tts_model", None),
            )
            on_avatar = self._speech_on_avatar()
            turn_metrics.note_speech_transport(
                self.ctx.room.name,
                "avatar" if on_avatar else "room",
                getattr(self._video_actor, "provider", None) if on_avatar else None,
            )
        except Exception as e:  # noqa: BLE001 - metrics must never break a turn
            logger.debug("[VIDEO_ACTOR] could not note speech transport: %s", e)

    def _voice_on_avatar(self) -> bool:
        """Whether the character's voice is currently coming out of its face.

        True only while a video actor is actually carrying the speech AND the
        preference to keep the voice on the face is on.

        The three voiced naturalness layers (thinking filler, back-channel,
        interim reply) all play through BackgroundAudioPlayer's OWN published
        track, which never reaches the avatar renderer. So while this is True
        they would put the character's voice in the room with a motionless
        mouth to look at — the one contradiction video cannot absorb, and one a
        learner reads as a broken session rather than as naturalness. They are
        also least needed here: a present, visibly listening face already does
        a filler's job of stopping a pause from feeling dead.

        Deliberately dynamic rather than decided at setup. A deferred session
        has no face for its first 5-12s, and those are exactly the seconds the
        layers are worth most, so they run normally until the avatar arrives.

        The comfort room tone is not gated by this: it is the player's
        ``ambient_sound``, not a ``play()`` call, and ambient sound has no mouth
        to disagree with.
        """
        if not getattr(settings, "VIDEO_ACTOR_MUTE_VOICE_LAYERS", True):
            return False
        return self._speech_on_avatar()

    def _stop_filler(self) -> None:
        """Cut any filler still playing, plus its pending continuation."""
        if (
            self._filler_continuation_task is not None
            and not self._filler_continuation_task.done()
        ):
            self._filler_continuation_task.cancel()
        self._filler_continuation_task = None
        if self._filler_handle is not None and not self._filler_handle.done():
            self._filler_handle.stop()
            # stop() halts the feeder only; the already-buffered tail would
            # otherwise keep playing over the real reply on the separate agent
            # track. See bg_audio.flush().
            self._bg_audio.flush()
        self._filler_handle = None

    async def _play_filler(self, created_at, predicted_ms: float, first: bool) -> None:
        """Play one filler chosen to fit the remaining gap, and watch for silence.

        The clip is picked from the duration tier nearest
        ``predicted_ms - FILLER_TIER_MARGIN_MS``, so it ends about when the reply
        begins rather than leaving dead air behind it. First-audio is credited at
        the moment the FIRST FRAME IS ACTUALLY HANDED TO THE MIXER, not an
        estimate — the old code credited ``created_at + delay``, which was the
        one number the metric could not verify.
        """
        try:
            import time as _time

            from livekit.agents import AudioConfig

            from app.core.livekit.filler_clips import clip_audio_source

            pool = self._filler_pool
            if pool is None or self._bg_audio is None or not self._agent_thinking:
                return
            # Backstop. _should_play_filler already declines these turns, but
            # the avatar can attach in the window between that decision and
            # this coroutine being scheduled — and it is checked BEFORE
            # pool.choose/mark_played below, so a suppressed turn cannot burn a
            # clip's recency budget on audio nobody hears.
            if self._voice_on_avatar():
                logger.info(
                    "[FILLER] suppressed — the character has a face and this "
                    "track is not lip-synced"
                )
                self._filler_decided.set()
                return
            if self._filler_turn_count >= int(
                getattr(settings, "FILLER_MAX_PER_TURN", 2)
            ):
                return
            margin = float(getattr(settings, "FILLER_TIER_MARGIN_MS", 150.0))
            clip = pool.choose(target_ms=max(0.0, predicted_ms - margin))
            if clip is None:
                if first:
                    turn_metrics.note_filler_decision(
                        self.ctx.room.name, "skipped_no_clips"
                    )
                    self._filler_decided.set()
                return

            age = pool.age_turns(clip)
            pool.mark_played(clip)
            play_ts = _time.time()
            source = clip_audio_source(clip)
            self._filler_handle = self._bg_audio.play(AudioConfig(source))
            self._filler_turn_count += 1
            self._filler_played_this_turn = True
            self._filler_stats["played"] += 1
            self._filler_stats["distinct_played"].add(clip.key)

            self._emit_filler_transcript(clip.phrase, play_ts)
            if first:
                turn_metrics.note_filler_started(self.ctx.room.name, play_ts)
                lead_ms = (
                    (play_ts - created_at) * 1000.0 if created_at is not None else None
                )
                turn_metrics.note_filler_decision(
                    self.ctx.room.name,
                    "played",
                    fillerLeadMs=int(lead_ms) if lead_ms is not None else None,
                    fillerDurationMs=int(clip.duration_ms),
                    fillerClipSource=clip.source,
                    fillerType=clip.filler_type,
                    fillerPhraseAgeTurns=age,
                    fillerPredictedGapMs=int(predicted_ms),
                )
                self._filler_decided.set()
            else:
                self._filler_stats["continuations"] += 1
                turn_metrics.note_filler_continuation(self.ctx.room.name)
            logger.info(
                "[FILLER] playing %r (%s, %.0fms, tier=%s) for a predicted %.0fms gap",
                clip.phrase,
                clip.filler_type,
                clip.duration_ms,
                clip.tier,
                predicted_ms,
            )

            # Render a SECOND take of this phrase now, in the background, so if
            # it comes round again the learner hears a different rendering rather
            # than the identical waveform. This has to be driven by playback, not
            # by regeneration: regeneration is deliberately skipped while the pool
            # is still fresh, which is most of a short session — so hanging
            # variants off it meant they were almost never produced.
            self._ensure_variant(clip)

            if getattr(settings, "FILLER_CONTINUATION_ENABLED", True):
                self._filler_continuation_task = asyncio.create_task(
                    self._filler_continuation(clip.duration_ms, predicted_ms)
                )
                self._background_tasks.add(self._filler_continuation_task)
                self._filler_continuation_task.add_done_callback(
                    self._background_tasks.discard
                )
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - filler must never break a session
            logger.warning("[FILLER] play error: %s", e)
            if first:
                self._filler_decided.set()

    def _ensure_variant(self, clip) -> None:
        """Queue a second rendering of ``clip``'s phrase, if it has only one.

        Fire-and-forget and strictly off the turn's critical path: the clip being
        played is already chosen, and the variant is only wanted for a LATER
        turn. Skipped when the phrase already has more than one take, so this
        costs at most one extra synthesis per phrase per session — and usually
        zero, because the shared cache will already hold the variant from an
        earlier session on this worker.
        """
        pool = self._filler_pool
        if pool is None or not getattr(settings, "FILLER_RENDER_VARIANTS", True):
            return
        if not any(
            (p, t, v)
            for p, t, v in pool.variant_needed()
            if p.strip().lower() == clip.phrase.strip().lower()
        ):
            return

        async def _render() -> None:
            try:
                from app.core.livekit.filler_clips import synthesize_clips

                clips = await synthesize_clips(
                    self.tts_client,
                    [(clip.phrase, clip.filler_type, clip.variant + 1)],
                    language=self._filler_language(),
                    source=clip.source,
                    **self._clip_usage(),
                )
                self._filler_stats["clips_synthesized"] += len(clips)
                pool.add(clips)
            except Exception as e:  # noqa: BLE001 - never break a turn
                logger.debug("[FILLER] variant render failed: %s", e)

        task = asyncio.create_task(_render())
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def _filler_continuation(self, played_ms: float, predicted_ms: float) -> None:
        """After a filler ends, fill a lingering silence with one more.

        A filler that stops into dead air is worse than no filler: it draws
        attention to the wait it was meant to cover. So if the clip finishes and
        neither the interim reply nor the real reply has started within a natural
        pause, play one more — of a different type, because two hums in a row is
        the sound of a stuck machine, not a thinking person. Capped at
        FILLER_MAX_PER_TURN; a third silence is left alone, since a character who
        keeps muttering reads as stalling.
        """
        try:
            remaining_s = max(0.0, played_ms / 1000.0)
            await asyncio.sleep(remaining_s)
            gap_s = (
                float(getattr(settings, "FILLER_CONTINUATION_GAP_MS", 450.0)) / 1000.0
            )
            await asyncio.sleep(max(0.0, gap_s))

            if not self._agent_thinking or self._bg_audio is None:
                return
            if self._filler_handle is not None and not self._filler_handle.done():
                return
            remaining_gap = max(0.0, predicted_ms - played_ms - (gap_s * 1000.0))
            await self._play_filler(None, remaining_gap or predicted_ms, first=False)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[FILLER] continuation error: %s", e)

    # ---- in-turn generation + experimental early trigger ----

    def _on_filler_user_state(self, ev) -> None:
        """Track the learner's turn for in-turn generation and the early trigger."""
        try:
            if getattr(ev, "new_state", None) == "speaking":
                import time as _time

                self._user_speaking = True
                self._filler_in_turn_armed = False
                # A new learner turn: the previous turn's filler verdict no
                # longer applies, so the interim must wait for this turn's.
                self._filler_decided.clear()
                if self._user_turn_start_monotonic is None or not self._interim_enabled:
                    self._user_turn_start_monotonic = _time.monotonic()
                if (
                    self._filler_early_task is not None
                    and not self._filler_early_task.done()
                ):
                    self._filler_early_task.cancel()
                    self._filler_early_task = None
            else:
                self._user_speaking = False
                if getattr(settings, "FILLER_EARLY_TRIGGER_ENABLED", False):
                    self._filler_early_task = asyncio.create_task(
                        self._early_trigger_filler()
                    )
                    self._background_tasks.add(self._filler_early_task)
                    self._filler_early_task.add_done_callback(
                        self._background_tasks.discard
                    )
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[FILLER] user-state handler error: %s", e)

    async def _early_trigger_filler(self) -> None:
        """EXPERIMENTAL: start a filler before endpointing completes.

        The endpointing delay (0.5-3.0s) sits BEFORE the agent's thinking state,
        so it is silence the post-turn filler structurally cannot cover. Starting
        here masks it — at the risk that the learner was only pausing mid-thought
        and now hears the character talk over them, which is why this is off by
        default and gated on an A/B. Only a micro clip is used, and the learner
        resuming cancels it immediately.
        """
        try:
            delay_s = (
                float(getattr(settings, "FILLER_EARLY_TRIGGER_DELAY_MS", 250.0))
                / 1000.0
            )
            await asyncio.sleep(max(0.0, delay_s))
            if self._user_speaking or self._agent_thinking:
                return
            if self._bg_audio is None or self._filler_pool is None:
                return
            if self._filler_turn_count > 0:
                return
            predicted_ms = self._predicted_gap_ms()
            play, _reason = self._should_play_filler(predicted_ms)
            if not play:
                return
            self._agent_thinking = True  # so _play_filler's guards pass
            await self._play_filler(None, 600.0, first=True)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[FILLER] early trigger error: %s", e)

    def _on_filler_input_transcribed(self, ev) -> None:
        """Fire in-turn filler generation once the learner is mid-utterance.

        This is the only generation path that can see the CURRENT turn: an
        exchange batch is produced before the learner speaks, so the filler it
        yields necessarily answers the previous exchange. Firing here — early
        enough that synthesis finishes inside the endpointing delay — is what
        makes the played filler fit what was actually just said.
        """
        try:
            if not getattr(settings, "FILLER_IN_TURN_ENABLED", True):
                return
            if self._filler_pool is None or self._filler_in_turn_armed:
                return
            if bool(getattr(ev, "is_final", False)):
                # A final at the endpoint is too late to be useful this turn.
                return
            if self._user_turn_start_monotonic is None:
                return

            import time as _time

            text = (getattr(ev, "transcript", "") or "").strip()
            trigger_s = (
                float(getattr(settings, "FILLER_IN_TURN_TRIGGER_MS", 2000.0)) / 1000.0
            )
            if _time.monotonic() - self._user_turn_start_monotonic < trigger_s:
                return
            if len(text.split()) < int(
                getattr(settings, "FILLER_IN_TURN_MIN_WORDS", 4)
            ):
                return

            self._filler_in_turn_armed = True
            self._filler_in_turn_task = asyncio.create_task(
                self._generate_fillers(source="in_turn", partial_text=text)
            )
            self._background_tasks.add(self._filler_in_turn_task)
            self._filler_in_turn_task.add_done_callback(self._background_tasks.discard)
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[FILLER] in-turn handler error: %s", e)

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
                utterance_kind="filler",
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
                self.llm_client, self.scenario, count, room_id=self.ctx.room.name
            )
            if not phrases:
                logger.info("[BACKCHANNEL] no phrases generated — no back-channel")
                return False

            from app.core.livekit.filler_clips import synthesize_clips

            self._backchannel_clips = await synthesize_clips(
                self.tts_client,
                phrases,
                language=self._filler_language(),
                source="backchannel",
                **self._clip_usage(),
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
                    # stop() only halts the feeder; flush the buffered tail so
                    # the clip can't keep playing over the real reply on the
                    # agent track (see OpenerPlayer._cancel / bg_audio.flush).
                    self._bg_audio.flush()
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

            from app.core.livekit.filler_clips import clip_audio_source

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
                # Re-checked per iteration: the avatar can attach mid-loop.
                if self._voice_on_avatar():
                    logger.info(
                        "[BACKCHANNEL] suppressed — the character has a face "
                        "and this track is not lip-synced"
                    )
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

                clip = self._pick_backchannel_clip()
                if clip is None:
                    break
                self._backchannel_handle = self._bg_audio.play(
                    AudioConfig(clip_audio_source(clip), volume=volume)
                )
                logger.info(
                    "[BACKCHANNEL] emitted %r while learner speaking", clip.phrase
                )
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
        # Playback is the OpenerPlayer's; this side only drops a line once the
        # real reply starts.
        self.session.on("user_state_changed")(self._on_interim_user_state)
        self.session.on("user_input_transcribed")(self._on_user_input_transcribed)
        self.session.on("agent_state_changed")(self._on_interim_agent_state)
        logger.info(
            "[INTERIM] enabled (model=%s, trigger=%.0fms, min_words=%d)",
            getattr(settings, "INTERIM_REPLY_MODEL", "?"),
            float(getattr(settings, "INTERIM_REPLY_TRIGGER_MS", 6000.0)),
            int(getattr(settings, "INTERIM_REPLY_MIN_WORDS", 8)),
        )

    def _setup_predictive_filler_llm_client(self) -> None:
        """Build a connection-isolated LLM client for the predictive-filler
        background job.

        Same resolved provider/model/temperature as self.llm_client (built via
        the identical configure_llm_client() call) — this is purely a second
        HTTP connection, not a different model. Without it, the predictive
        filler loop's LLM call (on its own free-running ~10s timer, decoupled
        from turn boundaries — see _predictive_filler_loop) shares the real
        reply's connection and can delay its first token even though total
        generation time is unaffected: confirmed via a real A/B test showing
        avgLlmTtftMs up ~270ms with fillers on while avgLlmResponseMs stayed
        flat, the signature of connection contention rather than a slower
        model or a bigger prompt.

        Best-effort: on failure, falls back to sharing self.llm_client (the
        prior behavior) rather than breaking the session.
        """
        try:
            self._predictive_filler_llm_client = configure_llm_client(self.scenario)
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning(
                "[FILLER] dedicated predictive-filler client setup failed; "
                "falling back to the shared client: %s",
                e,
            )
            self._predictive_filler_llm_client = self.llm_client

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

                if self._interim_state in ("generating", "ready"):
                    # The learner resumed after a pause within the same turn:
                    # keep the interim being made for it. Resetting here
                    # cancelled every v3 interim in v2v (armed 6x, played 0x):
                    # long turns have pauses, and the line takes ~2 s to make.
                    self._user_speaking = True
                    return
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
            from app.core.livekit.filler_clips import synthesize_clips
            from app.core.livekit.interim_reply import generate_interim_reply

            # Nothing downstream will play this once the character has a face,
            # so generating it would be an LLM call plus a TTS synthesis per
            # learner turn for audio that is discarded. Checked here rather
            # than only at playback so the cost goes away too, not just the
            # sound.
            if self._voice_on_avatar():
                self._interim_state = "idle"
                return

            messages = self._read_conversation_history()
            reply = await generate_interim_reply(
                self._interim_llm_client,
                self.scenario,
                messages,
                partial_text,
                room_id=self._usage_room_id(),
            )
            if reply and self._opener_player is not None:
                # An opener (hum, sigh, breath) usually played already, so an
                # interim that opens with its own "Hhh," or "Um," is a second
                # hesitation in a row — heard in prod as a sigh then "Hhh, you
                # know…".
                from app.core.livekit.reply_shaping import strip_leading_hesitation

                reply = strip_leading_hesitation(reply)
            if reply:
                from app.core.livekit.reply_shaping import strip_understanding_claim

                reply = strip_understanding_claim(reply)
            if not reply:
                if self._interim_state == "generating":
                    self._interim_state = "idle"
                return

            tts_timeout_s = self._interim_tts_timeout_ms() / 1000.0
            clips = await asyncio.wait_for(
                synthesize_clips(
                    self.tts_client,
                    [reply],
                    language=self._filler_language(),
                    source="interim",
                    # An interim reply is written for one moment in one turn, so
                    # it will never be asked for again — caching it would only
                    # evict fillers that do repeat.
                    use_cache=False,
                    **self._clip_usage(),
                ),
                timeout=tts_timeout_s,
            )
            if not clips:
                if self._interim_state == "generating":
                    self._interim_state = "idle"
                return

            # The turn may have ended/reset while we synthesized — only commit if
            # still generating for this turn; otherwise drop the fresh clip (it
            # is in memory, so there is nothing to clean up).
            if self._interim_state != "generating":
                return

            self._interim_state = "ready"
            if self._opener_player is not None:
                self._opener_player.set_live_interim(clips[0].phrase, clips[0])
            logger.info("[INTERIM] ready: %r", clips[0].phrase)
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
        """Drop this turn's line once the real reply starts. Best-effort.

        A false endpoint (back to listening without a reply) keeps a line that
        is ready or still being made: the learner is going on, and it is for
        the real end of their turn.
        """
        try:
            if self._interim_enabled and getattr(ev, "new_state", None) == "speaking":
                self._interim_reset_turn()
        except Exception as e:  # noqa: BLE001 - interim must never break a session
            logger.warning("[INTERIM] agent-state handler error: %s", e)

    def _interim_reset_turn(self) -> None:
        """Drop all per-turn interim state (new turn, pause, or reply start)."""
        if self._interim_gen_task is not None and not self._interim_gen_task.done():
            self._interim_gen_task.cancel()
        self._interim_gen_task = None
        if self._opener_player is not None:
            self._opener_player.clear_live_interim()
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
                utterance_kind="interim",
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
        """Regenerate fillers per EXCHANGE, not on a clock.

        The old loop ran on a free-running 10s timer for the whole session. That
        cost an LLM call and five TTS calls every cycle whether or not anything
        had changed, and — because the timer knows nothing about turn boundaries
        — its request could land in the middle of the real reply's, which is the
        connection contention the isolated client exists to hide.

        Instead, wake when the character has FINISHED speaking: the pipeline is
        idle, the next filler is seconds away, and the conversation has just
        gained the turn worth conditioning on. Then skip the call entirely while
        the pool still holds enough unheard phrases, which in a short session is
        most of the time. A minimum gap keeps a rapid exchange from generating on
        every turn.

        Best-effort throughout — on any failure the pool keeps what it has.
        """
        min_gap_s = float(getattr(settings, "FILLER_REGEN_MIN_GAP_S", 8.0))
        min_fresh = int(getattr(settings, "FILLER_REGEN_MIN_FRESH", 5))
        last_run = 0.0

        try:
            while True:
                await self._filler_regen_signal.wait()
                self._filler_regen_signal.clear()

                pool = self._filler_pool
                if pool is None:
                    continue
                # The character has a face now, so nothing will play what this
                # loop generates. Exit rather than continue: the avatar cannot
                # detach, so there is no state to wait for.
                if self._voice_on_avatar():
                    logger.info(
                        "[FILLER] regeneration stopped — the character has a "
                        "face and this track is not lip-synced"
                    )
                    return

                now = time.monotonic()
                if now - last_run < min_gap_s:
                    continue
                fresh = pool.fresh_count()
                if fresh >= min_fresh:
                    logger.debug(
                        "[FILLER] regeneration skipped — %d fresh clip(s) in pool",
                        fresh,
                    )
                    continue

                last_run = now
                await self._generate_fillers(source="exchange")
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001 - must never break a session
            logger.warning("[FILLER] regeneration loop error: %s", e)

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
            _connect_t0 = time.monotonic()
            logger.info("[AgentWorker] Phase 3: Connecting to room...")
            # Prefer a process-prewarmed BVC instance (prewarm() builds one per
            # process into proc.userdata) so its noise-cancellation model isn't
            # constructed on the per-job critical path; fall back to a fresh one.
            userdata = getattr(getattr(self.ctx, "proc", None), "userdata", {}) or {}
            # Krisp BVC only runs on LiveKit Cloud. On a self-hosted SFU the
            # SDK rejects the filter ("audio filter cannot be enabled: LiveKit
            # Cloud is required") and the session runs unfiltered anyway, so
            # asking for it there only buys two error lines per session. Judge
            # the URL this job's room actually connects to — the server can
            # assign a media URL that differs from the one we registered with.
            _lk_url = session_livekit_url(self.ctx, settings.LIVEKIT_URL)
            _bvc_enabled = getattr(
                settings, "LIVEKIT_NOISE_CANCELLATION_ENABLED", False
            )
            if supports_noise_cancellation(_lk_url, enabled=_bvc_enabled):
                bvc = userdata.get("bvc") or noise_cancellation.BVC()
            else:
                bvc = None
                logger.info(
                    "[AgentWorker] noise cancellation off — Krisp BVC needs a "
                    "LiveKit Cloud deployment (url=%s, enabled=%s)",
                    _lk_url,
                    _bvc_enabled,
                )
            # V2V test rooms: DISABLE noise cancellation. Krisp BVC is
            # Background VOICE Cancellation — it can classify a synthetic
            # tester voice as non-primary audio and silently remove it, so
            # the agent's VAD never fires (observed live: agent deaf to a
            # Google Wavenet tester while the more natural Sarvam voice
            # passed). There is no background noise to cancel in a
            # machine-to-machine test; the tester joins before the agent, so
            # its identity is already visible here.
            _remote = getattr(self.ctx.room, "remote_participants", None) or {}
            _is_v2v_room = any(p.identity == "v2v-tester" for p in _remote.values())
            if _is_v2v_room:
                logger.info("[AgentWorker] v2v test room — noise cancellation off")
            # EXPERIMENTAL AI video actor, off at two independent gates (the
            # global settings.VIDEO_ACTOR_ENABLED and this roleplay's own
            # videoActorEnabled), both defaulting False. For a session that has
            # not opted in — every session today — this is one boolean read and
            # the ordering below is exactly what it has always been.
            _video_actor_wanted = (
                is_video_actor_enabled(self.scenario) and not self._is_text_chat
            )
            # Deferred is the default: the session starts audio-only and the
            # avatar attaches itself once it is actually rendering, so the
            # learner never waits out a 5-12s vendor render before the character
            # speaks. VIDEO_ACTOR_DEFER_ATTACH=false restores the blocking order
            # below in one restart.
            _video_actor_deferred = _video_actor_wanted and defers_attach(self.scenario)
            _video_actor_eager = _video_actor_wanted and not _video_actor_deferred

            async def _join_room() -> None:
                logger.info("[AgentWorker] Phase 3: Joining room...")
                await self.ctx.connect()
                self._timing["connect_ms"] = (time.monotonic() - _connect_t0) * 1000

            if _video_actor_eager:
                # Connect BEFORE the actor and the session start: a hosted
                # avatar is dispatched into the room by name and needs a room
                # that exists, and the in-process runner can only publish once
                # we are connected. Deliberately inside the gate — reordering
                # connect for every session to serve an opt-in experiment is
                # precisely the blast radius this feature is built to avoid.
                await _join_room()
                self._video_actor = await start_video_actor(
                    session=self.session,
                    room=self.ctx.room,
                    scenario=self.scenario,
                    # The URL this job's room actually lives on, not the one
                    # the worker registered with — a hosted avatar dials in
                    # server-side and must reach the same media server as the
                    # learner. Same distinction the Krisp gate above draws.
                    livekit_url=_lk_url,
                )

            if _video_actor_deferred:
                # DEFERRED. The session publishes its own audio exactly as an
                # audio-only session does, and keeps it for the whole render
                # wait. sync_transcription is off because the swap replaces
                # session.output.audio wholesale: RoomIO would otherwise have
                # wrapped the room's audio output in a transcript synchronizer
                # and paced the agent's captions against audio that had stopped
                # flowing through it. Nothing in this platform consumes LiveKit
                # room transcriptions — the transcript is built from the events
                # this worker emits — so unsynchronised captions cost nothing,
                # whereas a half-swapped output chain would be a puzzle for
                # whoever met it next.
                _output_options = {
                    "room_output_options": RoomOutputOptions(sync_transcription=False)
                }
            elif self._video_actor is not None and self._video_actor.publishes_audio:
                # The actor republishes the agent's speech in sync with its
                # video, so the session must not ALSO publish it — that would
                # put two copies of the same voice in the room, one lip-synced
                # and one not. Only a live handle earns the suppression: every
                # failure path in start_video_actor returns None, leaving this
                # empty and the session publishing audio exactly as it does
                # today.
                _output_options = {
                    "room_output_options": RoomOutputOptions(audio_enabled=False)
                }
            else:
                _output_options = {}

            if self._is_text_chat:
                # Text in on lk.chat, text out on lk.transcription, no audio
                # either way — see app/core/livekit/text_chat.py.
                _room_input_options, _text_output_options = text_chat_room_options()
                _output_options = {"room_output_options": _text_output_options}
            else:
                _room_input_options = RoomInputOptions(
                    noise_cancellation=None if _is_v2v_room else bvc,
                )

            await self.session.start(
                # ... (rest of the args identical)
                room=self.ctx.room,
                agent=self.agent,
                room_input_options=_room_input_options,
                **_output_options,
            )

            if not _video_actor_eager:
                # Connect to room with timeout
                await _join_room()
            logger.info("[AgentWorker] Phase 3: Started and joined room.")

            # Which output is carrying the speech, recorded before any turn can
            # finalize. Covers plain audio sessions and the eager avatar path;
            # the deferred one re-notes it when the swap commits.
            self._note_speech_transport()

            if _video_actor_deferred:
                # Off the startup path entirely: the session is live, audible
                # and about to speak its opening statement while the vendor
                # renders in the background.
                self._video_actor_task = asyncio.create_task(
                    self._attach_video_actor(_lk_url)
                )
                self._background_tasks.add(self._video_actor_task)
                self._video_actor_task.add_done_callback(self._background_tasks.discard)

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

        # Post-connect prep before the agent can speak (interruption detection +
        # event orchestrator + background-audio track). Timed as one segment for
        # the start-latency breakdown.
        _prep_t0 = time.monotonic()

        # Setup interruption detection. It listens for audio playback
        # finishing, so a text chat (no audio output) has nothing to watch.
        if not self._is_text_chat:
            setup_interruption_detection(self.session, self.ctx.room.name)

        # Initialize event orchestrator (only after session is connected)
        await self.event_orchestrator.initialize()

        # Set up the shared background-audio track — comfort room tone and the
        # thinking-filler (best-effort; never blocks or breaks the session).
        # Every layer on it is sound, so a text chat skips it wholesale; that
        # one gate is also what keeps fillers, back-channel and interim replies
        # off, since they are all wired from here.
        if not self._is_text_chat:
            await self._setup_background_audio()

        self._timing["prep_ms"] = (time.monotonic() - _prep_t0) * 1000

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
                _open_t0 = time.monotonic()
                handler = self.session.say(statement)
                logger.info("[AgentWorker] Waiting for opening statement playout...")
                # BOUNDED wait. An unbounded one parked session startup forever
                # on a stalled opener TTS, and the stall watchdog cannot help:
                # it only arms after a LEARNER turn, and the learner has not
                # spoken yet. The result was a live-looking call with permanent
                # silence and no error anywhere.
                #
                # The timeout deliberately does NOT interrupt the speech — it
                # only stops US waiting. So overshooting a legitimately long
                # opener costs nothing (the audio keeps playing), which is why
                # the bound can be well under the worst plausible opener.
                _open_timeout = float(
                    getattr(settings, "OPENING_STATEMENT_PLAYOUT_TIMEOUT_S", 30.0)
                )
                try:
                    await asyncio.wait_for(
                        handler.wait_for_playout(), timeout=_open_timeout
                    )
                    self._timing["opening_ms"] = (time.monotonic() - _open_t0) * 1000
                    logger.info("[AgentWorker] Opening statement playout complete.")
                except asyncio.TimeoutError:
                    logger.warning(
                        "[AgentWorker] Opening statement playout did not complete "
                        "within %.0fs (room=%s) — continuing session startup. The "
                        "learner may have heard nothing; the session is live and "
                        "listening, so a learner turn still gets a reply if the "
                        "pipeline recovers.",
                        _open_timeout,
                        self.ctx.room.name,
                    )
                    # Non-fatal fault: the session continues, but the client is
                    # told so it need not present a silent call as healthy.
                    try:
                        await asyncio.wait_for(
                            self._publish_session_fault(
                                "opening_statement_playout_timeout", fatal=False
                            ),
                            timeout=2.0,
                        )
                    except Exception:  # noqa: BLE001
                        logger.debug(
                            "[AgentWorker] could not signal opener stall to client"
                        )
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

        # Ship the start-latency ("time to first word") metric to Core for the
        # analytics chart. Best-effort and fire-and-forget — never block/break
        # the session on a metrics emit.
        self._emit_start_metrics()

    def _emit_start_metrics(self) -> None:
        """Ship this session's start-latency breakdown to Core (best-effort).

        The headline metric is the total time-to-first-word (agent job start ->
        the agent begins its opening dialogue) = configure + initialize + connect
        + prep, computed from ``self._timing`` (see the [START_TIMING] log). The
        segment fields let the chart stack where the startup time went. Emitted
        once per session; a missing timing segment simply drops that field.
        Fire-and-forget so the (sync) call never blocks on the network.
        """
        try:
            from app.core.events.handlers import send_event_to_queue
            from app.core.events.schemas import CoreEventMessageType, StartMetricsData

            t = self._timing

            def _ms(key: str):
                v = t.get(key)
                return int(round(v)) if v is not None else None

            configure = _ms("configure_ms")
            initialize = _ms("initialize_ms")
            connect = _ms("connect_ms")
            prep = _ms("prep_ms")
            segments = [s for s in (configure, initialize, connect, prep) if s]
            if not segments:
                # No usable timing captured (e.g. start() bailed early) — nothing
                # meaningful to report.
                return
            total = sum(segments)

            language = getattr(
                getattr(self.scenario, "language_config", None),
                "language_code",
                None,
            )

            # Glossary provenance (LANGUAGE_GLOSSARY_DESIGN.md §10): what this
            # session actually RECEIVED — delivery confirmation the server-side
            # stamp can't give. Joins judged outcomes to the exact glossary
            # (section versions) a session ran with.
            prompt_data = getattr(self.scenario, "prompt_data", None)
            tier0 = getattr(prompt_data, "language_glossary", None)
            tier1 = getattr(prompt_data, "glossary_sections", None)
            glossary_meta = getattr(prompt_data, "glossary_meta", None)
            glossary = None
            if tier0 or tier1 or glossary_meta:
                glossary = {
                    "tier0_chars": len(tier0) if isinstance(tier0, str) else 0,
                    "tier1_sections": len(tier1) if isinstance(tier1, list) else 0,
                }
                if isinstance(glossary_meta, dict):
                    if isinstance(glossary_meta.get("versions"), dict):
                        glossary["versions"] = glossary_meta["versions"]
                    if glossary_meta.get("tier0Tokens") is not None:
                        glossary["tier0_tokens"] = glossary_meta["tier0Tokens"]

            data = StartMetricsData(
                start_latency_ms=total,
                configure_ms=configure,
                initialize_ms=initialize,
                connect_ms=connect,
                prep_ms=prep,
                opening_playout_ms=_ms("opening_ms"),
                language=language,
                env=settings.ENV.value,
                metadata={"glossary": glossary} if glossary else None,
            )
            message = CoreEventMessageType.create_start_metrics(
                self.ctx.room.name, data
            )
            logger.info(
                "[START_METRICS] total=%dms configure=%s initialize=%s "
                "connect=%s prep=%s room=%s",
                total,
                configure,
                initialize,
                connect,
                prep,
                self.ctx.room.name,
            )
            spawn_background_task(
                send_event_to_queue(message.model_dump_json()),
                name="start-metrics-send",
                background_tasks=self._background_tasks,
            )
        except Exception:  # noqa: BLE001 - metrics must never break a session
            logger.exception("[START_METRICS] emit failed")

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
    try:
        _seg_t0 = time.monotonic()
        await worker.configure()  # Phase 1: Configure clients
        worker._timing["configure_ms"] = (time.monotonic() - _seg_t0) * 1000
        logger.info(f"[AgentWorker] Job {ctx.job.id} configured.")
        _seg_t0 = time.monotonic()
        await worker.initialize()  # Phase 2: Create session, agent, orchestrator
        worker._timing["initialize_ms"] = (time.monotonic() - _seg_t0) * 1000
        logger.info(f"[AgentWorker] Job {ctx.job.id} initialized.")
        _seg_t0 = time.monotonic()
        await worker.start()  # Phase 3: Connect and start
        worker._timing["start_ms"] = (time.monotonic() - _seg_t0) * 1000
        logger.info(f"[AgentWorker] Job {ctx.job.id} started.")
    except Exception:
        # configure()/initialize() and the first half of start() all run
        # before ctx.connect() is guaranteed to have fired. livekit-agents'
        # run_job() only resolves its shutdown future on ctx.connect(),
        # ctx.shutdown(), or a room-disconnect event — raising alone does
        # none of those, so the job process hangs forever, the agent never
        # joins, and the room never frees (the same defect was fixed narrowly
        # in the since-removed v2 entrypoint, commit dd61115). Call shutdown
        # explicitly so the job
        # terminates and the failure is visible instead of hanging silently.
        logger.exception(
            f"[AgentWorker] Startup failed before the agent could join "
            f"job {ctx.job.id} — shutting down the job"
        )
        ctx.shutdown("startup_failed")
        raise

    # One-line breakdown of the pre-opening critical path so we can see which
    # segment dominates the delay before the agent speaks. Log-only, guarded so
    # a formatting slip can never affect the job.
    try:
        _t = worker._timing
        logger.info(
            "[START_TIMING] configure=%.0fms initialize=%.0fms eou_load=%.0fms "
            "start=%.0fms connect=%.0fms opening=%.0fms",
            _t.get("configure_ms", 0.0),
            _t.get("initialize_ms", 0.0),
            _t.get("eou_load_ms", 0.0),
            _t.get("start_ms", 0.0),
            _t.get("connect_ms", 0.0),
            _t.get("opening_ms", 0.0),
        )
    except Exception:  # noqa: BLE001 - timing log must never affect the job
        pass

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


async def dispatch_entrypoint(ctx: agents.JobContext):
    """Entrypoint for every job.

    Was a router: this worker served both the v1 scenario engine and the
    Roleplay Studio v2 runtime, branching on an ``engine`` marker in room
    metadata. Studio v2 is gone, so there is one engine and nothing to route.
    Kept as a named indirection because `start.sh` and the LiveKit worker
    options reference it, and because a second engine would land here again.
    """
    return await entrypoint(ctx)


def prewarm(proc: JobProcess):
    # First thing in the child: keep only LiveKit's log forwarder so records are
    # emitted once (by the parent), not also locally. See logger.py.
    make_child_logging_forward_only()
    logger.info("!!! PREWARM CALLED !!!")
    """Prewarm per-process objects so they aren't built on the per-job path.

    Each is stored in ``proc.userdata`` and reused by the (single) job running on
    this process (see ``_create_session`` for VAD and ``session.start`` for BVC).

    Note: the semantic-EOU model is intentionally NOT prewarmed here — its
    weights load once per worker in the inference executor (registered at module
    import), and its per-job ``MultilingualModel()`` handle requires the job
    context so it cannot be constructed in prewarm.

    The BVC prewarm is wrapped in its own try/except: if it can't be constructed
    here we log and skip it, and ``session.start`` falls back to building it
    inline — a pure best-effort speedup with zero regression when it fails.
    """
    proc.userdata["vad"] = silero.VAD.load(
        activation_threshold=DEFAULT_VAD_ACTIVATION_THRESHOLD
    )

    # Noise-cancellation (BVC) filter used by the room input options.
    try:
        proc.userdata["bvc"] = noise_cancellation.BVC()
        logger.info("[PREWARM] noise-cancellation (BVC) prewarmed")
    except Exception as e:  # noqa: BLE001 - best-effort; falls back per-job
        logger.warning("[PREWARM] BVC prewarm skipped (will build per-job): %s", e)


if __name__ == "__main__":
    # Prevent run_app's _configure_logger from adding a second JSON stdout
    # handler to root in this (parent) process; our bracketed handler stays the
    # single sink. See logger.py.
    patch_livekit_parent_logger()
    agent_name = "" if settings.ENV == Environment.LOCAL else settings.AGENT_NAME

    # ECS autoscaling signal: publish this task's active-session count to
    # CloudWatch so a target-tracking policy can scale the fleet on real demand
    # (CPU/memory metrics can't — see app/core/worker_metrics.py). This rides the
    # load_fnc hook, returning the EXACT default worker load (dispatch behaviour
    # unchanged) and side-emitting the metric. make_load_fnc() returns None on an
    # unexpected livekit version, in which case we omit load_fnc entirely and the
    # worker uses LiveKit's own default — never a degraded dispatch path.
    from app.core.worker_metrics import make_load_fnc

    _load_fnc = make_load_fnc()

    # Registration health. The SDK stops retrying a lost LiveKit connection
    # once max_retry is exhausted and does NOT exit the process, so the worker
    # sits resident and registered with nobody while every external signal
    # reads green (2026-08-09: 12 tasks dark for 19h). The monitor watches for
    # that, writes a heartbeat the API process's /api/health reads, and exits
    # the process on permanent loss so start.sh's `wait -n` self-heal fires.
    # See app/core/worker_health.py.
    from app.core.worker_health import start_health_monitor, wrap_load_fnc

    start_health_monitor()
    # Wrapped rather than replaced: load_fnc is the only WorkerOptions hook
    # that hands us the AgentServer, and it keeps returning the exact value the
    # wrapped function produced, so dispatch behaviour is unchanged.
    _load_fnc = wrap_load_fnc(_load_fnc)
    _load_kwargs = {"load_fnc": _load_fnc} if _load_fnc is not None else {}
    if _load_fnc is None:
        # No load_fnc means no handle on the AgentServer, so permanent
        # connection loss cannot be detected and the process will not
        # self-terminate. The heartbeat still catches a dead worker process.
        # Deliberately NOT substituting a stand-in load_fnc: a wrong load value
        # would corrupt dispatch, which is worse than losing this signal.
        logger.error(
            "[worker-health] no load_fnc available (unexpected livekit-agents "
            "version) — LiveKit connection-loss detection is DISABLED for this "
            "worker; /api/health can only report whether the worker process is "
            "alive"
        )

    agents.cli.run_app(
        agents.WorkerOptions(
            agent_name=agent_name,
            # Single-fleet router: v1 + v2 both served here (see
            # dispatch_entrypoint), so v2 registers no second agent name.
            entrypoint_fnc=dispatch_entrypoint,
            prewarm_fnc=prewarm,
            **_load_kwargs,
            # Keep TWO warm job processes ready. A cold job process takes ~6s to
            # spin up (imports + silero VAD/BVC prewarm), which races LiveKit's
            # ~7.5s assignment window — a single spare (1) means the 2nd near-
            # simultaneous session cold-spawns on the critical path and
            # intermittently misses the window → AssignmentTimeoutError → the
            # agent never joins. Two spares give an instant hand-off for the
            # common 1-2 concurrent case so jobs are assigned immediately.
            # Costs ~one extra prewarmed process (VAD+BVC) of baseline memory;
            # the task memory was raised (see task def) to absorb it.
            num_idle_processes=2,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
            ws_url=settings.LIVEKIT_URL,
            # Increased from 10 to 600 seconds (10 minutes) for longer conversations
            drain_timeout=600,
            # Reconnect budget before the worker gives up for good. The SDK
            # default of 16 backs off as min(n*2, 10)s, so it stops trying after
            # only ~2.5 minutes — and it does NOT exit the process. The asyncio
            # task dies, the container stays up, `start.sh`'s `wait -n` self-heal
            # never fires, and the fleet sits RUNNING and silently deaf until a
            # human redeploys it. That is exactly what happened on 2026-08-09:
            # LiveKit moved hosts, every task exhausted 16 attempts during the
            # cutover, and all 12 stayed dark for 19h while ECS, the container
            # health signal and the CloudWatch metrics all read green.
            # 360 attempts ≈ 1 hour of retrying, so any realistic LiveKit
            # restart or migration is ridden out without a restart. If it IS
            # still failing after an hour the worker is genuinely wedged: the
            # SDK then sets `_connection_failed`, its health server on :8081
            # starts returning 503, and the orchestrator replaces the task.
            max_retry=360,
            job_memory_warn_mb=650,
            initialize_process_timeout=120,
            # shutdown_with_cleanup's own on_shutdown handler (see
            # app/core/events/handlers.py) budgets up to 3s draining
            # orchestrator sends plus up to 16s draining an in-flight
            # finalize task — ~19s before its own network calls (final
            # score send, session-memory emission) even start. Left at the
            # SDK's shutdown_process_timeout default of 10s, the ipc
            # supervisor's close_timeout races that budget and SIGUSR1-kills
            # the job process before score/memory persistence finishes
            # (CloudWatch: "process did not exit in time, killing process" /
            # exit code -10). 30s gives that budget real headroom. On top of
            # that ~19s, shutdown_with_cleanup's own supervisor-notes/
            # background-audio/background-task teardown adds up to
            # SUPERVISOR_NOTES_CLOSE_TIMEOUT + BG_AUDIO_CLOSE_TIMEOUT +
            # BACKGROUND_TASKS_CLEANUP_TIMEOUT (3s each, ~9s), plus
            # VIDEO_ACTOR_CLOSE_TIMEOUT (2s) on the opted-in sessions that have
            # one — those used to be unbounded awaits, which is what let a
            # single stalled one (e.g. a slow BVC track teardown) push the whole
            # chain past this ceiling and reproduce the same kill days after
            # this timeout was first raised.
            shutdown_process_timeout=30,
        )
    )
