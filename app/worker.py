import asyncio
import os
import random
import sys
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
from app.core.scenario.base import Scenario
from app.core.scoring.score_keeper import ScoreKeeper
from app.llms import BaseLLMClient
from app.stt import BaseSTTClient
from app.tts import BaseTTSClient

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
        self.score_keeper: Optional[ScoreKeeper] = None
        self.agent: Optional[Agent] = None

        # ========== State Tracking ==========
        self.final_score_sent = False
        self._background_tasks: Set[asyncio.Task] = set()

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

        # Configure LLM client
        self.llm_client = configure_llm_client(self.scenario)

        # Fire prosody generation as a background task so configure() returns
        # immediately and the agent can join the room while prosody is generating.
        # _await_prosody() in start() will collect the result before first speech.

        from app.speech_prosody.service import SpeechProsodyService

        self._prosody_service = SpeechProsodyService(self.tts_client)
        self._prosody_task: Optional[asyncio.Task] = asyncio.create_task(
            self._prosody_service.generate_and_set_defaults(
                scenario=self.scenario,
                llm_client=self.llm_client,
            )
        )
        logger.info("[AgentWorker] Phase 1: Prosody generation started in background.")

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

    async def _await_prosody(self) -> None:
        """Collect the background prosody task and apply defaults to the TTS client."""
        task = getattr(self, "_prosody_task", None)
        if task is None:
            return
        try:
            await asyncio.wait_for(task, timeout=1.5)
            defaults = self._prosody_service.get_default_parameters()
            self.tts_client._default_params = defaults.copy()
            logger.info("[AgentWorker] Prosody configuration applied.")
        except asyncio.TimeoutError:
            logger.warning(
                "[AgentWorker] Prosody generation timed out after 1.5s, "
                "using safe defaults."
            )
        except Exception as e:
            logger.error(
                f"[AgentWorker] Prosody generation failed: {e}. Using safe defaults."
            )
        finally:
            self._prosody_task = None

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
        except Exception as e:
            logger.exception(f"[AgentWorker] Failed to start/join room: {e}")
            logger.info(f"[AgentWorker] Phase 3: Failed to start/join room: {e}")
            raise

        # Setup interruption detection
        setup_interruption_detection(self.session)

        # Initialize event orchestrator (only after session is connected)
        await self.event_orchestrator.initialize()

        # Collect background prosody task before first speech synthesis call
        await self._await_prosody()

        if should_say_opening_statement(
            scenario=self.scenario,
            event_orchestrator=self.event_orchestrator,
        ):
            statement = random.choice(self.scenario.prompt_data.opening_statements)
            logger.info(f"[AgentWorker] Saying opening statement: {statement}")
            handler = self.session.say(statement)
            logger.info("[AgentWorker] Waiting for opening statement playout...")
            await handler.wait_for_playout()
            logger.info("[AgentWorker] Opening statement playout complete.")

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

            # Step 1: Generate new prosody parameters for termination message
            # Termination is a significant moment - pass current parameters for context
            # so LLM can make informed decisions about the transition.
            # Skip the prosody pass when the simulation has prosody disabled —
            # the termination message will play with the TTS provider's defaults.
            prosody_enabled = getattr(self.scenario.prompt_data, "enable_prosody", True)
            if prosody_enabled:
                from app.speech_prosody.service import (
                    SpeechProsodyService,
                    generate_and_apply_prosody_for_message,
                )

                # Get current parameters for context (LLM will decide on transition)
                prosody_service = SpeechProsodyService(self.tts_client)
                current_params = prosody_service.get_current_parameters()

                # Generate parameters for termination message
                # Pass current parameters so LLM can make context-aware decisions
                # about the transition (dramatic shift vs subtle change)
                termination_text_to_say = await generate_and_apply_prosody_for_message(
                    tts_client=self.tts_client,
                    message_text=self._termination_message,
                    llm_client=self.llm_client,
                    scenario=self.scenario,
                    conversation_history=None,  # No history for termination
                    conversation_history_limit=0,
                    current_parameters=current_params,
                )
            else:
                termination_text_to_say = None

            if not termination_text_to_say:
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
