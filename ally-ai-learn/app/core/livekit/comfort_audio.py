"""Comfort-audio layer: a faint ambient room tone for the background track.

Voice agents have a noticeable voice-to-voice gap: between the learner's turn
and the agent's reply the line is dead silent. Many users read that silence as
"muted" / "disconnected", and the lack of any sound makes the wait *feel*
longer than it is. Telephony solves this with *comfort noise* — a faint,
constant room tone so the line always sounds "live". We do the same: a very
quiet, low-pass-filtered noise bed played as the ambient sound on the shared
``BackgroundAudioPlayer`` track (the SAME track the thinking-filler uses), so it
loops under everything for the whole session.

This does NOT reduce the measured ``response_latency_ms`` — it only masks the
*perceived* gap so the line never sounds dead.

Two gates, both required: ``settings.COMFORT_AUDIO_ENABLED`` is the global
kill-switch (default on) and the per-simulation ``comfort_audio_enabled``
toggle (Studio: comfortAudioEnabled) is the per-scenario setting.
``settings.COMFORT_AUDIO_VOLUME`` tunes how faint it is.

The per-simulation toggle now defaults ON when the simulation has expressed no
preference at all (``settings.COMFORT_AUDIO_DEFAULT_ON``) — dead silence is not
a good default for something users read as a dropped call. An explicit ``false``
is always respected, so no existing scenario changes behaviour. See
``Scenario._resolve_comfort_audio_enabled``.

That default is INERT in production today: ally-be migration
``1798000000000-DisableComfortAudio`` stamped ``comfortAudioEnabled: false``
into every scenario's metadata (deliberately reverting the earlier
platform-wide enable in ``1797000000000``), and Studio re-stamps an explicit
``false`` on every save. Making comfort audio actually on-by-default therefore
needs the ally-be/ally-web half as well, and — given 1798 was a deliberate
rollback — a product decision, not just a code change.

Everything here is best-effort: any failure yields no comfort audio and the
session continues normally — it must never break the agent.
"""

from __future__ import annotations

import asyncio
import os
import random
import struct
import tempfile
import wave
from typing import AsyncIterator, List, Optional

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


def is_comfort_audio_enabled(scenario=None) -> bool:
    """Whether the comfort-audio room tone is on for this session.

    Two gates, both required (same shape as the thinking-filler):
    ``settings.COMFORT_AUDIO_ENABLED`` is the global kill-switch (default on),
    and ``prompt_data.comfort_audio_enabled`` is the per-simulation setting,
    which now defaults ON when the simulation expressed no preference (see the
    module docstring). The tone plays only when both are true.
    """
    if not getattr(settings, "COMFORT_AUDIO_ENABLED", True):
        return False
    prompt_data = getattr(scenario, "prompt_data", None)
    if prompt_data is None:
        # No prompt data at all is a broken/degenerate scenario, not a
        # preference. Stay off rather than layering audio onto something we
        # cannot reason about.
        return False
    return bool(
        getattr(
            prompt_data,
            "comfort_audio_enabled",
            getattr(settings, "COMFORT_AUDIO_DEFAULT_ON", True),
        )
    )


def _synthesize_comfort_pcm(duration_s: float, sample_rate: int) -> bytes:
    """Build the raw int16-mono PCM for the comfort room tone (no file I/O).

    White noise through a one-pole low-pass (so it reads as soft "air"/room tone
    rather than hiss), normalized to a fixed target peak so the playback volume
    control is predictable. Deterministic (fixed RNG seed) — random noise has no
    periodic structure, so looping it introduces no audible click. Returns
    little-endian int16 PCM bytes.
    """
    # Normalize the filtered noise to this peak (~20% of int16 full scale).
    # Playback volume scales it down from here, so this is a predictable
    # reference rather than the final loudness.
    target_peak = 6553
    # One-pole low-pass: smaller alpha = duller/softer tone (less hiss).
    alpha = 0.05

    total_samples = max(1, int(duration_s * sample_rate))
    rng = random.Random(1234)  # deterministic clip; loudness comes from volume
    prev = 0.0
    signal = []
    peak = 0.0
    for _ in range(total_samples):
        white = rng.uniform(-1.0, 1.0)
        prev = prev + alpha * (white - prev)  # low-pass filtered noise
        signal.append(prev)
        if abs(prev) > peak:
            peak = abs(prev)

    scale = (target_peak / peak) if peak > 0 else 0.0
    frames = bytearray()
    for value in signal:
        sample = int(max(-32768, min(32767, value * scale)))
        frames += struct.pack("<h", sample)
    return bytes(frames)


def synthesize_comfort_clip(
    duration_s: float = 2.0,
    sample_rate: int = 48000,
) -> Optional[str]:
    """Generate a short, seamless-looping comfort-noise WAV; return its path.

    Synthesized at 48 kHz to match the ``BackgroundAudioPlayer``'s mixer/source
    rate (``rtc.AudioMixer(48000, ...)`` / ``rtc.AudioSource(48000, ...)``). A
    lower rate is resampled up by the library and reads at the wrong character,
    so keep this aligned with the mixer.

    NOTE: the live session uses ``comfort_ambient_source`` (an in-memory loop),
    not this file — see that function for why. This remains for tooling/tests
    and any path-based caller.

    Returns the temp WAV path, or ``None`` on any failure. The caller owns
    deleting the file (see ``cleanup_clip``).
    """
    try:
        pcm = _synthesize_comfort_pcm(duration_s, sample_rate)
        fd, path = tempfile.mkstemp(prefix="comfort_", suffix=".wav")
        os.close(fd)
        with wave.open(path, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)  # int16 PCM
            wav.setframerate(sample_rate)
            wav.writeframes(pcm)
        logger.info(
            "[COMFORT] synthesized room-tone clip %.1fs @ %dHz -> %s",
            duration_s,
            sample_rate,
            path,
        )
        return path
    except Exception as e:  # noqa: BLE001 - comfort audio must never break a session
        logger.warning("[COMFORT] failed to synthesize room tone: %s", e)
        return None


def comfort_ambient_source(
    duration_s: float = 2.0,
    sample_rate: int = 48000,
    frame_samples: int = 4800,
) -> "Optional[AsyncIterator]":
    """Build an INFINITE, in-memory async iterator of the comfort room tone.

    This is the source the live session feeds to the ``BackgroundAudioPlayer``
    ambient slot — deliberately NOT a file path. The shared ``rtc.AudioMixer``
    pulls every stream with ``asyncio.wait_for(stream.__anext__(), timeout)``
    (``stream_timeout_ms``, default 200 ms). If the ambient stream takes longer
    than that to yield a frame — e.g. the file-based loop re-opening/decoding the
    clip while a thinking-filler is also decoding on the same CPU/thread pool —
    ``wait_for`` CANCELS the pull, which permanently CLOSES the generator; the
    mixer then drops the stream and comfort goes silent for the rest of the
    session. A pre-decoded in-memory generator yields instantly, so it can never
    be timed out and dropped (this is the comfort-stops-after-a-filler bug fix).

    Frames are int16 mono at ``sample_rate`` (must match the mixer's 48 kHz).
    Returns the iterator, or ``None`` on any failure (no comfort audio). No temp
    file, so nothing to clean up.
    """
    try:
        from livekit import rtc

        pcm = _synthesize_comfort_pcm(duration_s, sample_rate)
        bytes_per_frame = max(1, frame_samples) * 2  # int16 -> 2 bytes/sample
        frames = []
        for off in range(0, len(pcm), bytes_per_frame):
            chunk = pcm[off : off + bytes_per_frame]
            n = len(chunk) // 2
            if n:
                frames.append(rtc.AudioFrame(chunk, sample_rate, 1, n))
        if not frames:
            return None

        async def _loop():
            # Infinite loop over the pre-built frames. The mixer treats frames as
            # read-only (it copies before scaling volume), so reusing the objects
            # across loops is safe.
            while True:
                for f in frames:
                    yield f

        logger.info(
            "[COMFORT] in-memory room-tone source ready (%d frame(s) @ %dHz)",
            len(frames),
            sample_rate,
        )
        return _loop()
    except Exception as e:  # noqa: BLE001 - comfort audio must never break a session
        logger.warning("[COMFORT] failed to build in-memory source: %s", e)
        return None


def _decode_audio_to_frames(
    data: bytes,
    sample_rate: int,
    frame_samples: int,
) -> "List":
    """Decode arbitrary audio bytes to 48 kHz mono int16 rtc.AudioFrames.

    Synchronous (pydub shells out to ffmpeg, which is in the image) so callers
    run it via ``asyncio.to_thread`` to avoid blocking the event loop. Returns
    the list of pre-built frames (empty if the clip decodes to nothing). Raises
    on decode failure — the async caller catches it and falls back.
    """
    from io import BytesIO

    from livekit import rtc
    from pydub import AudioSegment

    segment = (
        AudioSegment.from_file(BytesIO(data))
        .set_frame_rate(sample_rate)
        .set_channels(1)
        .set_sample_width(2)  # int16
    )
    pcm = segment.raw_data  # little-endian int16 mono PCM
    bytes_per_frame = max(1, frame_samples) * 2
    frames = []
    for off in range(0, len(pcm), bytes_per_frame):
        chunk = pcm[off : off + bytes_per_frame]
        n = len(chunk) // 2
        if n:
            frames.append(rtc.AudioFrame(chunk, sample_rate, 1, n))
    return frames


async def fetch_and_decode_comfort_source(
    url: str,
    sample_rate: int = 48000,
    frame_samples: int = 4800,
    timeout_s: float = 4.0,
    max_bytes: int = 10 * 1024 * 1024,
) -> "Optional[AsyncIterator]":
    """Fetch a superadmin-uploaded comfort-audio track and return an INFINITE,
    in-memory async iterator of its frames (48 kHz mono int16), or ``None``.

    Same in-memory-loop contract as ``comfort_ambient_source``: the decoded PCM
    is pre-partitioned into ``rtc.AudioFrame`` objects and looped from memory, so
    the shared mixer's per-stream ``wait_for(__anext__)`` can never time out and
    permanently drop the ambient stream. A file-backed or lazily-streamed decode
    would reintroduce the "comfort stops the first time a filler plays" bug — do
    not stream-decode here.

    Best-effort: any failure (bad/oversized/non-audio response, decode error,
    timeout) returns ``None`` so the caller falls back to the synthesized tone.
    The fetch is bounded by ``timeout_s`` and the whole call is additionally
    guarded by the caller's ``asyncio.wait_for`` on the session-start path.
    """
    if not url:
        return None
    try:
        import httpx

        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, timeout=timeout_s)
            resp.raise_for_status()
            data = resp.content

        if not data:
            logger.warning("[COMFORT] uploaded track empty: %s", url)
            return None
        if len(data) > max_bytes:
            logger.warning(
                "[COMFORT] uploaded track too large (%d bytes > %d) — falling back: %s",
                len(data),
                max_bytes,
                url,
            )
            return None

        frames = await asyncio.to_thread(
            _decode_audio_to_frames, data, sample_rate, frame_samples
        )
        if not frames:
            logger.warning("[COMFORT] uploaded track decoded to no frames: %s", url)
            return None

        async def _loop():
            # Infinite loop over the pre-decoded frames (see comfort_ambient_source).
            while True:
                for f in frames:
                    yield f

        logger.info(
            "[COMFORT] uploaded track ready (%d frame(s) @ %dHz) from %s",
            len(frames),
            sample_rate,
            url,
        )
        return _loop()
    except Exception as e:  # noqa: BLE001 - comfort audio must never break a session
        logger.warning("[COMFORT] failed to fetch/decode uploaded track %s: %s", url, e)
        return None


def cleanup_clip(path: Optional[str]) -> None:
    """Delete the synthesized comfort-tone temp WAV (best-effort)."""
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        pass
