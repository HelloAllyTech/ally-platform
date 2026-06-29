"""Simulated-user agent for superadmin V2V test sessions.

This is a SECOND LiveKit agent that joins a roleplay room and plays the
COUNSELOR / learner side over real voice, so it drives the existing client agent
through a full voice-to-voice session without a human tester. The client agent
(app/worker.py) is unchanged and still records the canonical transcript + turn
metrics — from its perspective this agent is simply "the counselor", so test
runs show up in the session logs exactly like human sessions.

Design (deliberately lightweight vs the client worker):
  * No LangGraph, no events/behaviors/scoring/prosody — just a conversational
    agent with the editable ``testing/simulated_user`` system prompt.
  * Cheap providers (Deepgram STT/TTS, gpt-4o-mini) since audio quality and
    nuance don't matter for a test harness.
  * Registers under its own agent name (SIMULATED_USER_AGENT_NAME) so Core can
    dispatch it into the same room as the client agent.

Metadata contract (Core puts this in the simulated-user dispatch metadata):
  {"simulated_user": {
      "scenario_context": "<who the client is + competency to practice>",
      "language_label": "English (US)",
      "language_code": "en-US",
      "max_exchanges": 12
  }}
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict

from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions
from livekit.agents.cli.log import setup_logging
from livekit.plugins import deepgram, openai, silero

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)
setup_logging(
    settings.LIVEKIT_LOG_LEVEL,
    devmode=settings.LIVEKIT_LOG_DEV_MODE,
    console=settings.LIVEKIT_LOG_CONSOLE,
)


def prewarm(proc: agents.JobProcess) -> None:
    """Load VAD once per process (same pattern as the client worker)."""
    proc.userdata["vad"] = silero.VAD.load()


def _parse_simulated_user_config(raw_metadata: str | None) -> Dict[str, Any]:
    """Pull the ``simulated_user`` block out of the room/job metadata."""
    try:
        parsed = json.loads(raw_metadata or "{}")
    except json.JSONDecodeError:
        logger.warning("[SIM_USER] invalid job metadata; using defaults")
        return {}
    cfg = parsed.get("simulated_user")
    return cfg if isinstance(cfg, dict) else {}


def _build_instructions(cfg: Dict[str, Any]) -> str:
    """Render the editable simulated-user system prompt with scenario context."""
    language_code = cfg.get("language_code") or DEFAULT_LANGUAGE_CODE
    return load_and_format(
        "testing/simulated_user",
        prompt_data=None,
        scenario_context=cfg.get("scenario_context") or "",
        language_label=cfg.get("language_label") or language_code,
        language_code=language_code,
        max_exchanges=int(cfg.get("max_exchanges") or 12),
    )


async def entrypoint(ctx: JobContext) -> None:
    """Join the room as the counselor-side agent and run the conversation."""
    await ctx.connect()
    cfg = _parse_simulated_user_config(ctx.job.metadata)
    max_exchanges = int(cfg.get("max_exchanges") or 12)
    instructions = _build_instructions(cfg)
    logger.info(
        "[SIM_USER] starting room=%s max_exchanges=%d lang=%s",
        ctx.room.name,
        max_exchanges,
        cfg.get("language_code"),
    )

    vad = ctx.proc.userdata.get("vad") or silero.VAD.load()
    session = AgentSession(
        stt=deepgram.STT(),
        llm=openai.LLM(model=settings.SIMULATED_USER_LLM_MODEL),
        tts=deepgram.TTS(model=settings.SIMULATED_USER_TTS_MODEL),
        vad=vad,
        turn_detection="vad",
    )
    agent = Agent(instructions=instructions)

    # Track how many turns the simulated user has spoken so the test session
    # self-terminates instead of running forever. Also flags whether the client
    # agent has spoken yet (so we know if we need to open the conversation).
    state = {"sim_turns": 0, "heard_client": False, "closing": False}

    @session.on("agent_state_changed")
    def _on_state(ev) -> None:  # noqa: ANN001 - livekit event object
        # Each transition into "speaking" is one simulated-user turn.
        if getattr(ev, "new_state", None) == "speaking":
            state["sim_turns"] += 1
            if state["sim_turns"] >= max_exchanges and not state["closing"]:
                state["closing"] = True
                logger.info(
                    "[SIM_USER] reached %d exchanges — ending after this turn",
                    max_exchanges,
                )
                task = asyncio.create_task(_end_session(ctx, session))
                # keep a ref so it isn't GC'd mid-flight
                state["_end_task"] = task

    @session.on("user_input_transcribed")
    def _on_user_input(_ev) -> None:  # noqa: ANN001
        # Any transcribed remote speech means the client agent has spoken.
        state["heard_client"] = True

    await session.start(room=ctx.room, agent=agent)

    # Deadlock guard: the client agent normally opens (scenario opening
    # statement). If nothing is heard within the grace window, open ourselves.
    asyncio.create_task(_maybe_open(session, state))


async def _maybe_open(session: AgentSession, state: Dict[str, Any]) -> None:
    """Open the conversation if the client agent hasn't spoken in time."""
    try:
        await asyncio.sleep(settings.SIMULATED_USER_OPENING_GRACE_SECONDS)
        if not state["heard_client"] and state["sim_turns"] == 0:
            logger.info("[SIM_USER] client silent — opening the conversation")
            session.generate_reply(
                instructions="Greet the client warmly and open the conversation."
            )
    except asyncio.CancelledError:
        pass
    except Exception as e:  # noqa: BLE001 - best-effort opener
        logger.warning("[SIM_USER] opener failed: %s", e)


async def _end_session(ctx: JobContext, session: AgentSession) -> None:
    """Let the closing line play out, then end the V2V test session.

    Deletes the LiveKit room so the backend's room_finished webhook fires,
    which calls endScenarioSession and generates the transcript + summary.
    Simply calling ctx.shutdown() only disconnects this agent; the client
    agent remains in the room and the room_finished webhook never fires,
    so no transcript or summary is ever produced.
    """
    try:
        # Give the final (goodbye) utterance time to finish before tearing down.
        await asyncio.sleep(8.0)
    except asyncio.CancelledError:
        return

    room_name = ctx.room.name
    try:
        from livekit import api as lk_api

        lk = lk_api.LiveKitAPI(
            url=settings.LIVEKIT_URL,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        )
        try:
            await lk.room.delete_room(lk_api.DeleteRoomRequest(room=room_name))
            logger.info(
                "[SIM_USER] deleted room=%s — room_finished webhook will "
                "trigger endScenarioSession and generate transcript+summary",
                room_name,
            )
        finally:
            await lk.aclose()
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "[SIM_USER] room deletion failed for room=%s: %s — "
            "falling back to ctx.shutdown()",
            room_name,
            e,
        )
        try:
            ctx.shutdown(reason="simulated_user_session_complete")
        except Exception as e2:  # noqa: BLE001
            logger.warning("[SIM_USER] shutdown error: %s", e2)


if __name__ == "__main__":
    # Always register under an explicit agent name (even in LOCAL): the
    # simulated user must ONLY join rooms it is explicitly dispatched to (V2V
    # test sessions), never auto-join normal rooms like the client worker does.
    agent_name = settings.SIMULATED_USER_AGENT_NAME
    agents.cli.run_app(
        WorkerOptions(
            agent_name=agent_name,
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            num_idle_processes=1,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
            ws_url=settings.LIVEKIT_URL,
            drain_timeout=120,
        )
    )
