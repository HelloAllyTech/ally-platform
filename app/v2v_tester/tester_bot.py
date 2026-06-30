"""
V2V tester bot: simulated learner that joins a LiveKit room, listens to the
counselor AI, and responds using a cheap LLM + TTS voice.

Flow per exchange:
  counselor speaks → Deepgram streaming STT → final transcript
      → gpt-4o-mini generates learner reply
      → Deepgram Aura TTS synthesizes audio
      → audio frames published to LiveKit room

The bot disconnects after `max_exchanges` counselor→learner exchanges or a
configurable idle timeout.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import aiohttp
from livekit import rtc
from livekit.agents import stt as lk_stt
from livekit.plugins import deepgram
from openai import AsyncOpenAI

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

# ── Language mapping helpers ──────────────────────────────────────────────────

# Tester bot uses Deepgram Aura TTS (already wired in the system, no extra
# credentials).  Use a voice different from the counselor's so transcripts are
# distinguishable.  Deepgram Aura is English-only; non-English sessions will
# still work but the tester voice will have an English accent.
_TESTER_TTS_MODEL = "aura-2-andromeda-en"

# BCP-47 root → Deepgram language code (Deepgram uses ISO-639-1).
_DEEPGRAM_LANG: dict[str, str] = {
    "en": "en",
    "en-US": "en",
    "en-IN": "en",
    "hi": "hi",
    "hi-IN": "hi",
    "mr": "hi",   # Deepgram doesn't support Marathi; Hindi is the closest
    "mr-IN": "hi",
    "ta": "ta",
    "ta-IN": "ta",
    "te-IN": "te",
    "kn-IN": "kn",
    "ml-IN": "ml",
}


def _deepgram_lang(language: str) -> str:
    return _DEEPGRAM_LANG.get(language) or _DEEPGRAM_LANG.get(
        language.split("-")[0], "en"
    )


# ── System prompt for the simulated learner ───────────────────────────────────

_LEARNER_SYSTEM = """You are roleplaying as a trainee counselor practising \
their counseling skills. The person speaking to you is playing the role of \
the client/patient in a counselor-training simulation.

Scenario context (what the client is going through): {scenario_title}
{scenario_context_block}
Language: respond in {language}.

Guidelines:
- You are the COUNSELOR, not the client. Ask open-ended questions, reflect \
feelings, and show empathy.
- Keep every response SHORT — 1 to 2 sentences at most.
- Sound like a trainee counselor: warm but not perfect — occasional hesitation \
or rephrasing is natural.
- Do NOT give advice or diagnose. Focus on listening and exploring.
- Do NOT break character or mention that this is a simulation.
"""

# ── Tester bot ────────────────────────────────────────────────────────────────

# How long (seconds) to wait for the counselor to speak before giving up.
_IDLE_TIMEOUT_S = 90.0
# How long (seconds) of silence marks the end of a counselor utterance.
_SILENCE_GATE_S = 1.8


class V2VTesterBot:
    """Simulated learner participant for automated V2V testing."""

    def __init__(
        self,
        room_name: str,
        tester_token: str,
        max_exchanges: int,
        language: str,
        scenario_title: str,
        scenario_context: str,
        scenario_session_id: str,
        counselor_id: int,
    ) -> None:
        self.room_name = room_name
        self.tester_token = tester_token
        self.max_exchanges = max_exchanges
        self.language = language
        self.scenario_title = scenario_title
        self.scenario_context = scenario_context
        self.scenario_session_id = scenario_session_id
        self.counselor_id = counselor_id

        self._room: Optional[rtc.Room] = None
        self._audio_source: Optional[rtc.AudioSource] = None
        self._http_session: Optional[aiohttp.ClientSession] = None
        # Queue used to pass each counselor utterance to the main loop.
        self._utterance_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
        # Track tasks we need to cancel on shutdown.
        self._bg_tasks: set[asyncio.Task] = set()

    # ── Public entry point ────────────────────────────────────────────────────

    async def run(self) -> None:
        """Connect, converse for max_exchanges turns, then disconnect."""
        logger.info("[V2V] starting tester bot for room=%s", self.room_name)
        # Create the aiohttp session early so the track_subscribed handler
        # (registered below) can reference it via self._http_session.
        self._http_session = aiohttp.ClientSession()
        room = rtc.Room()
        self._room = room

        @room.on("track_subscribed")
        def _on_track_subscribed(
            track: rtc.Track,
            _pub: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ) -> None:
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                logger.info(
                    "[V2V] subscribed to audio from participant=%s",
                    participant.identity,
                )
                task = asyncio.create_task(
                    self._stream_and_transcribe(track, self._http_session),
                    name=f"v2v-stt-{participant.identity}",
                )
                self._bg_tasks.add(task)
                task.add_done_callback(self._bg_tasks.discard)

        @room.on("track_published")
        def _on_track_published(
            pub: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ) -> None:
            logger.info(
                "[V2V] track_published: participant=%s kind=%s sid=%s",
                participant.identity,
                pub.kind,
                pub.sid,
            )

        @room.on("participant_connected")
        def _on_participant_connected(participant: rtc.RemoteParticipant) -> None:
            logger.info(
                "[V2V] participant_connected: identity=%s kind=%s",
                participant.identity,
                participant.kind,
            )

        await room.connect(
            settings.LIVEKIT_URL,
            self.tester_token,
            options=rtc.RoomOptions(auto_subscribe=True),
        )
        logger.info("[V2V] joined room=%s as v2v-tester", self.room_name)

        # Log who is already in the room when we join.
        existing = list(room.remote_participants.values())
        if existing:
            for p in existing:
                logger.info(
                    "[V2V] existing participant: identity=%s kind=%s tracks=%d",
                    p.identity,
                    p.kind,
                    len(p.track_publications),
                )
        else:
            logger.info("[V2V] no other participants in room yet — waiting for counselor")

        # Publish a microphone track so the agent can hear us.
        # Deepgram TTS outputs 24 kHz linear16 by default — AudioSource must
        # match or LiveKit rejects the frames with an InvalidState error.
        self._audio_source = rtc.AudioSource(
            sample_rate=24000, num_channels=1, queue_size_ms=1000
        )
        local_track = rtc.LocalAudioTrack.create_audio_track(
            "v2v-learner-mic", self._audio_source
        )
        pub_options = rtc.TrackPublishOptions()
        pub_options.source = rtc.TrackSource.SOURCE_MICROPHONE
        await room.local_participant.publish_track(local_track, pub_options)

        tts = deepgram.TTS(
            model=_TESTER_TTS_MODEL,
            api_key=settings.DEEPGRAM_API_KEY,
            http_session=self._http_session,
        )
        llm = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        # Build the system prompt once.
        context_block = (
            f"Context: {self.scenario_context}" if self.scenario_context else ""
        )
        system_prompt = _LEARNER_SYSTEM.format(
            scenario_title=self.scenario_title or "general counselling session",
            scenario_context_block=context_block,
            language=self.language,
        )
        conversation: list[dict] = []

        try:
            await self._converse(tts, llm, system_prompt, conversation, self._http_session)
        finally:
            for t in list(self._bg_tasks):
                t.cancel()
            # End the session on ally-be so summary generation fires in both
            # local dev (no room_finished webhook) and production.
            await self._end_session_on_backend(self._http_session)
            await self._http_session.close()
            await room.disconnect()
            logger.info("[V2V] disconnected from room=%s", self.room_name)

    # ── Conversation loop ─────────────────────────────────────────────────────

    async def _converse(
        self,
        tts: deepgram.TTS,
        llm: AsyncOpenAI,
        system_prompt: str,
        conversation: list[dict],
        http_session: aiohttp.ClientSession,
    ) -> None:
        for exchange_idx in range(self.max_exchanges):
            logger.info(
                "[V2V] waiting for counselor utterance (exchange %d/%d)",
                exchange_idx + 1,
                self.max_exchanges,
            )
            try:
                counselor_text = await asyncio.wait_for(
                    self._utterance_queue.get(), timeout=_IDLE_TIMEOUT_S
                )
            except asyncio.TimeoutError:
                logger.info("[V2V] counselor idle timeout — ending session")
                return

            if not counselor_text or not counselor_text.strip():
                logger.debug("[V2V] empty counselor utterance, skipping")
                continue

            logger.info("[V2V] counselor said: %r", counselor_text[:120])

            # Add counselor turn to history.
            conversation.append({"role": "assistant", "content": counselor_text})

            # Generate a short learner reply.
            learner_reply = await self._generate_reply(
                llm, system_prompt, conversation
            )
            if not learner_reply:
                continue

            logger.info("[V2V] learner reply: %r", learner_reply[:120])
            conversation.append({"role": "user", "content": learner_reply})

            # Speak the reply.
            await self._speak(tts, learner_reply)

        logger.info("[V2V] max_exchanges=%d reached", self.max_exchanges)

    # ── Session end ───────────────────────────────────────────────────────────

    async def _end_session_on_backend(self, http_session: aiohttp.ClientSession) -> None:
        """
        Call ally-be's internal end-v2v endpoint so summary generation runs
        in local dev (no room_finished webhook) and production alike.
        """
        url = (
            f"{settings.CORE_SERVICE_BASE_URL}/api/v1/learn/scenario-session"
            f"/{self.scenario_session_id}/end-v2v"
        )
        headers = {
            "x-api-key": settings.CORE_SERVICE_API_KEY,
            "Content-Type": "application/json",
        }
        payload = {"counselorId": self.counselor_id}
        try:
            async with http_session.post(url, json=payload, headers=headers) as resp:
                if resp.status == 200:
                    logger.info(
                        "[V2V] session ended on backend: session=%s",
                        self.scenario_session_id,
                    )
                else:
                    body = await resp.text()
                    logger.warning(
                        "[V2V] end-session returned %d for session=%s: %s",
                        resp.status,
                        self.scenario_session_id,
                        body[:200],
                    )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[V2V] end-session call failed for session=%s: %s",
                self.scenario_session_id,
                exc,
            )

    # ── STT: stream counselor audio → transcript ──────────────────────────────

    async def _stream_and_transcribe(self, track: rtc.Track, http_session: aiohttp.ClientSession) -> None:
        """
        Subscribe to a remote audio track and emit utterances to
        _utterance_queue as the counselor finishes each sentence.

        Uses Deepgram streaming STT + a silence-gate timer.  When
        _SILENCE_GATE_S of silence is detected we flush and collect the
        partial transcript accumulated so far.
        """
        stt_plugin = deepgram.STT(
            model="nova-2",
            language=_deepgram_lang(self.language),
            api_key=settings.DEEPGRAM_API_KEY,
            http_session=http_session,
        )
        audio_stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
        stt_stream = stt_plugin.stream()

        # Debounce multiple FINAL_TRANSCRIPT chunks from one counselor utterance
        # into a single queue entry.  Deepgram often splits one sentence into
        # 2-3 finals; without debouncing each chunk triggers a separate exchange.
        pending_chunks: list[str] = []
        flush_handle: Optional[asyncio.TimerHandle] = None
        collect_loop = asyncio.get_event_loop()

        def _flush_pending() -> None:
            nonlocal flush_handle
            flush_handle = None
            if pending_chunks:
                utterance = " ".join(pending_chunks).strip()
                pending_chunks.clear()
                logger.info("[V2V] STT utterance (debounced): %r", utterance[:120])
                asyncio.ensure_future(self._utterance_queue.put(utterance))

        async def _collect() -> None:
            nonlocal flush_handle
            async for ev in stt_stream:
                if ev.type == lk_stt.SpeechEventType.FINAL_TRANSCRIPT:
                    text = ev.alternatives[0].text if ev.alternatives else ""
                    if text.strip():
                        pending_chunks.append(text)
                        # Reset the debounce window on each new chunk.
                        if flush_handle is not None:
                            flush_handle.cancel()
                        flush_handle = collect_loop.call_later(1.5, _flush_pending)

        collector = asyncio.create_task(_collect(), name="v2v-stt-collect")
        self._bg_tasks.add(collector)
        collector.add_done_callback(self._bg_tasks.discard)

        # Feed loop: push frames and use a silence gate to flush the STT
        # stream when the counselor stops speaking.
        silence_deadline: Optional[asyncio.TimerHandle] = None
        loop = asyncio.get_event_loop()

        def _schedule_flush() -> None:
            nonlocal silence_deadline
            if silence_deadline is not None:
                silence_deadline.cancel()
            silence_deadline = loop.call_later(_SILENCE_GATE_S, _do_flush)

        def _do_flush() -> None:
            logger.debug("[V2V] silence gate fired — flushing STT stream")
            stt_stream.flush()

        try:
            async for audio_event in audio_stream:
                stt_stream.push_frame(audio_event.frame)
                _schedule_flush()
        except Exception:  # noqa: BLE001
            logger.debug("[V2V] audio stream ended", exc_info=True)
        finally:
            if silence_deadline:
                silence_deadline.cancel()
            await stt_stream.aclose()

    # ── LLM: generate learner reply ───────────────────────────────────────────

    async def _generate_reply(
        self,
        llm: AsyncOpenAI,
        system_prompt: str,
        conversation: list[dict],
    ) -> str:
        try:
            resp = await asyncio.wait_for(
                llm.chat.completions.create(
                    model="gpt-4o-mini",
                    max_tokens=80,
                    temperature=0.8,
                    messages=[{"role": "system", "content": system_prompt}, *conversation],
                ),
                timeout=15.0,
            )
            return (resp.choices[0].message.content or "").strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[V2V] LLM error: %s", exc)
            return ""

    # ── TTS: synthesize and publish audio frames ──────────────────────────────

    async def _speak(self, tts: deepgram.TTS, text: str) -> None:
        if not self._audio_source or not text:
            return
        try:
            stream = tts.synthesize(text)
            async for ev in stream:
                frame = getattr(ev, "frame", None)
                if frame is not None:
                    await self._audio_source.capture_frame(frame)
            aclose = getattr(stream, "aclose", None)
            if aclose is not None:
                try:
                    await aclose()
                except Exception:  # noqa: BLE001
                    pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("[V2V] TTS error: %s", exc)


# ── Background task launcher (called from the FastAPI router) ─────────────────

def launch_tester(
    room_name: str,
    tester_token: str,
    max_exchanges: int,
    language: str,
    scenario_title: str,
    scenario_context: str,
    scenario_session_id: str,
    counselor_id: int,
) -> asyncio.Task:
    """
    Spawn the tester bot as a fire-and-forget asyncio task and return the task
    so callers can attach callbacks or cancel on shutdown.
    """
    bot = V2VTesterBot(
        room_name=room_name,
        tester_token=tester_token,
        max_exchanges=max_exchanges,
        language=language,
        scenario_title=scenario_title,
        scenario_context=scenario_context,
        scenario_session_id=scenario_session_id,
        counselor_id=counselor_id,
    )
    task = asyncio.create_task(bot.run(), name=f"v2v-tester-{room_name}")

    def _log_done(t: asyncio.Task) -> None:
        exc = t.exception() if not t.cancelled() else None
        if exc:
            logger.error("[V2V] tester bot failed for room=%s: %s", room_name, exc)
        else:
            logger.info("[V2V] tester bot finished for room=%s", room_name)

    task.add_done_callback(_log_done)
    return task
