import random

from datetime import datetime, timezone
from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions, JobProcess
from livekit.agents.cli.log import setup_logging
from livekit.plugins import deepgram, noise_cancellation, silero
from livekit.plugins.langchain import LLMAdapter
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from app.core.config import settings
from app.core.constants import Environment
from app.core.graph import agent_graph
from app.utils.logger import get_logger
from app.tts import get_tts_for_scenario, get_default_tts_config
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
        },
    )


def create_agent_session(tts_config, vad) -> AgentSession:
    """Create and configure agent session with STT, TTS, and VAD."""
    return AgentSession(
        stt=deepgram.STT(
            model="nova-3",
            language="en-IN",
            api_key=settings.DEEPGRAM_API_KEY,
        ),
        tts=tts_config,
        vad=vad,
        turn_detection=MultilingualModel(),
    )


async def entrypoint(ctx: agents.JobContext):
    """Main agent entrypoint handling room connection and conversation flow."""

    # Parse metadata with error handling
    rm_md_envelope = parse_room_metadata(ctx.job.metadata)
    scenario = rm_md_envelope.scenario
    logger.debug(f"Events in scenario: {str(scenario.events)}")

    # Configure TTS
    try:
        # Pass language_code if available from scenario's language_config
        language_code = None
        if scenario.language_config:
            language_code = scenario.language_config.language_code
        tts_config = get_tts_for_scenario(scenario.voice, scenario.prompt_data.gender, language_code=language_code)
    except Exception as e:
        logger.warning(f"TTS config failed, using default: {e}")
        tts_config = get_default_tts_config(scenario.prompt_data.gender)

    # Initialize state
    initialize_agent_state(ctx.room.name, scenario)
    joined_iso = datetime.now(timezone.utc).isoformat()

    # Create LLM adapter
    agent_adapter = LLMAdapter(
        graph=agent_graph,
        config={
            "configurable": {
                "thread_id": ctx.room.name,
                "room": ctx.room,
                "scenario": scenario,
                "agent_joined_at": joined_iso,
            }
        }
    )

    # Setup session
    vad = ctx.proc.userdata.get("vad")
    session = create_agent_session(tts_config, vad)
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