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
kill-switch (default on) and the per-simulation ``comfort_audio_enabled`` toggle
(Studio: comfortAudioEnabled, default off) is the opt-in — so the tone is off
for every scenario unless an author turns it on. ``settings.COMFORT_AUDIO_VOLUME``
tunes how faint it is.

Everything here is best-effort: any failure yields no comfort audio and the
session continues normally — it must never break the agent.
"""

from __future__ import annotations

import os
import random
import struct
import tempfile
import wave
from typing import Optional

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


def is_comfort_audio_enabled(scenario=None) -> bool:
    """Whether the comfort-audio room tone is on for this session.

    Two gates, both required (same shape as the thinking-filler):
    ``settings.COMFORT_AUDIO_ENABLED`` is the global kill-switch (default on),
    and ``prompt_data.comfort_audio_enabled`` is the per-simulation opt-in
    (default off, set in Studio). The tone plays only when both are true, so
    comfort audio is off for every scenario unless an author turns it on.
    """
    if not getattr(settings, "COMFORT_AUDIO_ENABLED", True):
        return False
    prompt_data = getattr(scenario, "prompt_data", None)
    if prompt_data is None:
        return False
    return bool(getattr(prompt_data, "comfort_audio_enabled", False))


def synthesize_comfort_clip(
    duration_s: float = 2.0,
    sample_rate: int = 24000,
) -> Optional[str]:
    """Generate a short, seamless-looping comfort-noise WAV; return its path.

    The clip is white noise run through a one-pole low-pass filter so it reads as
    soft "air"/room tone rather than hiss, then normalized to a fixed target peak
    so its source loudness is predictable (the low-pass otherwise attenuates it
    unpredictably). Random noise has no periodic structure, so the loop boundary
    introduces no audible click — the ``BackgroundAudioPlayer`` loops it for the
    whole session. The audible level is the source peak times the playback
    ``AudioConfig(volume=...)`` the caller applies (default ~0.15), keeping it
    faint.

    Returns the temp WAV path, or ``None`` on any failure (caller plays no
    comfort audio). The caller owns deleting the file (see ``cleanup_clip``).
    """
    try:
        num_channels = 1
        sampwidth = 2  # int16 PCM, matching the filler clips
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

        fd, path = tempfile.mkstemp(prefix="comfort_", suffix=".wav")
        os.close(fd)
        with wave.open(path, "wb") as wav:
            wav.setnchannels(num_channels)
            wav.setsampwidth(sampwidth)
            wav.setframerate(sample_rate)
            wav.writeframes(bytes(frames))
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


def cleanup_clip(path: Optional[str]) -> None:
    """Delete the synthesized comfort-tone temp WAV (best-effort)."""
    if not path:
        return
    try:
        os.remove(path)
    except OSError:
        pass
