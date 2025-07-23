from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import (
    openai,
    deepgram,
    noise_cancellation,
    silero,
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel
import logging

from app.core.config import settings
from app.utils.prompt import PROMPT_TEMPLATES, AI_AGENT_PROMPT
from app.core.scenario.scenario_types import ScenarioType
from app.utils.logger import get_logger

logger = get_logger(__name__)

# Map scenario types to appropriate TTS voices
SCENARIO_VOICE_MAPPING = {
    ScenarioType.HOPELESS_MALE: "aura-2-atlas-en",
    ScenarioType.BURNOUT_TECH_PROFESSIONAL: "aura-2-apollo-en",
    ScenarioType.ANXIOUS_STUDENT: "aura-2-cordelia-en",
    ScenarioType.DEPRESSED_WORKING_MOTHER: "aura-2-helena-en",
    ScenarioType.GRIEVING_RETIRED_MALE: "aura-2-zeus-en",
    ScenarioType.SUICIDAL_TEEN: "aura-2-iris-en"
}

# Default voice if scenario type doesn't match
DEFAULT_VOICE = "aura-2-atlas-en"


class Assistant(Agent):
    def __init__(self, instructions: str = AI_AGENT_PROMPT) -> None:
        super().__init__(instructions=instructions)


async def entrypoint(ctx: agents.JobContext):
    # Extract script_type from room name
    script_type = ScenarioType.HOPELESS_MALE  # Default script type
    
    try:
        # TODO: script_type is currently passed due to Livekit not returning metadata
        # Simply get the second part of the room name (index 1)
        room_name_parts = ctx.room.name.split('_')
        if len(room_name_parts) > 1:
            extracted_script_type = room_name_parts[1]
            # Check if the extracted value matches any ScenarioType enum value
            try:
                scenario_type = ScenarioType(extracted_script_type)
                if scenario_type in PROMPT_TEMPLATES:
                    script_type = scenario_type
                    logger.info(f"Using script type from room name: {script_type}")
                else:
                    logger.warning(f"Script type not in PROMPT_TEMPLATES: {scenario_type}, using default: {script_type}")
            except ValueError:
                logger.warning(f"Invalid script type in room name: {extracted_script_type}, using default: {script_type}")
    except Exception as e:
        logger.error(f"Error extracting script type: {str(e)}")
    
    # Get the appropriate prompt from the templates
    selected_prompt = PROMPT_TEMPLATES.get(script_type, AI_AGENT_PROMPT)
    
    # Get the appropriate voice for the scenario
    voice_model = SCENARIO_VOICE_MAPPING.get(script_type, DEFAULT_VOICE)
    logger.info(f"Using voice model for scenario {script_type}: {voice_model}")

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="multi", api_key=settings.DEEPGRAM_API_KEY),
        llm=openai.LLM(model="gpt-4o-mini", api_key=settings.OPENAI_API_KEY),
        tts=deepgram.TTS(model=voice_model, encoding="linear16", sample_rate=24000,
                         api_key=settings.DEEPGRAM_API_KEY),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    await session.start(
        room=ctx.room,
        agent=Assistant(instructions=selected_prompt),
        room_input_options=RoomInputOptions(
            # LiveKit Cloud enhanced noise cancellation
            # - If self-hosting, omit this parameter
            # - For telephony applications, use `BVCTelephony` for best results
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )

    await ctx.connect()


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint, api_key=settings.LIVEKIT_API_KEY,
                                           api_secret=settings.LIVEKIT_API_SECRET, ws_url=settings.LIVEKIT_URL))
