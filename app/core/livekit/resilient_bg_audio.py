"""A crash-resistant ``BackgroundAudioPlayer`` for the shared naturalness track.

Comfort audio, the thinking-filler and the back-channel all ride ONE LiveKit
``BackgroundAudioPlayer`` — one ``AudioMixer`` drained by one pump coroutine
(``_run_mixer_task``) into one ``AudioSource``. Upstream, that pump is

    @log_exceptions(logger=logger)            # this wrapper RE-RAISES
    async def _run_mixer_task(self):
        async for frame in self._audio_mixer:
            await self._audio_source.capture_frame(frame)

so a SINGLE transient ``capture_frame`` error (e.g. surfaced around a LiveKit
reconnect) propagates out, ``@log_exceptions`` re-raises, the pump coroutine
terminates — and nothing ever restarts it. ``_on_reconnected`` only republishes
the track from the same source; it never re-arms the mixer task or the ambient
sound. The result is the reported bug: comfort audio (plus filler + back-channel)
goes permanently silent partway through a session while the agent's own voice —
on a SEPARATE ``AgentSession`` track — keeps working.

This subclass overrides only the pump so a per-frame capture error is logged and
SKIPPED instead of killing the session-long loop. The happy path is unchanged
(every frame is still captured); we only refuse to let one bad frame end the
track. The ``async for`` over the mixer still ends normally on
``aclose()``/``StopAsyncIteration``, so shutdown is unaffected.
"""

from __future__ import annotations

from livekit.agents import BackgroundAudioPlayer

from app.core.logger import get_logger

logger = get_logger(__name__)


class ResilientBackgroundAudioPlayer(BackgroundAudioPlayer):
    """``BackgroundAudioPlayer`` whose mixer pump survives transient capture errors."""

    async def _run_mixer_task(self) -> None:
        # Deliberately NOT wrapped in @log_exceptions: that decorator re-raises,
        # which is exactly what kills the pump upstream. A capture_frame failure
        # here is best-effort — log and keep pumping so comfort/filler/back-channel
        # can never be silenced for the rest of the session by one bad frame.
        async for frame in self._audio_mixer:
            try:
                await self._audio_source.capture_frame(frame)
            except Exception as e:  # noqa: BLE001 - must never break the bg track
                logger.warning(
                    "[BG_AUDIO] capture_frame failed, continuing: %s", e
                )
                continue
