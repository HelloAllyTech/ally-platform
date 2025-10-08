import json
import asyncio
from datetime import datetime, timezone
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
from livekit.api import (
    ListRoomsRequest
)
from app.core.constants import TTSProvider
from app.core.events.core_event_sender import CoreEventMessageType
from app.core.events.base import ChatMessage
from app.core.livekit.livekit_client import livekit_client
from app.core.queue import msg_event_queue
from app.core.config import settings
from app.core.events.event_list.similarity_based import *  # required to register the events - Don't Remove
from app.core.graph import agent_graph
from app.core.livekit.livekit_models import RoomMetadataEnvelope
from app.scenario_sample import SCENARIO_SAMPLE
from app.utils.logger import get_logger
from app.utils.opening_line import get_opening_line

logger = get_logger(__name__)

TTS_FACTORY = {
    TTSProvider.ELEVENLABS: lambda: elevenlabs.TTS(
        voice_id=settings.VOICE_ID,
        model="eleven_multilingual_v2",
        api_key=settings.ELEVEN_API_KEY,
    ),
    TTSProvider.DEEPGRAM: lambda: deepgram.TTS(
        model=settings.VOICE_ID,
        encoding="linear16",
        sample_rate=24000,
        api_key=settings.DEEPGRAM_API_KEY,
    ),
    TTSProvider.SARVAM: lambda: sarvam.TTS(
        target_language_code="en-IN",
        speaker=settings.VOICE_ID,
        api_key=settings.SARVAM_API_KEY,
    ),
}

def get_tts_config() -> object:
    """Lazily instantiate only the configured TTS provider."""
    factory = TTS_FACTORY.get(settings.TTS_PROVIDER)
    if not factory:
        raise ValueError(f"Unsupported TTS provider: {settings.TTS_PROVIDER}")
    return factory()

tts_config = get_tts_config()


class Assistant(Agent):
    def __init__(self, instructions: str = "You're a simulation client", **kwargs) -> None:
        super().__init__(instructions=instructions, **kwargs)


async def entrypoint(ctx: agents.JobContext):
    # Parse the metadata string to dict format expected by create method
    try:
        if not livekit_client.client:
            await livekit_client.init()

        rooms_response = await livekit_client.room.list_rooms(ListRoomsRequest())
        rooms = getattr(rooms_response, "rooms", [])
        logger.debug("Rooms retrieved:", rooms_response)

        room_name = str(ctx.room.name)

        room = next((r for r in rooms if r.name == room_name), None)
        if not room:
            raise ValueError(f"No room found with name {room_name}")

        if not room.metadata:
            logger.warning("Room has no metadata:", room_name)
            raise ValueError(f"Room {room_name} has no metadata")

        logger.debug("Room metadata raw:", room.metadata)
        metadata_dict = json.loads(room.metadata)
        rm_md_envelope = RoomMetadataEnvelope.create(metadata_dict)

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse room metadata JSON: {e}")
        rm_md_envelope = RoomMetadataEnvelope.create({})
    except ValueError as e:
        logger.error(f"Room validation error: {e}")
        rm_md_envelope = RoomMetadataEnvelope.create({})
    except AttributeError as e:
        logger.error(f"Missing expected attribute in room data: {e}")
        rm_md_envelope = RoomMetadataEnvelope.create({})
    except Exception as e:
        logger.exception("Unexpected error while fetching/parsing room metadata")
        rm_md_envelope = RoomMetadataEnvelope.create({})

    scenario = rm_md_envelope.scenario
    logger.debug(f"Events in scenario: {str(scenario.events)}")

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
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, num_idle_processes=1,
                                            api_key=settings.LIVEKIT_API_KEY,
                                            api_secret=settings.LIVEKIT_API_SECRET, ws_url=settings.LIVEKIT_URL,
                                            drain_timeout=10))
