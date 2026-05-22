#!/usr/bin/env python3
"""load-test-agent.py — spin up N concurrent bot-vs-bot conversations against
LiveKit Cloud so the locally-running ally-ai-learn worker has to handle them
in parallel. Designed to reproduce mid-conversation freezes.

Each fake participant is itself an LLM-driven user: it subscribes to the
agent's audio track, transcribes incoming speech with Whisper, generates a
contextual reply with gpt-4o-mini while roleplaying the user described in
SCENARIO_SAMPLE, then speaks the reply via OpenAI TTS. Real turn-taking,
real LLM history growth — the same conditions where your users report the
"stuck thinking" freeze.

Run from ally-ai-learn's poetry env so livekit + livekit-api + openai are
available:

    cd ally-ai-learn
    poetry run python scripts/load-test-agent.py --sessions 7 --duration 300

Before running, restart the worker with diagnostics on so freezes leave a trail:

    AGENT_DIAGNOSTICS_INTERVAL=10 docker restart <ally-ai-learn-container>

Sessions are auto-cleaned (rooms deleted) on normal exit and Ctrl+C.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import sys
import time
import uuid
import wave
from pathlib import Path
from typing import List, Optional

HERE = Path(__file__).parent
# Script lives in ally-ai-learn/scripts/; scenario_sample.py is at the project
# root one level up.
PROJECT_ROOT = HERE.parent
sys.path.insert(0, str(PROJECT_ROOT))

from livekit import api, rtc  # noqa: E402

from scenario_sample import SCENARIO_SAMPLE  # noqa: E402

# ============================================================================
# helpers
# ============================================================================


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


START = time.monotonic()


def log(session_tag: str, msg: str) -> None:
    elapsed = time.monotonic() - START
    print(f"[{elapsed:6.1f}s] [{session_tag}] {msg}", flush=True)


def build_role_prompt() -> str:
    """Construct a system prompt that makes the LLM stay in character as the
    user described in SCENARIO_SAMPLE.prompt_data. We don't try to be clever —
    just hand the model the same fields the real scenario uses, in plain
    English, so it acts like a coherent user."""
    pd = SCENARIO_SAMPLE["scenario"]["promptData"]
    return f"""You are role-playing a USER seeking help, talking to an AI coach.
You are NOT the coach. You are the person in distress.

Your character:
  name: {pd.get('name')}
  age: {pd.get('age')}
  gender: {pd.get('gender')}
  profession: {pd.get('profession')}
  current emotional state: {pd.get('startingState')}
  tone: {pd.get('tone')}
  personality: {pd.get('personality')}
  emotional needs: {pd.get('emotionalNeeds')}
  context: {pd.get('lifeHistory')}

Rules:
- Stay in character. Speak in first person as {pd.get('name')}.
- Keep replies SHORT — one to three sentences, like real speech.
- Don't break character to ask the coach if they understand.
- Don't summarize or narrate; just say what {pd.get('name')} would say.
- React naturally to what the coach just said.
- Open with: "{(pd.get('openingStatements') or ['Hi, I need some help.'])[0]}"
"""


# ============================================================================
# audio plumbing
# ============================================================================


def pcm_to_wav_bytes(pcm: bytes, sample_rate: int, channels: int = 1) -> bytes:
    """Wrap raw 16-bit PCM in a WAV container in-memory."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def wav_bytes_to_pcm(wav_bytes: bytes) -> tuple[bytes, int]:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise ValueError("WAV must be mono 16-bit PCM")
        return wf.readframes(wf.getnframes()), wf.getframerate()


async def stream_pcm_once(
    source: rtc.AudioSource, pcm: bytes, sample_rate: int
) -> None:
    """Push one PCM buffer through the AudioSource at real-time pace."""
    samples_per_chunk = sample_rate // 100  # 10 ms
    bytes_per_chunk = samples_per_chunk * 2
    for offset in range(0, len(pcm), bytes_per_chunk):
        chunk = pcm[offset : offset + bytes_per_chunk]
        if len(chunk) < bytes_per_chunk:
            chunk = chunk + b"\x00" * (bytes_per_chunk - len(chunk))
        frame = rtc.AudioFrame(
            data=chunk,
            sample_rate=sample_rate,
            num_channels=1,
            samples_per_channel=samples_per_chunk,
        )
        await source.capture_frame(frame)


# ============================================================================
# FakeUser — one LLM-driven conversation partner per session
# ============================================================================


class FakeUser:
    """One concurrent user. Listens to agent audio, transcribes, replies via
    LLM, speaks reply via TTS. State machine driven by active_speakers_changed.

    State:
      LISTENING — agent is speaking; we're buffering its audio
      THINKING  — agent fell silent; we're running STT → LLM → TTS
      SPEAKING  — we're streaming our reply into LiveKit
      IDLE      — between turns, waiting for agent to start

    Most of the time we sit in IDLE. When agent_speaking flips True we move to
    LISTENING. When it flips False after silence_threshold, we move to THINKING
    and so on.
    """

    def __init__(
        self,
        tag: str,
        room: rtc.Room,
        source: rtc.AudioSource,
        tts_sample_rate: int,
        openai_client,  # openai.AsyncOpenAI
        role_prompt: str,
        llm_model: str,
        stt_model: str,
        tts_model: str,
        tts_voice: str,
        silence_threshold: float,
        max_silent_wait: float,
    ) -> None:
        self.tag = tag
        self.room = room
        self.source = source
        self.tts_sample_rate = tts_sample_rate
        self.client = openai_client
        self.llm_model = llm_model
        self.stt_model = stt_model
        self.tts_model = tts_model
        self.tts_voice = tts_voice
        self.silence_threshold = silence_threshold
        self.max_silent_wait = max_silent_wait

        # Conversation state for the LLM.
        self.history: List[dict] = [{"role": "system", "content": role_prompt}]

        # Speaker tracking.
        self.agent_speaking = False
        self.last_state_change = time.monotonic()

        # Audio buffer for currently-arriving agent speech.
        self._agent_pcm = bytearray()
        self._agent_sample_rate: Optional[int] = None
        self._buf_lock = asyncio.Lock()

        # Active audio-consuming tasks (one per agent track).
        self._consume_tasks: List[asyncio.Task] = []

    # -------------- LiveKit event wiring --------------

    def attach(self) -> None:
        """Register room handlers. Call after room is constructed but before
        connect()."""

        @self.room.on("active_speakers_changed")
        def _on_speakers(speakers) -> None:
            others = [s for s in speakers if isinstance(s, rtc.RemoteParticipant)]
            now_speaking = len(others) > 0
            if now_speaking != self.agent_speaking:
                self.agent_speaking = now_speaking
                self.last_state_change = time.monotonic()
                log(self.tag, f"agent_speaking={self.agent_speaking}")

        @self.room.on("track_subscribed")
        def _on_track(track, pub, participant) -> None:
            log(self.tag, f"track from {participant.identity}: {track.kind}")
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                stream = rtc.AudioStream(track)
                t = asyncio.create_task(
                    self._consume_agent_audio(stream),
                    name=f"consume-{self.tag}",
                )
                self._consume_tasks.append(t)

    async def _consume_agent_audio(self, stream: rtc.AudioStream) -> None:
        """Drain the agent's audio track, accumulating into _agent_pcm while
        the agent is speaking."""
        try:
            async for event in stream:
                frame = event.frame
                if self._agent_sample_rate is None:
                    self._agent_sample_rate = frame.sample_rate
                # We accumulate regardless of speaking flag and reset around
                # turn boundaries — cheaper than gating per-frame.
                async with self._buf_lock:
                    self._agent_pcm.extend(frame.data)
        except Exception as exc:
            log(self.tag, f"consume_agent_audio ended: {exc!r}")

    async def _drain_buffer(self) -> tuple[bytes, int]:
        async with self._buf_lock:
            pcm = bytes(self._agent_pcm)
            self._agent_pcm.clear()
            sr = self._agent_sample_rate or 48000
        return pcm, sr

    # -------------- per-turn pipeline --------------

    async def _transcribe(self, pcm: bytes, sample_rate: int) -> str:
        """STT via OpenAI Whisper. Returns empty string if buffer is too
        short (avoid wasting a call on a click)."""
        if len(pcm) < sample_rate * 2 * 0.3:  # < 300 ms of audio
            return ""
        wav = pcm_to_wav_bytes(pcm, sample_rate)
        # The openai SDK wants a file-like; give it a BytesIO with a .name attr.
        bio = io.BytesIO(wav)
        bio.name = "agent.wav"
        t0 = time.monotonic()
        resp = await self.client.audio.transcriptions.create(
            model=self.stt_model,
            file=bio,
            response_format="text",
        )
        text = resp.strip() if isinstance(resp, str) else str(resp).strip()
        log(
            self.tag,
            f"STT ({time.monotonic() - t0:.2f}s, {len(pcm) / (sample_rate * 2):.1f}s "
            f"audio): {text!r}",
        )
        return text

    async def _generate_reply(self, agent_text: str) -> str:
        if agent_text:
            self.history.append({"role": "user", "content": agent_text})
        t0 = time.monotonic()
        completion = await self.client.chat.completions.create(
            model=self.llm_model,
            messages=self.history,
            temperature=0.8,
            max_tokens=120,
        )
        reply = (completion.choices[0].message.content or "").strip()
        self.history.append({"role": "assistant", "content": reply})
        log(
            self.tag,
            f"LLM ({time.monotonic() - t0:.2f}s, "
            f"hist={len(self.history)} msgs): {reply!r}",
        )
        return reply

    async def _synthesize(self, text: str) -> bytes:
        t0 = time.monotonic()
        resp = await self.client.audio.speech.create(
            model=self.tts_model,
            voice=self.tts_voice,
            input=text,
            response_format="wav",
        )
        wav = await resp.aread() if hasattr(resp, "aread") else resp.content
        pcm, sr = wav_bytes_to_pcm(wav)
        if sr != self.tts_sample_rate:
            raise RuntimeError(f"TTS returned {sr} Hz, expected {self.tts_sample_rate}")
        log(
            self.tag,
            f"TTS ({time.monotonic() - t0:.2f}s, {len(pcm) / (sr * 2):.2f}s audio)",
        )
        return pcm

    async def _take_turn(self, turn_idx: int) -> None:
        pcm, sr = await self._drain_buffer()
        agent_text = await self._transcribe(pcm, sr) if pcm else ""
        reply_text = await self._generate_reply(agent_text)
        if not reply_text:
            log(self.tag, "empty LLM reply, skipping turn")
            return
        reply_pcm = await self._synthesize(reply_text)
        log(self.tag, f"turn {turn_idx}: speaking ({len(reply_text)} chars)")
        await stream_pcm_once(self.source, reply_pcm, self.tts_sample_rate)
        log(self.tag, f"turn {turn_idx}: done speaking")
        # Reset timer so we don't immediately re-trigger on our own audio tail.
        self.last_state_change = time.monotonic()

    # -------------- main conversation loop --------------

    async def converse(self, duration: int) -> None:
        end_time = time.monotonic() + duration
        turn = 0

        while time.monotonic() < end_time:
            wait_started = time.monotonic()
            triggered = False
            while time.monotonic() < end_time:
                silent_for = time.monotonic() - self.last_state_change
                waited = time.monotonic() - wait_started
                if not self.agent_speaking and silent_for >= self.silence_threshold:
                    triggered = True
                    break
                if waited >= self.max_silent_wait:
                    log(
                        self.tag,
                        f"max_silent_wait={self.max_silent_wait}s elapsed — "
                        "taking turn anyway",
                    )
                    triggered = True
                    break
                await asyncio.sleep(0.1)
            if not triggered:
                break

            try:
                await self._take_turn(turn)
            except Exception:
                log(self.tag, f"turn {turn} pipeline failed")
                import traceback

                traceback.print_exc()
            turn += 1

        log(self.tag, f"conversation ended after {turn} turns")

    async def aclose(self) -> None:
        for t in self._consume_tasks:
            t.cancel()
        for t in self._consume_tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass


# ============================================================================
# per-session driver
# ============================================================================


async def run_session(
    session_idx: int,
    lk_url: str,
    api_key: str,
    api_secret: str,
    agent_name: str,
    openai_client,
    role_prompt: str,
    llm_model: str,
    stt_model: str,
    tts_model: str,
    tts_voice: str,
    tts_sample_rate: int,
    duration: int,
    silence_threshold: float,
    max_silent_wait: float,
    delete_after: bool,
) -> None:
    room_name = f"loadtest-{session_idx}-{uuid.uuid4().hex[:8]}"
    tag = f"s{session_idx}"

    lkapi = api.LiveKitAPI(url=lk_url, api_key=api_key, api_secret=api_secret)
    room: Optional[rtc.Room] = None
    user: Optional[FakeUser] = None

    try:
        metadata = json.dumps(SCENARIO_SAMPLE)
        log(tag, f"creating room {room_name}")
        await lkapi.room.create_room(
            api.CreateRoomRequest(name=room_name, metadata=metadata, empty_timeout=300)
        )

        # The agent reads ctx.job.metadata in parse_room_metadata, NOT the
        # room's metadata. Pass it via the dispatch so the job is dispatched
        # with the scenario JSON attached.
        dispatch_start = time.monotonic()
        log(tag, f"dispatching agent '{agent_name}'")
        await lkapi.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(
                agent_name=agent_name, room=room_name, metadata=metadata
            )
        )
        log(tag, f"dispatch acknowledged in {time.monotonic() - dispatch_start:.2f}s")

        token = (
            api.AccessToken(api_key, api_secret)
            .with_identity(f"fake-user-{session_idx}")
            .with_name(f"Load Test {session_idx}")
            .with_grants(api.VideoGrants(room_join=True, room=room_name))
            .to_jwt()
        )

        room = rtc.Room()
        source = rtc.AudioSource(tts_sample_rate, 1)
        track = rtc.LocalAudioTrack.create_audio_track("mic", source)

        user = FakeUser(
            tag=tag,
            room=room,
            source=source,
            tts_sample_rate=tts_sample_rate,
            openai_client=openai_client,
            role_prompt=role_prompt,
            llm_model=llm_model,
            stt_model=stt_model,
            tts_model=tts_model,
            tts_voice=tts_voice,
            silence_threshold=silence_threshold,
            max_silent_wait=max_silent_wait,
        )
        user.attach()

        @room.on("participant_connected")
        def _on_participant(p: rtc.RemoteParticipant) -> None:
            log(tag, f"remote joined: {p.identity} (kind={p.kind})")

        connect_start = time.monotonic()
        await room.connect(lk_url, token)
        log(tag, f"connected in {time.monotonic() - connect_start:.2f}s")

        await room.local_participant.publish_track(
            track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )

        await user.converse(duration=duration)

    except Exception as exc:
        log(tag, f"ERROR: {type(exc).__name__}: {exc}")
    finally:
        if user is not None:
            await user.aclose()
        if room is not None:
            try:
                await room.disconnect()
            except Exception:
                pass
        if delete_after:
            try:
                await lkapi.room.delete_room(api.DeleteRoomRequest(room=room_name))
                log(tag, "room deleted")
            except Exception as exc:
                log(tag, f"delete_room failed (ok if already gone): {exc}")
        await lkapi.aclose()


# ============================================================================
# entrypoint
# ============================================================================


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--sessions", type=int, default=5)
    ap.add_argument(
        "--ramp",
        type=float,
        default=0.5,
        help="seconds between launching consecutive sessions (0 = all at once)",
    )
    ap.add_argument("--duration", type=int, default=300, help="seconds per session")
    ap.add_argument(
        "--silence-threshold",
        type=float,
        default=1.5,
        help="seconds of agent silence before driver takes its next turn",
    )
    ap.add_argument(
        "--max-silent-wait",
        type=float,
        default=20.0,
        help="if no agent speech for this long, take a turn anyway (catches freezes)",
    )
    ap.add_argument("--llm-model", type=str, default="gpt-4o-mini")
    ap.add_argument("--stt-model", type=str, default="whisper-1")
    ap.add_argument("--tts-model", type=str, default="tts-1")
    ap.add_argument("--tts-voice", type=str, default="alloy")
    ap.add_argument(
        "--keep-rooms",
        action="store_true",
        help="don't delete rooms when sessions end (useful for postmortem)",
    )
    args = ap.parse_args()

    load_env_file(PROJECT_ROOT / ".env")
    try:
        lk_url = os.environ["LIVEKIT_URL"]
        api_key = os.environ["LIVEKIT_API_KEY"]
        api_secret = os.environ["LIVEKIT_API_SECRET"]
    except KeyError as exc:
        sys.exit(f"missing required env var: {exc}")
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not openai_key:
        sys.exit("OPENAI_API_KEY missing — needed for driver-side STT/LLM/TTS")
    agent_name = os.environ.get("AGENT_NAME", "Agent")

    try:
        from openai import AsyncOpenAI
    except ImportError:
        sys.exit("openai package not available — run from ally-ai-learn's poetry env")

    # Shared async client across all sessions — its httpx pool will be one of
    # the things to watch for exhaustion in diagnostics.
    openai_client = AsyncOpenAI(api_key=openai_key)

    role_prompt = build_role_prompt()
    tts_sample_rate = 24000  # OpenAI tts-1 default

    print(f"target:            {lk_url}")
    print(f"agent_name:        {agent_name}")
    print(f"sessions:          {args.sessions}")
    print(f"duration/session:  {args.duration}s")
    print(f"ramp between:      {args.ramp}s")
    print(f"silence threshold: {args.silence_threshold}s")
    print(f"max silent wait:   {args.max_silent_wait}s")
    print(
        f"models:            llm={args.llm_model} stt={args.stt_model} "
        f"tts={args.tts_model}/{args.tts_voice}"
    )
    print()

    tasks = []
    for i in range(args.sessions):
        t = asyncio.create_task(
            run_session(
                session_idx=i,
                lk_url=lk_url,
                api_key=api_key,
                api_secret=api_secret,
                agent_name=agent_name,
                openai_client=openai_client,
                role_prompt=role_prompt,
                llm_model=args.llm_model,
                stt_model=args.stt_model,
                tts_model=args.tts_model,
                tts_voice=args.tts_voice,
                tts_sample_rate=tts_sample_rate,
                duration=args.duration,
                silence_threshold=args.silence_threshold,
                max_silent_wait=args.max_silent_wait,
                delete_after=not args.keep_rooms,
            ),
            name=f"session-{i}",
        )
        tasks.append(t)
        if args.ramp > 0 and i < args.sessions - 1:
            await asyncio.sleep(args.ramp)

    print(f"all {args.sessions} sessions launched\n")
    await asyncio.gather(*tasks, return_exceptions=True)
    await openai_client.close()
    print("\ndone")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\ninterrupted — sessions will tear down on next gather")
