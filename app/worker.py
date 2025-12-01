import random

from datetime import datetime, timezone
from livekit import agents, rtc
from livekit.agents import AgentSession, Agent, RoomInputOptions, JobProcess
from livekit.agents.cli.log import setup_logging
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.langchain import LLMAdapter
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from app.core.config import settings
from app.core.constants import Environment
from app.core.language import DEFAULT_LANGUAGE_CODE
from app.core.graph import agent_graph
from app.core.events.base import BaseEvent
from app.core.events.event_registry.event_registry import EventRegistry
from app.core.embeddings import OpenAIEmbeddingClient
from app.utils.logger import get_logger
from app.tts import get_tts_for_scenario, get_default_tts_config
from app.stt import create_stt_client
from app.utils.metadata_parser import parse_room_metadata
from app.utils.event_handler import create_conversation_handler

logger = get_logger(__name__)
setup_logging(settings.LIVEKIT_LOG_LEVEL, devmode=settings.LIVEKIT_LOG_DEV_MODE, console=settings.LIVEKIT_LOG_CONSOLE)


class Assistant(Agent):
    """Custom agent implementation."""

    def __init__(self, instructions: str = "You're a simulation client", **kwargs) -> None:
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
        turn_detection=MultilingualModel(),
    )


async def publish_termination_audio(room: rtc.Room, tts_config, message: str) -> None:
    """
    Synthesize and publish termination message as audio.

    Args:
        room: LiveKit room instance
        tts_config: TTS configuration (Deepgram/ElevenLabs/Sarvam)
        message: Termination message to convert to audio
    """
    try:
        logger.info(f"Publishing termination audio: '{message}'")

        # Synthesize text to audio using TTS
        audio_stream = tts_config.synthesize(message)

        # Get the first frame to determine audio properties
        first_synthesized_audio = await audio_stream.__anext__()
        first_frame = first_synthesized_audio.frame

        # Create audio source with matching sample rate and channels
        audio_source = rtc.AudioSource(first_frame.sample_rate, first_frame.num_channels)
        track = rtc.LocalAudioTrack.create_audio_track("termination_audio", audio_source)

        # Publish the audio track
        publication = await room.local_participant.publish_track(track)
        logger.info(f"Audio track published: {publication.sid}")

        # Capture and stream all audio frames
        await audio_source.capture_frame(first_frame)
        async for synthesized_audio in audio_stream:
            await audio_source.capture_frame(synthesized_audio.frame)

        # Wait for audio playback to complete
        await audio_source.wait_for_playout()
        logger.info("Termination audio playback completed")

    except Exception as e:
        logger.exception(f"Failed to publish termination audio: {e}")
        raise


async def entrypoint(ctx: agents.JobContext):
    """Main agent entrypoint handling room connection and conversation flow."""

    # Create a single embedding client for all semantic similarity events in this agent call
    embedding_client = OpenAIEmbeddingClient(model=settings.OPENAI_EMBEDDING_MODEL, api_key=settings.OPENAI_API_KEY)
    logger.debug("Created shared embedding client for semantic similarity events")

    # Initialize class-level embedding client for SemanticSimilarityEvent (once per session)
    from app.core.events.event_types.semantic_similarity.semantic_similarity_event import SemanticSimilarityEvent
    SemanticSimilarityEvent._EMBEDDING_CLIENT = embedding_client

    # Parse metadata with error handling
    rm_md_envelope = parse_room_metadata(ctx.job.metadata, embedding_client=embedding_client)
    scenario = rm_md_envelope.scenario
    logger.debug(f"Events in scenario: {str(scenario.events)}")

    # Get language code from scenario
    language_code = DEFAULT_LANGUAGE_CODE
    if scenario.language_config:
        language_code = scenario.language_config.language_code

    # Configure STT
    try:
        stt_client = create_stt_client(language_code)
        stt_config = stt_client.stt_instance
    except Exception as e:
        logger.warning(f"STT config failed, using default: {e}")
        stt_client = create_stt_client(DEFAULT_LANGUAGE_CODE)
        stt_config = stt_client.stt_instance

    # Configure TTS
    try:
        # Pass language_code if available from scenario's language_config
        tts_config = get_tts_for_scenario(scenario.voice, scenario.prompt_data.gender, language_code=language_code)
    except Exception as e:
        logger.warning(f"TTS config failed, using default: {e}")
        tts_config = get_default_tts_config(scenario.prompt_data.gender)

    # Initialize state
    initialize_agent_state(ctx.room.name, scenario)
    joined_iso = datetime.now(timezone.utc).isoformat()

    # Setup session
    vad = ctx.proc.userdata.get("vad")
    session = create_agent_session(tts_config, vad, stt_config)

    # Initialize EventRegistry (termination callback will be set below)
    event_registry = EventRegistry(
        scenario=scenario,
        termination_callback=None,  # Set after defining the callback
        room=ctx.room,
        thread_id=ctx.room.name
    )
    logger.info(f"Initialized EventRegistry with {len(scenario.events)} events")

    async def handle_termination(event: BaseEvent):
        """Handle session termination when a termination event occurs."""
        logger.info(f"Termination event '{event.event_id}' triggered. Initiating shutdown...")

        try:
            # Publish termination audio message - use custom message from registry
            termination_message = event_registry.termination_message or ""
            logger.info(f"Using termination message: {termination_message}")
            await publish_termination_audio(ctx.room, tts_config, termination_message)


        except Exception as e:
            logger.exception(f"Error during termination cleanup: {e}")
        finally:
            # Shutdown the session
            ctx.shutdown("Session terminated")
            logger.info("Session shutdown completed")

    # Set the termination callback
    event_registry.termination_callback = handle_termination

    await event_registry.initialize()

    async def on_shutdown():
        """Cleanup callback when session is shutting down."""
        logger.debug("Shutdown callback triggered")

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
                "event_registry": event_registry,
            }
        }
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

    await session.say(random.choice(scenario.prompt_data.opening_statements))
    await ctx.connect()


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
