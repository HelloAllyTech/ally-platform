"""A crash-resistant ``BackgroundAudioPlayer`` for the shared naturalness track.

Comfort audio, the thinking-filler and the back-channel all ride ONE LiveKit
``BackgroundAudioPlayer`` — one ``AudioMixer`` drained by one pump coroutine
(``_run_mixer_task``) into one ``AudioSource``. Upstream, that pump is

    @log_exceptions(logger=logger)            # this wrapper RE-RAISES
    async def _run_mixer_task(self):
        async for frame in self._audio_mixer:
            await self._audio_source.capture_frame(frame)

so a transient ``capture_frame`` error (e.g. surfaced around a LiveKit reconnect)
propagates out, ``@log_exceptions`` re-raises, the pump coroutine terminates —
and nothing ever restarts it (``_on_reconnected`` only republishes the track
from the same source). That would silence comfort + filler + back-channel for
the rest of the session while the agent's own voice — on a SEPARATE
``AgentSession`` track — keeps working.

This subclass overrides only the pump so a per-frame capture error is logged and
SKIPPED instead of killing the session-long loop. The happy path is unchanged
(every frame is still captured); the ``async for`` over the mixer still ends
normally on ``aclose()``/``StopAsyncIteration``, so shutdown is unaffected.

NOTE: this is defense-in-depth for the capture_frame failure mode, which is
distinct from the "comfort stops the first time a filler plays" bug — that one
is caused by the mixer timing-out and DROPPING the file-backed ambient stream,
and is fixed by feeding an in-memory ambient loop instead (see
``comfort_audio.comfort_ambient_source``). This guard does not address that path.
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
                logger.warning("[BG_AUDIO] capture_frame failed, continuing: %s", e)
                continue

    def flush(self) -> None:
        """Drop any audio already buffered in the source so a stopped clip is
        cut immediately.

        ``PlayHandle.stop()`` only halts the *feeder* that pushes new frames into
        the mixer; frames already captured into the shared ``AudioSource`` keep
        playing out (~``queue_size_ms``, ~1s by default). On its own that lets a
        cut filler/interim bleed over the agent's real reply — which rides a
        SEPARATE ``AgentSession`` ``AudioSource``, so the two voices overlap.
        Clearing the source queue here cuts the buffered tail at once. The mixer
        pump keeps running (the whole point of this subclass), so the looping
        comfort tone refills on the next pull — an imperceptible blip in a noise
        bed. Best-effort; never raises into a turn.
        """
        try:
            src = getattr(self, "_audio_source", None)
            if src is not None and hasattr(src, "clear_queue"):
                src.clear_queue()
        except Exception as e:  # noqa: BLE001 - must never break the bg track
            logger.warning("[BG_AUDIO] flush failed: %s", e)
