"""Render filler dialogues to audio clips for the BackgroundAudioPlayer.

The thinking-filler plays on a SEPARATE LiveKit audio track
(BackgroundAudioPlayer.thinking_sound), not the agent's speech channel, so it
can never race or preempt the real reply. That player needs replayable audio
sources, so we synthesize the scenario's per-language filler dialogues to temp
WAV files once at session start (the player re-reads the file on each "thinking"
transition).

Everything here is best-effort: any failure yields fewer/zero clips and the
session continues without a filler — it must never break the agent.
"""

from __future__ import annotations

import os
import tempfile
import wave
from typing import List

from app.core.logger import get_logger

logger = get_logger(__name__)


async def synthesize_filler_clips(tts_client, phrases: List[str]) -> List[str]:
    """Synthesize each phrase to a temp WAV file; return the file paths.

    Uses the session's configured TTS so the filler matches the agent voice.
    Per-phrase failures are skipped (logged), never raised.
    """
    paths: List[str] = []
    tts = getattr(tts_client, "tts_instance", None)
    if tts is None or not phrases:
        return paths

    for phrase in phrases:
        if not phrase or not phrase.strip():
            continue
        try:
            frames: list[bytes] = []
            sample_rate = 24000
            num_channels = 1
            stream = tts.synthesize(phrase)
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

            if not frames:
                logger.warning("[FILLER] no audio synthesized for %r", phrase)
                continue

            fd, path = tempfile.mkstemp(prefix="filler_", suffix=".wav")
            os.close(fd)
            with wave.open(path, "wb") as wav:
                wav.setnchannels(num_channels)
                wav.setsampwidth(2)  # TTS frames are int16 PCM
                wav.setframerate(sample_rate)
                wav.writeframes(b"".join(frames))
            paths.append(path)
            logger.info("[FILLER] synthesized clip phrase=%r -> %s", phrase, path)
        except Exception as e:  # noqa: BLE001 - filler must never break a session
            logger.warning("[FILLER] failed to synthesize %r: %s", phrase, e)

    return paths


def cleanup_clips(paths: List[str]) -> None:
    """Delete synthesized temp WAV files (best-effort)."""
    for p in paths or []:
        try:
            os.remove(p)
        except OSError:
            pass
