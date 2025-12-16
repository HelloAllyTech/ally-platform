import asyncio
import random
from datetime import datetime, timezone

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, JobProcess, RoomInputOptions
from livekit.agents.cli.log import setup_logging
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.langchain import LLMAdapter

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, Environment
from app.core.embeddings import OpenAIEmbeddingClient
from app.core.events.base import BaseEvent
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.events.schemas import CoreEventMessageType
from app.core.graph import agent_graph
from app.core.graph.utils import serialize_event
from app.core.queue import msg_event_queue
from app.stt import create_stt_client
from app.tts import Gender, create_tts_client
from app.utils.event_handler import create_conversation_handler
from app.utils.logger import get_logger
from app.utils.metadata_parser import parse_room_metadata
from app.utils.queue_utils import send_final_score_to_core

logger = get_logger(__name__)
setup_logging(
    settings.LIVEKIT_LOG_LEVEL,
    devmode=settings.LIVEKIT_LOG_DEV_MODE,
    console=settings.LIVEKIT_LOG_CONSOLE,
)


class Assistant(Agent):
    """Custom agent implementation."""

    def __init__(
        self, instructions: str = "You're a simulation client", **kwargs
    ) -> None:
        super().__init__(instructions=instructions, **kwargs)


def initialize_agent_state(room_name: str, scenario) -> None:
    """Initialize agent graph state for the session."""
    agent_graph.update_state(
        {"configurable": {"thread_id": room_name}},
        values={
            "messages": [],
            "permitted_events": scenario.events,
            "events_accumulator": [],
            "new_events": [],
            "current_score": 0,
            "branching_instructions": [],
        },
    )


def create_agent_session(tts_config, vad, stt_config) -> AgentSession:
    """Create and configure agent session with STT, TTS, and VAD."""
    return AgentSession(
        stt=stt_config,
        tts=tts_config,
        vad=vad,
        turn_detection="vad",
    )


async def publish_termination_audio(message: str, session: AgentSession) -> None:
    """
    Synthesize and publish termination message as audio.

    Args:
        message: Termination message to convert to audio
        session: Agent session instance
    """
    try:
        logger.info(f"Publishing termination audio: '{message}'")

        await session.interrupt()
        handler = session.say(message, allow_interruptions=False)
        await handler.wait_for_playout()

        logger.info("Termination audio playback completed")

    except Exception as e:
        logger.exception(f"Failed to publish termination audio: {e}")
        raise


async def entrypoint(ctx: agents.JobContext):
    """Main agent entrypoint handling room connection and conversation flow."""

    # Create a single embedding client for all semantic similarity events
    # in this agent call
    embedding_client = OpenAIEmbeddingClient(
        model=settings.OPENAI_EMBEDDING_MODEL, api_key=settings.OPENAI_API_KEY
    )
    logger.debug("Created shared embedding client for semantic similarity events")

    # Initialize class-level embedding client for SemanticSimilarityEvent
    # (once per session)
    from app.core.events.event_types.semantic_similarity.semantic_similarity_event import (  # noqa: E501
        SemanticSimilarityEvent,
    )

    SemanticSimilarityEvent._EMBEDDING_CLIENT = embedding_client

    # Parse metadata with error handling
    rm_md_envelope = parse_room_metadata(
        ctx.job.metadata, embedding_client=embedding_client
    )
    scenario = rm_md_envelope.scenario
    logger.debug(f"Events in scenario: {str(scenario.events)}")

    # Get language code and configs from scenario
    language_code = DEFAULT_LANGUAGE_CODE
    stt_config_from_metadata = None
    if scenario.language_config:
        language_code = scenario.language_config.language_code
        stt_config_from_metadata = scenario.language_config.stt_config

    # Configure STT
    try:
        stt_client = create_stt_client(
            stt_config=stt_config_from_metadata, language_code=language_code
        )
        stt_config = stt_client.stt_instance
    except Exception as e:
        logger.warning(f"STT config failed, using default: {e}")
        stt_client = create_stt_client(language_code=language_code)
        stt_config = stt_client.stt_instance

    # Configure TTS
    # Convert scenario.voice to dict format for create_tts_client
    tts_config_from_metadata = None
    if scenario.voice:
        tts_config_from_metadata = {
            "provider": scenario.voice.provider,
            "name": scenario.voice.name,
            "config": {
                "model": scenario.voice.config.model,
                "voice_id": scenario.voice.config.voice_id,
                "speaker": scenario.voice.config.speaker,
                "voice_name": scenario.voice.config.voice_name,
                "gender": scenario.voice.config.gender,
                "voice_cloning_key": scenario.voice.config.voice_cloning_key,
                "instant_mode": scenario.voice.config.instant_mode,
                "voice_provider": scenario.voice.config.voice_provider,
            },
        }

    # Convert gender string to Gender enum
    gender_enum = (
        Gender(scenario.prompt_data.gender.lower())
        if scenario.prompt_data.gender
        else None
    )

    try:
        tts_client = create_tts_client(
            tts_config=tts_config_from_metadata,
            language_code=language_code,
            gender=gender_enum,
        )
        tts_config = tts_client.tts_instance
    except Exception as e:
        logger.warning(f"TTS config failed, using default: {e}")
        if gender_enum:
            tts_client = create_tts_client(
                language_code=language_code, gender=gender_enum
            )
            tts_config = tts_client.tts_instance
        else:
            raise ValueError("Cannot create TTS: gender is required for fallback")

    # Initialize state
    initialize_agent_state(ctx.room.name, scenario)
    joined_iso = datetime.now(timezone.utc).isoformat()

    # Setup session
    vad = ctx.proc.userdata.get("vad")
    session = create_agent_session(tts_config, vad, stt_config)

    # Initialize EventOrchestrator (termination callback will be set below)
    event_orchestrator = EventOrchestrator(
        scenario=scenario,
        termination_callback=None,  # Set after defining the callback
        room=ctx.room,
        thread_id=ctx.room.name,
    )
    logger.info(f"Initialized EventOrchestrator with {len(scenario.events)} events")

    # Track if final score has been sent to prevent duplicates
    final_score_sent = False

    # Listen to connection state changes and push total score on disconnect
    @ctx.room.on("connection_state_changed")
    def on_connection_state_changed(state: rtc.ConnectionState):
        nonlocal final_score_sent
        logger.info(f"LiveKit Event: Connection state changed: {state}")

        # Send final score when connection state changes to DISCONNECTED
        if state == rtc.ConnectionState.CONN_DISCONNECTED:
            if final_score_sent:
                logger.info(
                    "Final score already sent, skipping duplicate send on disconnect"
                )
                return

            logger.info(
                "Connection state is DISCONNECTED, sending final score to backend"
            )
            try:
                asyncio.create_task(
                    send_final_score_to_core(
                        room_id=ctx.room.name,
                        thread_id=ctx.room.name,
                        event_orchestrator=event_orchestrator,
                    )
                )
                final_score_sent = True
                logger.info(
                    "Initiated queue push for connection state change to DISCONNECTED"
                )
            except Exception as e:
                logger.error(
                    f"Failed to initiate queue push on connection state change: {e}"
                )

    async def handle_termination_task(event: BaseEvent):
        """Handle session termination when a termination event occurs."""
        logger.info(
            f"Termination event '{event.event_id}' triggered. Initiating shutdown..."
        )

        try:
            # Publish termination audio message - use custom message from registry
            termination_message = event_orchestrator.termination_message or ""
            logger.info(f"Using termination message: {termination_message}")
            await publish_termination_audio(termination_message, session)

        except Exception as e:
            logger.exception(f"Error during termination audio playback: {e}")
        finally:
            # Shutdown the session - final score will be sent in on_shutdown
            ctx.shutdown("Session terminated")
            logger.info("Session shutdown completed")

    # This function creates a background task to handle session termination.
    # This is done to handle the case where termination event coming from
    # langgraph flow terminates without publishing audio.
    async def handle_termination(event: BaseEvent):
        """Wrapper to execute termination as a background task."""
        task = asyncio.create_task(handle_termination_task(event))
        logger.info(f"Termination background task created for event '{event.event_id}'")
        return task

    # Set the termination callback
    event_orchestrator.termination_callback = handle_termination

    async def on_shutdown():
        """Cleanup callback when session is shutting down."""
        nonlocal final_score_sent
        logger.debug("Shutdown callback triggered")

        # Send deferred termination event to Core (if any).
        # Termination events are sent here AFTER the agent has finished
        # speaking the termination message, ensuring the backend doesn't
        # close the room prematurely when it receives the event with
        # autoTerminationStatus=true.
        if event_orchestrator.deferred_termination_event:
            logger.info(
                f"Sending deferred termination event "
                f"{event_orchestrator.deferred_termination_event.event_id} "
                f"to Core"
            )
            try:
                event_dict = serialize_event(
                    event_orchestrator.deferred_termination_event,
                    termination_event_id=event_orchestrator.termination_event_id,
                    termination_message=event_orchestrator.termination_message,
                )
                core_event_message = CoreEventMessageType.create(
                    room_id=ctx.room.name, event_data=event_dict
                )
                await msg_event_queue.send_message(
                    message_body=core_event_message.model_dump_json()
                )
                logger.info("Deferred termination event sent to Core successfully")
            except Exception as e:
                logger.error(f"Failed to send deferred termination event: {e}")

        # Send final score after speaking and after pushing termination event
        if not final_score_sent:
            logger.info("Sending final score to backend in on_shutdown")
            try:
                await send_final_score_to_core(
                    room_id=ctx.room.name,
                    thread_id=ctx.room.name,
                    event_orchestrator=event_orchestrator,
                )
                final_score_sent = True
                logger.info("Final score sent successfully in on_shutdown")
            except Exception as e:
                logger.error(f"Failed to send final score in on_shutdown: {e}")
        else:
            logger.info(
                "Final score already sent, skipping duplicate send in on_shutdown"
            )

        logger.info("Shutdown initiated")

    ctx.add_shutdown_callback(on_shutdown)

    # Create LLM adapter
    agent_adapter = LLMAdapter(
        graph=agent_graph,
        config={
            "configurable": {
                "thread_id": ctx.room.name,
                "room": ctx.room,
                "scenario": scenario,
                "agent_joined_at": joined_iso,
                "event_orchestrator": event_orchestrator,
            }
        },
    )

    # Create agent
    agent = Assistant(llm=agent_adapter)

    # Register conversation handler
    session.on("conversation_item_added")(
        create_conversation_handler(ctx.room.name, joined_iso)
    )

    # Start session
    await session.start(
        room=ctx.room,
        agent=agent,
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )

    await ctx.connect()

    # Initialise only after session is connected
    await event_orchestrator.initialize()

    # Only say opening statement if termination hasn't been initiated
    if not event_orchestrator.is_termination_initiated():
        await session.say(random.choice(scenario.prompt_data.opening_statements))


def prewarm(proc: JobProcess):
    """Prewarm VAD model for faster startup."""
    proc.userdata["vad"] = silero.VAD.load(activation_threshold=0.7)


if __name__ == "__main__":
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
