"""Render filler dialogues to audio clips for the BackgroundAudioPlayer.

The thinking-filler plays on a SEPARATE LiveKit audio track
(BackgroundAudioPlayer), not the agent's speech channel, so it can never race or
preempt the real reply. The player needs replayable audio sources, so we
synthesize the scenario's per-language filler dialogues to temp WAV files once
at session start. We return ``(phrase, wav_path)`` pairs so the worker can pick
a clip on "thinking", play it, and record the spoken phrase in the transcript.

Everything here is best-effort: any failure yields fewer/zero clips and the
session continues without a filler — it must never break the agent.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import wave
from typing import List, Optional, Tuple

from app.core.logger import get_logger

logger = get_logger(__name__)


async def _collect_frames(stream) -> Tuple[list, int, int]:
    """Drain a TTS stream into (frames, sample_rate, num_channels)."""
    frames: list[bytes] = []
    sample_rate = 24000
    num_channels = 1
    try:
        async for ev in stream:
            frame = getattr(ev, "frame", None)
            if frame is None:
                continue
            frames.append(bytes(frame.data))
            sample_rate = frame.sample_rate
            num_channels = frame.num_channels
    finally:
        aclose = getattr(stream, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:  # noqa: BLE001
                pass
    return frames, sample_rate, num_channels


def _normalize_for_synthesis(phrase: str) -> str:
    """Avoid an ALL-CAPS filler being read out as spelled-out letters.

    Several TTS providers treat a fully-uppercase token as an acronym and
    spell it letter by letter — e.g. a "MMM" hesitation heard as "M, M, M"
    instead of a hum. Mixed- or lower-case text (the common case) is
    untouched; only a phrase that is entirely uppercase is affected.
    """
    return phrase.lower() if phrase.isupper() else phrase


async def _synthesize_one(tts, phrase: str) -> Optional[Tuple[str, str]]:
    """Synthesize a single phrase to a temp WAV; return ``(phrase, path)`` or None.

    Best-effort: returns ``None`` for an empty phrase, no synthesized audio, or
    any failure — never raises. The caller filters out ``None`` so one bad
    phrase can't break the whole set (a filler must never break a session).

    Tries the one-shot ``synthesize()`` path first, then falls back to the
    websocket ``stream()`` path: some providers (Sarvam) have a broken
    one-shot endpoint (libav InvalidDataError, zero frames) while their
    streaming path — the one the live agent speaks through — works fine.
    """
    if not phrase or not phrase.strip():
        return None
    phrase = _normalize_for_synthesis(phrase)
    try:
        frames: list[bytes] = []
        sample_rate = 24000
        num_channels = 1
        try:
            frames, sample_rate, num_channels = await _collect_frames(
                tts.synthesize(phrase)
            )
        except Exception as e:  # noqa: BLE001 - fall through to stream()
            logger.info(
                "[FILLER] one-shot synth failed for %r (%s) — trying stream()",
                phrase,
                e,
            )

        if not frames:
            stream = tts.stream()
            stream.push_text(phrase)
            flush = getattr(stream, "flush", None)
            if flush is not None:
                flush()
            stream.end_input()
            frames, sample_rate, num_channels = await _collect_frames(stream)

        if not frames:
            logger.warning("[FILLER] no audio synthesized for %r", phrase)
            return None

        fd, path = tempfile.mkstemp(prefix="filler_", suffix=".wav")
        os.close(fd)
        with wave.open(path, "wb") as wav:
            wav.setnchannels(num_channels)
            wav.setsampwidth(2)  # TTS frames are int16 PCM
            wav.setframerate(sample_rate)
            wav.writeframes(b"".join(frames))
        logger.info("[FILLER] synthesized clip phrase=%r -> %s", phrase, path)
        return (phrase, path)
    except Exception as e:  # noqa: BLE001 - filler must never break a session
        logger.warning("[FILLER] failed to synthesize %r: %s", phrase, e)
        return None


async def synthesize_filler_clips(
    tts_client, phrases: List[str]
) -> List[Tuple[str, str]]:
    """Synthesize each phrase to a temp WAV file, concurrently.

    Returns a list of ``(phrase, wav_path)`` pairs so the caller knows which
    phrase each clip says — needed to record the spoken filler in the transcript.
    Uses the same PROVIDER/voice as the session but an ISOLATED TTS instance
    (``create_clip_tts``): the AgentSession closes itself after a few
    unrecoverable errors on its own instance, so clip failures on the shared
    instance can kill a live session (prod Marathi outage, 2026-08-20). When
    no isolated instance can be built we skip clips entirely — silence is
    strictly better than a dead session.
    Phrases are synthesized in parallel (``asyncio.gather``); per-phrase failures
    are skipped (logged), never raised, and input ordering is preserved.
    """
    if not phrases:
        return []
    create = getattr(tts_client, "create_clip_tts", None)
    tts = create() if create is not None else None
    if tts is None:
        logger.warning(
            "[FILLER] no isolated clip TTS available — skipping %d clip(s) "
            "rather than risking the session's TTS error budget",
            len(phrases),
        )
        return []

    try:
        results = await asyncio.gather(
            *[_synthesize_one(tts, phrase) for phrase in phrases]
        )
    finally:
        aclose = getattr(tts, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:  # noqa: BLE001
                pass
    return [clip for clip in results if clip is not None]


def cleanup_clips(paths: List[str]) -> None:
    """Delete synthesized temp WAV files (best-effort)."""
    for p in paths or []:
        try:
            os.remove(p)
        except OSError:
            pass
