"""
V2V tester bot: simulated learner that joins a LiveKit room, listens to the
counselor AI, and responds using a cheap LLM + TTS voice.

Flow per exchange:
  counselor speaks → streaming STT (language-appropriate provider) → transcript
      → gpt-4o-mini generates learner reply
      → language-appropriate TTS synthesizes audio
      → audio frames published to LiveKit room

Provider selection mirrors the live platform (via the app.stt/app.tts
factories): Google STT + TTS for every language (see the constants below),
with a tester voice distinct from the counselor voices. Previously both STT
and TTS were hardcoded to Deepgram, so a Malayalam test had an
English-accented tester voice the counselor's Sarvam STT could not reliably
transcribe; Deepgram itself is gone from the platform since 2026-10-19.

The bot disconnects after `max_exchanges` counselor→learner exchanges or a
configurable idle timeout.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import aiohttp
from livekit import rtc
from livekit.agents import stt as lk_stt
from openai import AsyncOpenAI

from app.core.config import settings
from app.core.livekit.video_actor import is_avatar_participant
from app.core.llm_usage.emitter import emit_openai_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import get_logger

logger = get_logger(__name__)

# ── Language mapping helpers ──────────────────────────────────────────────────

# Tester providers: Google STT + TTS ONLY (per Gopi 2026-08-06). Google's
# streaming APIs tolerate idle/silence (unlike Sarvam's WS, which drops
# connections fed silence every ~15s and ate utterances landing in reconnect
# windows), support all our Indian languages, and need no per-provider
# special-casing. Requires valid Google ADC on the host (mounted gcloud
# config) — expired ADC makes both sides silently fail, so _make_stt/_make_tts
# failures surface loudly at bot start rather than mid-conversation.
# Voice: let Google pick a female voice for the session language — distinct
# from the counselor voice catalog's picks, and valid for every locale
# without maintaining a voice map.
_GOOGLE_STT_MODEL = "chirp_2"
_GOOGLE_STT_LOCATION = "asia-southeast1"


def _pick_google_voice_sync(language: str) -> Optional[str]:
    """Pick a voice for the language (prefer female Chirp3-HD).

    Chirp3-HD voices reject the plugin's default PCM encoding (Google 400
    "Unsupported audio encoding", non-retryable) — the same quirk the agent's
    GoogleTTSClient works around with OGG_OPUS (handled in _make_tts).

    Sync gRPC client — call via _pick_google_voice so the event loop isn't
    blocked; the channel is closed explicitly (it does not die with the
    function, and leaked channels held threads + memory across tester runs).
    """
    try:
        from google.cloud import texttospeech

        client = texttospeech.TextToSpeechClient()
        try:
            voices = client.list_voices(language_code=language).voices
        finally:
            client.transport.close()
        female = [
            v for v in voices if v.ssml_gender == texttospeech.SsmlVoiceGender.FEMALE
        ]
        # Prefer Chirp3-HD: natural prosody survives the agent's audio
        # pipeline far better than flat Wavenet/Standard synthesis (and it
        # is closer to what a real learner sounds like).
        chirp = [v for v in (female or voices) if "Chirp3-HD" in v.name]
        pick = (chirp or female or list(voices) or [None])[0]
        return pick.name if pick else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("[V2V] voice discovery failed for %s: %s", language, exc)
        return None


async def _pick_google_voice(language: str) -> Optional[str]:
    return await asyncio.get_event_loop().run_in_executor(
        None, _pick_google_voice_sync, language
    )


def should_take_over_stt(
    *, current_sid: Optional[str], current_is_avatar: bool, new_identity: str
) -> bool:
    """Whether a newly subscribed audio track should replace the STT source.

    ONE STT pipeline per run is the rule — transcribing every audio track ran a
    duplicate streaming recognizer for the whole session. The single exception
    is a video actor attaching mid-session.

    A video-enabled roleplay starts audio-only and moves the character's speech
    onto the avatar's track once it renders (see
    app/core/livekit/video_actor.py), which leaves the agent's own track
    published and silent. A tester that keeps listening to it goes deaf from
    the attach onward and reports utterances_heard=1 and an idle timeout — a
    failure indistinguishable from a broken agent. So the avatar takes over,
    once, and nothing takes over from the avatar.
    """
    if current_sid is None:
        return True
    return is_avatar_participant(new_identity) and not current_is_avatar


async def _make_tts(language: str, http_session: aiohttp.ClientSession):
    """Google TTS for the tester, any language."""
    from google.cloud import texttospeech
    from livekit.plugins import google

    voice = await _pick_google_voice(language)
    logger.info("[V2V] tester google voice for %s: %s", language, voice or "auto")
    kwargs: dict = {"language": language, "gender": "female"}
    if voice:
        kwargs["voice_name"] = voice
        if "Chirp" in voice:
            # Chirp voices need BOTH workarounds the agent's GoogleTTSClient
            # carries: an explicit chirp_3 model_name (otherwise the plugin
            # infers a Gemini model and Google rejects the pairing) and
            # OGG_OPUS encoding (Chirp rejects the plugin's default PCM).
            kwargs["model_name"] = "chirp_3"
            kwargs["audio_encoding"] = texttospeech.AudioEncoding.OGG_OPUS
    return google.TTS(**kwargs)


def _make_stt(language: str, http_session: aiohttp.ClientSession):
    """Google streaming STT (chirp_2) for the tester, any language."""
    from livekit.plugins import google

    return google.STT(
        languages=[language],
        model=_GOOGLE_STT_MODEL,
        location=_GOOGLE_STT_LOCATION,
        interim_results=False,
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

# The tester's model, for both its replies and the role-fidelity judge.
_TESTER_MODEL = "gpt-4o-mini"

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
        # Run metrics, shipped to ally-be on end (metadata.v2vMetrics) and
        # logged as [V2V_METRICS] — the evaluation baseline Gopi asked for.
        self._metrics: dict = {
            "maxExchanges": max_exchanges,
            "exchangesCompleted": 0,
            "utterancesHeard": 0,
            # Degenerate STT captures (very short fragments like a lone
            # "ഇറങ്ങുന്നു.") — a per-run signal of transcription trouble AND
            # the inputs that stress the agent's coherence guardrail.
            "sttFragments": 0,
            "ttsFailures": 0,
            # Learner turns the end-of-run judge flags as breaking the
            # counselor role (the tester LLM occasionally answers as the
            # client) — tester-quality signal so agent metrics aren't
            # polluted by a misbehaving tester.
            "roleDriftTurns": None,
            "endReason": "unknown",
        }
        self._http_session: Optional[aiohttp.ClientSession] = None
        # Queue used to pass each counselor utterance to the main loop.
        self._utterance_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
        # Track tasks we need to cancel on shutdown.
        self._bg_tasks: set[asyncio.Task] = set()
        # The single audio track the STT pipeline is attached to (the agent
        # publishes more than one; transcribing each doubled the pipelines).
        self._stt_track_sid: Optional[str] = None
        # The task running STT over _stt_track_sid, so a video actor attaching
        # mid-session can take the pipeline over from the agent's own track.
        self._stt_task: Optional[asyncio.Task] = None
        self._stt_on_avatar = False

    # ── Public entry point ────────────────────────────────────────────────────

    async def run(self) -> None:
        """Connect, converse for max_exchanges turns, then disconnect.

        Every resource acquired here is released in the single finally below
        — including on failures during setup (room connect, voice discovery,
        TTS creation). The pre-fix version only guarded the conversation
        loop, so an early failure leaked a connected rtc.Room + aiohttp
        session in the worker process per attempt, which is how repeated
        broken launches drove the container's memory up.
        """
        room = None
        tts = None
        llm = None
        connected = False
        try:
            # Create the aiohttp session early so the track_subscribed handler
            # (registered below) can reference it via self._http_session.
            self._http_session = aiohttp.ClientSession()
            room = rtc.Room()
            self._room = room

            @room.on("track_subscribed")
            def _on_track_subscribed(
                track: rtc.Track,
                pub: rtc.RemoteTrackPublication,
                participant: rtc.RemoteParticipant,
            ) -> None:
                if track.kind != rtc.TrackKind.KIND_AUDIO:
                    return
                # The agent publishes TWO audio tracks: its voice (AgentSession
                # room output) and the comfort/filler "background_audio" track
                # (BackgroundAudioPlayer). Publish ORDER is not stable across
                # agent versions — a 2026-08 release flipped it and the tester
                # spent whole runs transcribing comfort noise (utterances_heard=0,
                # idle_timeout). Select by publication NAME, never by order.
                if pub.name == "background_audio":
                    logger.info(
                        "[V2V] skipping background_audio track %s from %s",
                        track.sid,
                        participant.identity,
                    )
                    return
                # ONE STT pipeline per run, except when a video actor attaches
                # mid-session and takes the character's speech with it — see
                # should_take_over_stt.
                if not should_take_over_stt(
                    current_sid=self._stt_track_sid,
                    current_is_avatar=self._stt_on_avatar,
                    new_identity=participant.identity,
                ):
                    logger.info(
                        "[V2V] ignoring extra audio track from %s (STT already "
                        "attached to %s)",
                        participant.identity,
                        self._stt_track_sid,
                    )
                    return
                if self._stt_track_sid is not None:
                    logger.info(
                        "[V2V] video actor attached — moving STT from %s to %s's "
                        "track %s, where the character's speech now is",
                        self._stt_track_sid,
                        participant.identity,
                        track.sid,
                    )
                    if self._stt_task is not None and not self._stt_task.done():
                        self._stt_task.cancel()
                else:
                    logger.info(
                        "[V2V] subscribed to audio from participant=%s",
                        participant.identity,
                    )
                self._stt_track_sid = track.sid
                self._stt_on_avatar = is_avatar_participant(participant.identity)
                task = asyncio.create_task(
                    self._stream_and_transcribe(track, self._http_session),
                    name=f"v2v-stt-{participant.identity}",
                )
                self._stt_task = task
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
            connected = True
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
                logger.info(
                    "[V2V] no other participants in room yet — waiting for counselor"
                )

            # Create the TTS first: AudioSource's sample rate must match the
            # TTS output rate or LiveKit rejects the frames with an
            # InvalidState error.
            tts = await _make_tts(self.language, self._http_session)
            tts_sample_rate = int(getattr(tts, "sample_rate", 24000) or 24000)
            logger.info(
                "[V2V] tester providers: tts=%s (rate=%d) language=%s",
                type(tts).__module__,
                tts_sample_rate,
                self.language,
            )

            # Publish a microphone track so the agent can hear us.
            self._audio_source = rtc.AudioSource(
                sample_rate=tts_sample_rate, num_channels=1, queue_size_ms=1000
            )
            local_track = rtc.LocalAudioTrack.create_audio_track(
                "v2v-learner-mic", self._audio_source
            )
            pub_options = rtc.TrackPublishOptions()
            pub_options.source = rtc.TrackSource.SOURCE_MICROPHONE
            await room.local_participant.publish_track(local_track, pub_options)
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
            self._conversation = conversation

            await self._converse(
                tts, llm, system_prompt, conversation, self._http_session
            )
        finally:
            for t in list(self._bg_tasks):
                t.cancel()
            # End the session on ally-be so summary generation fires in both
            # local dev (no room_finished webhook) and production. Only when
            # the run got far enough to have a session to end.
            if connected:
                await self._end_session_on_backend(self._http_session)
            # Close every provider client — leaked gRPC channels / httpx
            # pools survive the run and accumulate in the worker process.
            for closable in (tts, llm, self._audio_source):
                aclose = getattr(closable, "aclose", None) or getattr(
                    closable, "close", None
                )
                if aclose is None:
                    continue
                try:
                    result = aclose()
                    if asyncio.iscoroutine(result):
                        await result
                except Exception:  # noqa: BLE001
                    logger.debug("[V2V] provider close failed", exc_info=True)
            await self._http_session.close()
            if connected:
                await room.disconnect()
            logger.info("[V2V] disconnected from room=%s", self.room_name)

    # ── Conversation loop ─────────────────────────────────────────────────────

    async def _converse(
        self,
        tts,
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
                self._metrics["endReason"] = "idle_timeout"
                return

            if not counselor_text or not counselor_text.strip():
                logger.debug("[V2V] empty counselor utterance, skipping")
                continue

            logger.info("[V2V] counselor said: %r", counselor_text[:120])

            # Add counselor turn to history.
            conversation.append({"role": "assistant", "content": counselor_text})

            # Generate a short learner reply.
            learner_reply = await self._generate_reply(llm, system_prompt, conversation)
            if not learner_reply:
                continue

            logger.info("[V2V] learner reply: %r", learner_reply[:120])
            conversation.append({"role": "user", "content": learner_reply})

            # Speak the reply.
            await self._speak(tts, learner_reply)
            self._metrics["exchangesCompleted"] = exchange_idx + 1

        logger.info("[V2V] max_exchanges=%d reached", self.max_exchanges)
        self._metrics["endReason"] = "max_exchanges"

    # ── Session end ───────────────────────────────────────────────────────────

    async def _assess_role_fidelity(self) -> None:
        """One cheap end-of-run judge call: count learner turns that broke
        the counselor role (the tester LLM occasionally answers as the
        client). Tester-quality metric — keeps a misbehaving tester from
        polluting the agent's evaluation. Best-effort; None when skipped."""
        learner_turns = [
            m["content"]
            for m in getattr(self, "_conversation", [])
            if m.get("role") == "user"
        ]
        if not learner_turns:
            return
        try:
            from openai import AsyncOpenAI

            llm = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(learner_turns))
            resp = await asyncio.wait_for(
                llm.chat.completions.create(
                    model=_TESTER_MODEL,
                    max_tokens=20,
                    temperature=0,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "The numbered lines are turns spoken by a "
                                "TRAINEE COUNSELOR in a counseling role-play. "
                                "A turn breaks role if the speaker talks as "
                                "the CLIENT (describing their own stress or "
                                "problems as the one seeking help) instead of "
                                "counseling. Reply with ONLY the count of "
                                "role-breaking turns as an integer."
                            ),
                        },
                        {"role": "user", "content": numbered},
                    ],
                ),
                timeout=15.0,
            )
            self._record_usage(resp, LLMTask.V2V_ROLE_FIDELITY_JUDGE)
            text = (resp.choices[0].message.content or "").strip()
            digits = "".join(ch for ch in text if ch.isdigit())
            if digits:
                self._metrics["roleDriftTurns"] = int(digits)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[V2V] role-fidelity check failed: %s", exc)

    async def _end_session_on_backend(
        self, http_session: aiohttp.ClientSession
    ) -> None:
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
        await self._assess_role_fidelity()
        logger.info(
            "[V2V_METRICS] room=%s exchanges=%d/%d utterances_heard=%d "
            "stt_fragments=%d tts_failures=%d role_drift=%s end_reason=%s",
            self.room_name,
            self._metrics["exchangesCompleted"],
            self._metrics["maxExchanges"],
            self._metrics["utterancesHeard"],
            self._metrics["sttFragments"],
            self._metrics["ttsFailures"],
            self._metrics["roleDriftTurns"],
            self._metrics["endReason"],
        )
        payload = {"counselorId": self.counselor_id, "metrics": self._metrics}
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

    async def _stream_and_transcribe(
        self, track: rtc.Track, http_session: aiohttp.ClientSession
    ) -> None:
        """
        Subscribe to a remote audio track and emit utterances to
        _utterance_queue as the counselor finishes each sentence.

        Uses language-appropriate streaming STT + a silence-gate timer.  When
        _SILENCE_GATE_S of silence is detected we flush and collect the
        partial transcript accumulated so far.
        """
        stt_plugin = _make_stt(self.language, http_session)
        audio_stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
        stt_stream = stt_plugin.stream()

        # Debounce multiple FINAL_TRANSCRIPT chunks from one counselor utterance
        # into a single queue entry.  Streaming STT often splits one sentence
        # into 2-3 finals; without debouncing each chunk triggers a separate
        # exchange.
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
                self._metrics["utterancesHeard"] += 1
                if len(utterance) < 20:
                    self._metrics["sttFragments"] += 1
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

        # NOTE: frames are pushed UNGATED. An RMS energy gate (added for
        # Sarvam, whose WS dropped silence-fed connections) backfired with
        # Google streaming STT: starving the stream of audio during quiet
        # periods triggered "stream timed out, restarting", and an utterance
        # arriving mid-restart was lost (run 9's final exchange). Google's
        # plugin keeps the stream healthy on continuous audio, silence
        # included, and manages its own 5-minute restarts.
        try:
            async for audio_event in audio_stream:
                stt_stream.push_frame(audio_event.frame)
                _schedule_flush()
        except Exception:  # noqa: BLE001
            logger.debug("[V2V] audio stream ended", exc_info=True)
        finally:
            if silence_deadline:
                silence_deadline.cancel()
            if flush_handle is not None:
                flush_handle.cancel()
            await stt_stream.aclose()
            # rtc.AudioStream and the STT plugin instance both hold native /
            # gRPC resources beyond the stream object closed above.
            await audio_stream.aclose()
            plugin_close = getattr(stt_plugin, "aclose", None)
            if plugin_close is not None:
                try:
                    await plugin_close()
                except Exception:  # noqa: BLE001
                    logger.debug("[V2V] stt plugin close failed", exc_info=True)

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
                    model=_TESTER_MODEL,
                    max_tokens=80,
                    temperature=0.8,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        *conversation,
                    ],
                ),
                timeout=15.0,
            )
            self._record_usage(resp, LLMTask.V2V_TESTER_REPLY)
            return (resp.choices[0].message.content or "").strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[V2V] LLM error: %s", exc)
            return ""

    def _record_usage(self, completion, task: LLMTask) -> None:
        """Record a tester call to ``llm_usage`` against the room and session
        under test, under a tester label so Core can keep it out of that
        session's delivery cost. Schedules the send and returns at once;
        never raises."""
        emit_openai_usage(
            completion,
            task=task.value,
            model=_TESTER_MODEL,
            room_id=self.room_name,
            scenario_session_id=self.scenario_session_id or None,
        )

    # ── TTS: synthesize and publish audio frames ──────────────────────────────

    async def _speak(self, tts, text: str) -> None:
        """Synthesize and publish the reply. Retries once: a single dropped
        synthesis deadlocks the whole run (the counselor never hears the
        reply, so both sides wait until the idle timeout — observed live at
        exchange 11/14 with a retryable Sarvam WS blip)."""
        for attempt in (1, 2):
            if await self._speak_once(tts, text):
                return
            logger.warning("[V2V] TTS attempt %d failed; retrying", attempt)
        self._metrics["ttsFailures"] += 1
        logger.warning("[V2V] TTS failed after retry; reply dropped")

    async def _speak_once(self, tts, text: str) -> bool:
        if not self._audio_source or not text:
            return True
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
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("[V2V] TTS error: %s", exc)
            return False


# ── Background task launcher (called from the FastAPI router) ─────────────────


# Live tester tasks in THIS worker process. A tester run costs ~200MB
# (rtc room + streaming STT/TTS pipelines) on containers that have OOM'd
# before, so concurrent runs per process are hard-capped.
_active_testers: set[asyncio.Task] = set()


def active_tester_count() -> int:
    return len(_active_testers)


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

    Raises RuntimeError when the per-process concurrency cap
    (V2V_TESTER_MAX_CONCURRENT) is already reached — the router surfaces
    this as HTTP 429.
    """
    if len(_active_testers) >= settings.V2V_TESTER_MAX_CONCURRENT:
        raise RuntimeError(
            f"v2v tester concurrency cap reached "
            f"({settings.V2V_TESTER_MAX_CONCURRENT} active in this process)"
        )
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
    _active_testers.add(task)

    def _log_done(t: asyncio.Task) -> None:
        _active_testers.discard(t)
        exc = t.exception() if not t.cancelled() else None
        if exc:
            logger.error("[V2V] tester bot failed for room=%s: %s", room_name, exc)
        else:
            logger.info("[V2V] tester bot finished for room=%s", room_name)

    task.add_done_callback(_log_done)
    return task
