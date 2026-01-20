import asyncio
import random
from typing import Optional, Set

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, JobProcess, RoomInputOptions
from livekit.agents.cli.log import setup_logging
from livekit.plugins import noise_cancellation, silero

from app.core.config import settings
from app.core.constants import (
    DEFAULT_BRANCHING_LLM_CONFIG,
    DEFAULT_VAD_ACTIVATION_THRESHOLD,
    Environment,
)
from app.core.embeddings import OpenAIEmbeddingClient
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.scenario.base import Scenario
from app.llms import BaseLLMClient
from app.stt import BaseSTTClient
from app.tts import BaseTTSClient
from app.utils.agent_utils import (
    cleanup_background_tasks,
    configure_llm_client,
    configure_stt_client,
    configure_tts_client,
    create_agent_with_adapter,
    initialize_agent_state,
    should_say_opening_statement,
)
from app.utils.event_handler import (
    create_connection_state_handler,
    create_conversation_handler,
    create_shutdown_handler,
    create_termination_handler,
    setup_interruption_detection,
)
from app.utils.logger import get_logger
from app.utils.metadata_parser import parse_room_metadata

logger = get_logger(__name__)
setup_logging(
    settings.LIVEKIT_LOG_LEVEL,
    devmode=settings.LIVEKIT_LOG_DEV_MODE,
    console=settings.LIVEKIT_LOG_CONSOLE,
)


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
        self.agent: Optional[Agent] = None

        # ========== State Tracking ==========
        self.final_score_sent = False
        self._background_tasks: Set[asyncio.Task] = set()

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

        # Parse metadata
        rm_md_envelope = parse_room_metadata(
            self.ctx.job.metadata,
            embedding_client=self.embedding_client,
            branching_llm_config=DEFAULT_BRANCHING_LLM_CONFIG,
        )
        self.scenario = rm_md_envelope.scenario
        logger.debug(f"Events in scenario: {str(self.scenario.events)}")

        # Configure STT and TTS clients - using utility functions
        self.stt_client = configure_stt_client(self.scenario)
        self.tts_client = configure_tts_client(self.scenario)

        # Configure LLM client
        self.llm_client = configure_llm_client(self.scenario)

        # Generate and set default voice expression parameters
        if settings.ENABLE_VOICE_EXPRESSIONS:
            from app.speech_prosody.service import SpeechProsodyService

            prosody_service = SpeechProsodyService(self.tts_client)
            await prosody_service.generate_and_set_defaults(
                scenario=self.scenario,
                llm_client=self.llm_client,
            )
            # Get defaults from prosody service (single source of truth)
            defaults = prosody_service.get_default_parameters()
            logger.info(f"TTS defaults set: {defaults}")

            # Sync to TTS client for backward compatibility with
            # get_defaults_for_learn_service()
            self.tts_client._default_params = defaults.copy()

        # Initialize agent state
        self.joined_iso = initialize_agent_state(
            thread_id=self.ctx.room.name,
            scenario=self.scenario,
        )

    async def initialize(self):
        """
        Creates session, agent, orchestrator, and registers callbacks.
        Must be called after configure().
        """
        # Create session (needs clients from configure phase)
        self._create_session()

        # Setup orchestrator
        self._setup_event_orchestrator()

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
        )

        # Register callbacks
        self._register_callbacks()

    def _create_session(self):
        """Create agent session with STT and TTS."""
        # VAD is always prewarmed in prewarm(), so retrieve it regardless
        vad = self.ctx.proc.userdata.get("vad")
        stt_instance = self.stt_client.stt_instance
        tts_instance = self.tts_client.tts_instance

        self.session = AgentSession(
            stt=stt_instance,
            tts=tts_instance,
            vad=vad,
            turn_detection="vad" if vad else None,
        )

    def _setup_event_orchestrator(self):
        """Initialize event orchestrator with callbacks."""
        # Create termination handler using utility
        termination_handler = create_termination_handler(
            session=self.session,
            ctx=self.ctx,
            background_tasks=self._background_tasks,
        )

        self.event_orchestrator = EventOrchestrator(
            scenario=self.scenario,
            termination_callback=termination_handler,
            room=self.ctx.room,
            thread_id=self.ctx.room.name,
            agent_joined_at=self.joined_iso,
        )

        # Update termination handler with orchestrator reference
        termination_handler.set_event_orchestrator(self.event_orchestrator)

        logger.info(
            f"Initialized EventOrchestrator with {len(self.scenario.events)} events"
        )

    def _register_callbacks(self):
        """Register room, session, and shutdown callbacks."""
        # Conversation handler (register on session)
        conversation_handler, cleanup_conversation_handler = (
            create_conversation_handler(self.ctx.room.name, self.joined_iso)
        )
        self.session.on("conversation_item_added")(conversation_handler)

        # Store cleanup handler for shutdown
        self._cleanup_conversation_handler = cleanup_conversation_handler

        # Connection state handler
        connection_handler = create_connection_state_handler(
            event_orchestrator=self.event_orchestrator,
            room_name=self.ctx.room.name,
            final_score_sent_ref=lambda: self.final_score_sent,
            set_final_score_sent=lambda val: setattr(self, "final_score_sent", val),
            background_tasks=self._background_tasks,
        )

        @self.ctx.room.on("connection_state_changed")
        def on_connection_state_changed(state: rtc.ConnectionState):
            connection_handler(state)

        # Shutdown handler
        original_shutdown_handler = create_shutdown_handler(
            event_orchestrator=self.event_orchestrator,
            room_name=self.ctx.room.name,
            final_score_sent_ref=lambda: self.final_score_sent,
            set_final_score_sent=lambda val: setattr(self, "final_score_sent", val),
            cleanup_background_tasks=lambda: cleanup_background_tasks(
                self._background_tasks
            ),
        )

        # Wrap shutdown handler to include conversation handler cleanup
        async def shutdown_with_cleanup():
            try:
                self._cleanup_conversation_handler()
            except Exception as e:
                logger.debug(f"Error cleaning up conversation handler: {e}")
            await original_shutdown_handler()

        shutdown_handler = shutdown_with_cleanup

        self.ctx.add_shutdown_callback(shutdown_handler)

    async def start(self):
        """
        Connects to room, initializes orchestrator, sets up interruption detection,
        and says opening statement.
        """
        # Start session and connect
        await self.session.start(
            room=self.ctx.room,
            agent=self.agent,
            room_input_options=RoomInputOptions(
                noise_cancellation=noise_cancellation.BVC(),
            ),
        )
        await self.ctx.connect()

        # Setup interruption detection
        setup_interruption_detection(self.session)

        # Initialize event orchestrator (only after session is connected)
        await self.event_orchestrator.initialize()

        # Say opening statement if scenario has opening statements
        if should_say_opening_statement(
            scenario=self.scenario,
            event_orchestrator=self.event_orchestrator,
        ):
            handler = self.session.say(
                random.choice(self.scenario.prompt_data.opening_statements)
            )
            await handler.wait_for_playout()


async def entrypoint(ctx: agents.JobContext):
    """
    Main agent entrypoint

    This function can be used with:
        agent = Agent(options=WorkerOptions(...))
        await agent.run_from_notebook(entrypoint)
    """
    worker = AgentWorker(ctx)
    await worker.configure()  # Phase 1: Configure clients
    await worker.initialize()  # Phase 2: Create session, agent, orchestrator
    await worker.start()  # Phase 3: Connect and start


def prewarm(proc: JobProcess):
    """Prewarm VAD model for faster startup."""
    proc.userdata["vad"] = silero.VAD.load(
        activation_threshold=DEFAULT_VAD_ACTIVATION_THRESHOLD
    )


if __name__ == "__main__":
    import sys

    # Handle download-files command for Docker build
    if len(sys.argv) > 1 and sys.argv[1] == "download-files":
        # Pre-download VAD model files
        logger.info("Downloading required model files...")
        silero.VAD.load(activation_threshold=DEFAULT_VAD_ACTIVATION_THRESHOLD)
        logger.info("Model files downloaded successfully")
        sys.exit(0)

    agent_name = "" if settings.ENV == Environment.LOCAL else settings.AGENT_NAME
    agents.cli.run_app(
        agents.WorkerOptions(
            agent_name=agent_name,
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            num_idle_processes=1,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
            ws_url=settings.LIVEKIT_URL,
            drain_timeout=10,
        )
    )
