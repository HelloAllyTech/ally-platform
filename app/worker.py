from livekit import agents
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import (
    openai,
    deepgram,
    noise_cancellation,
    silero,
)
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from app.core.config import settings
from app.utils.prompt import AI_AGENT_PROMPT


class Assistant(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=AI_AGENT_PROMPT)


async def entrypoint(ctx: agents.JobContext):
    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language="multi", api_key=settings.DEEPGRAM_API_KEY),
        llm=openai.LLM(model="gpt-4o-mini", api_key=settings.OPENAI_API_KEY),
        tts=deepgram.TTS(model="aura-asteria-en", encoding="linear16", sample_rate=24000,
                         api_key=settings.DEEPGRAM_API_KEY),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    await session.start(
        room=ctx.room,
        agent=Assistant(),
        room_input_options=RoomInputOptions(
            # LiveKit Cloud enhanced noise cancellation
            # - If self-hosting, omit this parameter
            # - For telephony applications, use `BVCTelephony` for best results
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )

    await ctx.connect()

    await session.generate_reply(
        instructions="Greet the user and offer your assistance."
    )


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint, api_key=settings.LIVEKIT_API_KEY,
                                            api_secret=settings.LIVEKIT_API_SECRET, ws_url=settings.LIVEKIT_URL))
