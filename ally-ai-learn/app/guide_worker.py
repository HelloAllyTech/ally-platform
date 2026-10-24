"""The Ally guide's voice worker — its own entry point and deployment.

    python -m app.guide_worker dev     # local
    python -m app.guide_worker start   # deployed (see start-guide.sh)

ally-be dispatches this worker, by name (``LIVEKIT_GUIDE_AGENT_NAME``, default
``${AGENT_NAME}Guide``), into a ``guide-`` room when a learner turns on voice
in a guided course. It never takes roleplay capacity, and the roleplay worker
never serves it.

The worker is speech in, speech out. Each final transcript goes to ally-be
(``POST /v1/guide/voice/turns``) and the reply that streams back is spoken;
ally-be runs the whole turn — safety, course logic, the model. Nothing here
calls a model. Docs: docs/guide-voice-worker.md. Plan: plans/ally-guide §7.9.
"""

from __future__ import annotations

import asyncio
from typing import Optional, Set

from livekit import agents, rtc
from livekit.agents import AgentSession, JobProcess
from livekit.agents.voice.room_io import AudioInputOptions, RoomOptions
from livekit.plugins import noise_cancellation, silero

from app.core.config import settings
from app.core.constants import DEFAULT_VAD_ACTIVATION_THRESHOLD
from app.core.guide.agent import BackendRelayLLM, GuideVoiceAgent
from app.core.guide.client import (
    GuideBackendClient,
    GuideBackendError,
    GuideSessionEnded,
)
from app.core.guide.crisis import DeliveryState, SpeakingRate
from app.core.guide.ledger import SpokenReplyLedger
from app.core.guide.lines import LeaveReason, leave_line
from app.core.guide.session import (
    GuideVoiceDispatch,
    GuideVoiceSessionInfo,
    parse_dispatch,
)
from app.core.guide.speech import (
    build_stt_client,
    build_tts_client,
    resolve_speech_config,
    resolve_turn_detection,
)
from app.core.guide.turns import GuideVoiceTurns
from app.core.guide.usage import GuideVoiceMetrics
from app.core.livekit.audio_filters import (
    session_livekit_url,
    supports_noise_cancellation,
)
from app.core.logger import (
    get_logger,
    make_child_logging_forward_only,
    patch_livekit_parent_logger,
    setup_livekit_logging,
)
from app.core.tasks import spawn_background_task

# The multilingual EOU runner must be registered at import, before the worker
# starts, or its inference process is never created (see app/worker.py).
if settings.SEMANTIC_TURN_DETECTION_ENABLED:
    from livekit.plugins.turn_detector import (  # noqa: F401
        multilingual as _eou_multilingual,
    )

logger = get_logger(__name__)

setup_livekit_logging(
    settings.LIVEKIT_LOG_LEVEL,
    devmode=settings.LIVEKIT_LOG_DEV_MODE,
    console=settings.LIVEKIT_LOG_CONSOLE,
)

#: Longest the worker waits for its parting line to play before leaving.
LEAVE_LINE_TIMEOUT_S = 20.0
#: ally-be lookups at startup before giving up on the session.
SESSION_LOOKUP_ATTEMPTS = 3

#: Push-to-talk RPC methods the browser calls on the agent participant.
RPC_START_TURN = "start_turn"
RPC_END_TURN = "end_turn"
RPC_CANCEL_TURN = "cancel_turn"


def guide_agent_name() -> str:
    return settings.LIVEKIT_GUIDE_AGENT_NAME or f"{settings.AGENT_NAME}Guide"


async def resolve_session(
    client: GuideBackendClient,
    token: str,
    *,
    attempts: int = SESSION_LOOKUP_ATTEMPTS,
    backoff_s: float = 0.5,
) -> tuple[Optional[GuideVoiceSessionInfo], Optional[LeaveReason]]:
    """The session the token belongs to, or why the worker must leave.

    401 means the session is over (expired, or replaced by a newer one); it is
    not retried. ally-be being unreachable is retried a few times first.
    """
    for attempt in range(1, max(1, attempts) + 1):
        try:
            return await client.get_session(token), None
        except GuideSessionEnded:
            return None, LeaveReason.SESSION_ENDED
        except GuideBackendError as exc:
            logger.warning(
                "[GUIDE] voice session lookup failed (%s), attempt %d/%d",
                exc.code,
                attempt,
                attempts,
            )
            if attempt < attempts:
                await asyncio.sleep(backoff_s * attempt)
    return None, LeaveReason.UNAVAILABLE


class GuideVoiceWorker:
    """One Ally voice session: from dispatch to the learner leaving."""

    def __init__(
        self,
        ctx: agents.JobContext,
        *,
        client: Optional[GuideBackendClient] = None,
    ) -> None:
        self.ctx = ctx
        self.client = client or GuideBackendClient.from_settings()
        self.dispatch: Optional[GuideVoiceDispatch] = None
        self.info: Optional[GuideVoiceSessionInfo] = None
        self.language = "en"
        self.session: Optional[AgentSession] = None
        self.turns: Optional[GuideVoiceTurns] = None
        self.ledger = SpokenReplyLedger()
        self.delivery = DeliveryState()
        self._finished = asyncio.Event()
        self._finish_reason = "guide_session_over"
        self._leaving = False
        self._token_dead = False
        self._tasks: Set[asyncio.Task] = set()

    # -- lifecycle ----------------------------------------------------------

    async def run(self) -> None:
        self.dispatch = parse_dispatch(self.ctx.job.metadata)
        if self.dispatch is None:
            self.ctx.shutdown("guide_bad_dispatch")
            return
        self.ctx.add_shutdown_callback(self._on_job_shutdown)
        token = self.dispatch.voice_session_token

        info, leave_reason = await resolve_session(self.client, token)
        if info is not None and info.room_name != self.ctx.room.name:
            # A token for another room: never act on that thread from here.
            logger.error("[GUIDE] voice session belongs to a different room")
            info, leave_reason = None, LeaveReason.SESSION_ENDED
        if leave_reason is LeaveReason.SESSION_ENDED:
            self._token_dead = True
        self.info = info
        self.language = info.language if info else self.dispatch.language
        turn_mode = info.turn_mode if info else self.dispatch.turn_mode

        speech = resolve_speech_config(self.language)
        stt_client = build_stt_client(speech)
        tts_client = build_tts_client(speech)
        tts = tts_client.tts_instance
        vad = self.ctx.proc.userdata.get("vad")
        turn_detection, endpointing = resolve_turn_detection(
            self.language, turn_mode, vad
        )

        self.turns = GuideVoiceTurns(
            self.client,
            token=token,
            language=self.language,
            ledger=self.ledger,
            delivery=self.delivery,
            on_leave=self.request_leave,
            busy_retries=settings.GUIDE_TURN_BUSY_RETRIES,
            busy_retry_delay_s=settings.GUIDE_TURN_BUSY_RETRY_DELAY_S,
            slow_turn_after_s=settings.GUIDE_SLOW_TURN_LINE_AFTER_S,
        )
        agent = GuideVoiceAgent(
            self.turns,
            self.delivery,
            speaking_rate=SpeakingRate(tts),
            crisis_rate=settings.GUIDE_CRISIS_SPEAKING_RATE,
            crisis_pause_s=settings.GUIDE_CRISIS_SENTENCE_PAUSE_S,
        )
        # preemptive_generation stays off (the default): each preemptive
        # generation would post a turn to ally-be on a transcript that may
        # still change.
        self.session = AgentSession(
            stt=stt_client.stt_instance,
            tts=tts,
            vad=vad,
            llm=BackendRelayLLM(),
            turn_detection=turn_detection,
            **endpointing,
        )
        metrics = GuideVoiceMetrics(
            self.ctx.room.name,
            thread_id=info.thread_id if info else None,
            stt_meta=speech.stt_meta,
            tts_meta=speech.tts_meta,
        )
        self._register_handlers(metrics)

        await self.session.start(
            agent=agent, room=self.ctx.room, room_options=self._room_options()
        )
        await self.ctx.connect()
        if turn_mode == "push_to_talk":
            self._enable_push_to_talk()
        logger.info(
            "[GUIDE] voice session live: language=%s turn_mode=%s turn_detection=%s",
            self.language,
            turn_mode,
            (
                type(turn_detection).__name__
                if not isinstance(turn_detection, str)
                else turn_detection
            ),
        )

        if leave_reason is not None:
            self.request_leave(leave_reason)
        else:
            # Ally doesn't speak first: the learner opened voice to talk.
            self._spawn(self._await_learner(), "guide-await-learner")

        await self._finished.wait()
        self.ctx.shutdown(self._finish_reason)

    def _room_options(self) -> RoomOptions:
        url = session_livekit_url(self.ctx, settings.LIVEKIT_URL)
        bvc = None
        if supports_noise_cancellation(
            url, enabled=getattr(settings, "LIVEKIT_NOISE_CANCELLATION_ENABLED", False)
        ):
            bvc = self.ctx.proc.userdata.get("bvc") or noise_cancellation.BVC()
        return RoomOptions(
            # Typed messages go through ally-be's HTTP API, never the room.
            text_input=False,
            audio_input=AudioInputOptions(noise_cancellation=bvc),
            # Captions: transcriptions go out on lk.transcription (default on).
            close_on_disconnect=True,
        )

    def _register_handlers(self, metrics: GuideVoiceMetrics) -> None:
        session = self.session
        assert session is not None

        @session.on("conversation_item_added")
        def _on_item(event) -> None:
            item = getattr(event, "item", None)
            if getattr(item, "role", None) == "assistant":
                self.ledger.on_assistant_message(
                    item.text_content or "",
                    interrupted=bool(getattr(item, "interrupted", False)),
                )

        session.on("metrics_collected", metrics.on_metrics_collected)
        session.on("user_state_changed", metrics.on_user_state_changed)
        session.on("agent_state_changed", metrics.on_agent_state_changed)

        @session.on("close")
        def _on_close(event) -> None:
            raw = getattr(event, "reason", None)
            reason = getattr(raw, "value", raw)
            if getattr(event, "error", None) is not None:
                logger.error(
                    "[GUIDE] voice session closed on an error: %s", event.error
                )
            self._finish(f"guide_session_closed_{reason or 'unknown'}")

        @self.ctx.room.on("disconnected")
        def _on_disconnected(*_) -> None:
            self._finish("guide_room_disconnected")

    def _enable_push_to_talk(self) -> None:
        """Push-to-talk over RPC (LiveKit's manual turn detection): the browser
        calls ``start_turn`` when the learner presses, ``end_turn`` on release,
        ``cancel_turn`` to discard. Pressing talk while Ally speaks is the
        barge-in."""
        session = self.session
        assert session is not None
        session.input.set_audio_enabled(False)
        participant = self.ctx.room.local_participant

        async def start_turn(_: rtc.RpcInvocationData) -> str:
            if self._leaving:
                return "leaving"
            try:
                session.interrupt()
            except RuntimeError:
                pass  # nothing interruptible is playing
            session.clear_user_turn()
            session.input.set_audio_enabled(True)
            return "ok"

        async def end_turn(_: rtc.RpcInvocationData) -> str:
            session.input.set_audio_enabled(False)
            if self._leaving:
                session.clear_user_turn()
                return "leaving"
            session.commit_user_turn(transcript_timeout=10.0)
            return "ok"

        async def cancel_turn(_: rtc.RpcInvocationData) -> str:
            session.input.set_audio_enabled(False)
            session.clear_user_turn()
            return "ok"

        participant.register_rpc_method(RPC_START_TURN, start_turn)
        participant.register_rpc_method(RPC_END_TURN, end_turn)
        participant.register_rpc_method(RPC_CANCEL_TURN, cancel_turn)

    # -- leaving --------------------------------------------------------------

    def request_leave(self, reason: LeaveReason) -> None:
        """Say the parting line for ``reason``, then leave. Idempotent."""
        if self._leaving:
            return
        self._leaving = True
        if reason is LeaveReason.SESSION_ENDED:
            self._token_dead = True
        if self.turns is not None:
            self.turns.close()
        self._spawn(self._leave(reason), "guide-leave")

    async def _leave(self, reason: LeaveReason) -> None:
        line = leave_line(reason, self.language)
        logger.info("[GUIDE] leaving the voice session: %s", reason.value)
        try:
            assert self.session is not None
            handle = self.session.say(
                line, allow_interruptions=False, add_to_chat_ctx=False
            )
            await asyncio.wait_for(handle.wait_for_playout(), LEAVE_LINE_TIMEOUT_S)
        except Exception:  # noqa: BLE001 - leave even if the line can't play
            logger.warning("[GUIDE] parting line did not play", exc_info=True)
        self._finish(f"guide_{reason.value}")

    async def _await_learner(self) -> None:
        try:
            await asyncio.wait_for(
                self.ctx.wait_for_participant(),
                settings.GUIDE_PARTICIPANT_JOIN_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            logger.warning("[GUIDE] the learner never joined; leaving")
            self._finish("guide_no_learner")

    def _finish(self, reason: str) -> None:
        if not self._finished.is_set():
            self._finish_reason = reason
            self._finished.set()

    async def _on_job_shutdown(self, reason: str) -> None:
        """Every way out ends the session in ally-be, so its token stops
        working; then the HTTP client closes."""
        if self.dispatch is not None and not self._token_dead:
            await self.client.end_session(self.dispatch.voice_session_token)
        await self.client.aclose()

    def _spawn(self, coro, name: str) -> None:
        spawn_background_task(coro, name=name, background_tasks=self._tasks)


async def entrypoint(ctx: agents.JobContext) -> None:
    worker = GuideVoiceWorker(ctx)
    try:
        await worker.run()
    except Exception:
        # Raising alone leaves the job hanging un-joined (see app/worker.py's
        # entrypoint): shut it down so the failure is visible.
        logger.exception("[GUIDE] voice session failed to start")
        ctx.shutdown("guide_startup_failed")
        raise


def prewarm(proc: JobProcess) -> None:
    """Per-process models, as the roleplay worker prewarms them: VAD always,
    Krisp BVC best-effort."""
    make_child_logging_forward_only()
    proc.userdata["vad"] = silero.VAD.load(
        activation_threshold=DEFAULT_VAD_ACTIVATION_THRESHOLD
    )
    try:
        proc.userdata["bvc"] = noise_cancellation.BVC()
    except Exception as exc:  # noqa: BLE001 - best-effort
        logger.warning("[PREWARM] BVC prewarm skipped: %s", exc)


def main() -> None:
    patch_livekit_parent_logger()
    # Count this fleet's sessions under its own CloudWatch dimension, never
    # the roleplay fleet's (the scaling signal there must stay roleplay-only).
    settings.ECS_METRICS_SERVICE = settings.GUIDE_ECS_METRICS_SERVICE

    from app.core.worker_health import start_health_monitor, wrap_load_fnc
    from app.core.worker_metrics import make_load_fnc

    start_health_monitor()
    load_fnc = wrap_load_fnc(make_load_fnc())
    load_kwargs = {"load_fnc": load_fnc} if load_fnc is not None else {}

    agents.cli.run_app(
        agents.WorkerOptions(
            # Always the explicit name, even locally: ally-be dispatches the
            # guide by name, and an empty name would auto-join every room.
            agent_name=guide_agent_name(),
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            **load_kwargs,
            num_idle_processes=2,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
            ws_url=settings.LIVEKIT_URL,
            drain_timeout=600,
            max_retry=360,
            job_memory_warn_mb=650,
            initialize_process_timeout=120,
            shutdown_process_timeout=30,
        )
    )


if __name__ == "__main__":
    main()
