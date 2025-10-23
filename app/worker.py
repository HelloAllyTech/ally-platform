import json
import asyncio
from datetime import datetime, timezone
from typing import Optional

from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions, JobProcess, ConversationItemAddedEvent
from livekit.plugins import (
    deepgram,
    noise_cancellation,
    silero,
    elevenlabs,
    sarvam
)
from livekit.plugins.langchain import LLMAdapter
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from app.core.constants import TTSProvider
from app.core.events.core_event_sender import CoreEventMessageType
from app.core.events.base import ChatMessage
from app.core.queue import msg_event_queue
from app.core.config import settings
from app.core.events.event_list.similarity_based import *  # required to register the events - Don't Remove
from app.core.graph import agent_graph
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from app.core.scenario.base import ScenarioVoice
from app.utils.logger import get_logger
from app.utils.opening_line import get_opening_line
from app.utils.tts_validator import validate_sarvam_voice, validate_deepgram_voice, validate_elevenlabs_voice

logger = get_logger(__name__)

TTS_FACTORY = {
    TTSProvider.ELEVENLABS: lambda: elevenlabs.TTS(
        voice_id=settings.VOICE_ID,
        model="eleven_multilingual_v2",
        api_key=settings.ELEVEN_API_KEY,
    ),
    TTSProvider.DEEPGRAM: lambda: deepgram.TTS(
        model=settings.MODEL,
        encoding="linear16",
        sample_rate=24000,
        api_key=settings.DEEPGRAM_API_KEY,
    ),
    TTSProvider.SARVAM: lambda: sarvam.TTS(
        target_language_code="en-IN",
        speaker=settings.SPEAKER,
        api_key=settings.SARVAM_API_KEY,
    ),
}

def get_default_tts_config() -> object:
    """Lazily instantiate only the configured TTS provider from environment settings."""
    factory = TTS_FACTORY.get(settings.TTS_PROVIDER)
    if not factory:
        raise ValueError(f"Unsupported TTS provider: {settings.TTS_PROVIDER}")
    return factory()

def validate_tts_config(provider: str, config) -> bool:
    """Validate config fields for each TTS provider."""
    try:
        if provider == TTSProvider.ELEVENLABS:
            return bool(config and getattr(config, "voice_id", None) and getattr(config, "model", None))
        elif provider == TTSProvider.DEEPGRAM:
            return bool(config and getattr(config, "model", None))
        elif provider == TTSProvider.SARVAM:
            return bool(config and getattr(config, "speaker", None))
        else:
            return False
    except Exception as e:
        logger.warning(f"TTS config validation failed for {provider}: {e}")
        return False


def get_provider_tts(provider: str, config):
    """Return a TTS instance for the specified provider."""
    provider = provider.lower()

    if provider == TTSProvider.ELEVENLABS:
        tts = elevenlabs.TTS(
            voice_id=config.voice_id,
            model=config.model,
            api_key=settings.ELEVEN_API_KEY,
        )
        if not validate_elevenlabs_voice(config.model, settings.ELEVEN_API_KEY, config.model):
            raise ValueError("Invalid ElevenLabs voice configuration")
        return tts

    elif provider == TTSProvider.DEEPGRAM:
        tts = deepgram.TTS(
            model=config.model,
            encoding="linear16",
            sample_rate=24000,
            api_key=settings.DEEPGRAM_API_KEY,
        )
        if not validate_deepgram_voice(config.model, settings.DEEPGRAM_API_KEY):
            raise ValueError("Invalid Deepgram voice configuration")
        return tts

    elif provider == TTSProvider.SARVAM:
        tts = sarvam.TTS(
            target_language_code="en-IN",
            speaker=config.speaker,
            api_key=settings.SARVAM_API_KEY,
        )
        if not validate_sarvam_voice(config.speaker, settings.SARVAM_API_KEY):
            raise ValueError("Invalid Sarvam voice configuration")
        return tts

    raise ValueError(f"Unsupported TTS provider: {provider}")

def get_tts_for_scenario(voice: Optional[ScenarioVoice]):
    """
    Returns a provider-specific TTS instance.
    Falls back to default if the given voice is invalid or missing.
    """
    default_tts = get_default_tts_config()

    if voice is None:
        return default_tts

    provider = voice.provider.lower()
    config = voice.config

    if not validate_tts_config(provider, config):
        logger.warning(f"Scenario {provider} config missing required fields, using default")
        return default_tts

    try:
        return get_provider_tts(provider, config)
    except Exception as e:
        logger.warning(f"Failed to load scenario-specific TTS config ({provider}): {e}")
        return default_tts

class Assistant(Agent):
    def __init__(self, instructions: str = "You're a simulation client", **kwargs) -> None:
        super().__init__(instructions=instructions, **kwargs)


async def entrypoint(ctx: agents.JobContext):
    # Parse the metadata from job context
    try:
        logger.debug("Job metadata raw: %s", ctx.job.metadata)
        metadata_dict = json.loads(ctx.job.metadata) if ctx.job.metadata else {}
        rm_md_envelope = RoomMetadataEnvelope.create(metadata_dict)

    except json.JSONDecodeError as e:
        logger.error("Failed to parse job metadata JSON: %s", e)
        rm_md_envelope = RoomMetadataEnvelope.create({})
    except Exception as e:
        logger.exception("Unexpected error while parsing job metadata")
        rm_md_envelope = RoomMetadataEnvelope.create({})

    scenario = rm_md_envelope.scenario
    logger.debug(f"Events in scenario: {str(scenario.events)}")

    # build TTS config dynamically from scenario voice
    try:
        tts_config = get_tts_for_scenario(scenario.voice)
    except Exception as e:
        logger.warning(f"Failed to load scenario-specific TTS config: {e}")
        tts_config = get_default_tts_config()

    agent_graph.update_state(
        {"configurable": {"thread_id": ctx.room.name}},
        values={
            "messages": [],
            "permitted_events": scenario.events,
            "events_accumulator": [],
            "new_events": [],
            "current_score": 0,
        },
    )

    joined_iso = datetime.now(timezone.utc).isoformat()

    agent_adapter = LLMAdapter(graph=agent_graph, config={
        "configurable": {
            "thread_id": ctx.room.name,
            "room": ctx.room,
            "scenario": scenario,
            "agent_joined_at": joined_iso,
        }
    })

    # Get VAD from pre-warm, or use None if loading failed
    vad = ctx.proc.userdata.get("vad")

    session = AgentSession(
        stt=deepgram.STT(
            model="nova-3",
            language="en-IN",
            api_key=settings.DEEPGRAM_API_KEY,
        ),
        tts=tts_config,
        vad=vad,
        turn_detection=MultilingualModel(),
    )

    agent = Assistant(llm=agent_adapter)

    @session.on("conversation_item_added")
    def on_conv_item(event: ConversationItemAddedEvent):
        role = "CLIENT" if event.item.role == "assistant" else "COUNSELOR"
        content = event.item.content if isinstance(event.item.content, str) else ""

        if isinstance(event.item.content, list):
            content = "".join(event.item.content)
        elif isinstance(event.item.content, str):
            content = event.item.content
        else:
            content = ""

        chat_message = ChatMessage(
            role=role,
            content=content,
            start_time=event.created_at - datetime.fromisoformat(
                joined_iso.replace('Z', '+00:00')).timestamp() if event.created_at else None,
            end_time=None
        )

        # Create core event message
        core_event = CoreEventMessageType.create(
            room_id=ctx.room.name,
            chat_message=chat_message,
        )

        # Push to queue
        logger.debug("Enqueuing core event to SQS")
        try:
            # Schedule async send to avoid blocking the audio loop
            asyncio.create_task(
                msg_event_queue.send_message(core_event.model_dump_json())
            )
        except RuntimeError:
            # Fallback if no running loop is found in this context
            asyncio.get_event_loop().create_task(
                msg_event_queue.send_message(core_event.model_dump_json())
            )

    await session.start(
        room=ctx.room,
        agent=agent,
        room_input_options=RoomInputOptions(
            # LiveKit Cloud enhanced noise cancellation
            # - If self-hosting, omit this parameter
            # - For telephony applications, use `BVCTelephony` for best results
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )

    await session.say(get_opening_line())

    await ctx.connect()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load(activation_threshold=0.7)


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(agent_name=settings.AGENT_NAME,entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, num_idle_processes=1,
                                            api_key=settings.LIVEKIT_API_KEY,
                                            api_secret=settings.LIVEKIT_API_SECRET, ws_url=settings.LIVEKIT_URL,
                                            drain_timeout=10))
