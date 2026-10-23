"""Fixed-gain wrapper around a LiveKit ``tts.TTS``.

ElevenLabs' generative v4 models render 7-10 dB quieter than v3 for the same
voice (measured 2026-10-14 across five voices: speech RMS -24..-28 dBFS on
``eleven_v4`` vs -14..-19 dBFS on ``eleven_v3``), and the API has no loudness
control. ``GainTTS`` scales every PCM frame the wrapped TTS emits so a v4
voice lands at the v3 level, with a peak limiter so the boost can never clip.

The limiter is stateless-simple on purpose: the effective gain for a frame is
``min(gain, headroom / peak_so_far)`` where ``peak_so_far`` includes the
current frame, so no sample is ever pushed past full scale and the gain only
ever steps down within one synthesis (no pumping back up).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from livekit import rtc
from livekit.agents import tts as agents_tts
from livekit.agents import utils
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions

# Leave a little headroom under int16 full scale so the limiter's own rounding
# never clips.
_LIMIT = 32000.0


def db_to_linear(gain_db: float) -> float:
    return math.pow(10.0, gain_db / 20.0)


class GainState:
    """Running peak for one synthesis, so the limiter never pumps upward."""

    def __init__(self, gain: float) -> None:
        self.gain = gain
        self.peak = 0.0

    def apply(self, pcm16: bytes) -> bytes:
        if self.gain == 1.0 or not pcm16:
            return pcm16
        x = np.frombuffer(pcm16, dtype=np.int16)
        if x.size == 0:
            return pcm16
        self.peak = max(self.peak, float(np.abs(x.astype(np.int32)).max()))
        eff = self.gain if self.peak <= 0 else min(self.gain, _LIMIT / self.peak)
        if eff <= 1.0 and self.gain >= 1.0:
            # Already at or above the ceiling: pass through untouched.
            return pcm16
        y = np.clip(np.rint(x.astype(np.float32) * eff), -32768, 32767)
        return y.astype(np.int16).tobytes()


class GainTTS(agents_tts.TTS):
    """Delegates to ``tts`` and multiplies its PCM output by a fixed gain."""

    def __init__(self, *, tts: agents_tts.TTS, gain_db: float) -> None:
        super().__init__(
            capabilities=tts.capabilities,
            sample_rate=tts.sample_rate,
            num_channels=tts.num_channels,
        )
        self._wrapped_tts = tts
        self._gain_db = float(gain_db)
        self._gain = db_to_linear(self._gain_db)
        self._wrapped_tts.on("metrics_collected", self._on_metrics_collected)

    @property
    def wrapped_tts(self) -> agents_tts.TTS:
        return self._wrapped_tts

    @property
    def gain_db(self) -> float:
        return self._gain_db

    @property
    def model(self) -> str:
        return self._wrapped_tts.model

    @property
    def provider(self) -> str:
        return self._wrapped_tts.provider

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "GainChunkedStream":
        return GainChunkedStream(tts=self, input_text=text, conn_options=conn_options)

    def stream(
        self, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> "GainSynthesizeStream":
        return GainSynthesizeStream(tts=self, conn_options=conn_options)

    def prewarm(self) -> None:
        self._wrapped_tts.prewarm()

    def _on_metrics_collected(self, *args: Any, **kwargs: Any) -> None:
        self.emit("metrics_collected", *args, **kwargs)

    async def aclose(self) -> None:
        self._wrapped_tts.off("metrics_collected", self._on_metrics_collected)
        await self._wrapped_tts.aclose()


class GainChunkedStream(agents_tts.ChunkedStream):
    def __init__(
        self, *, tts: GainTTS, input_text: str, conn_options: APIConnectOptions
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._gain_tts = tts

    async def _run(self, output_emitter: agents_tts.AudioEmitter) -> None:
        state = GainState(self._gain_tts._gain)
        output_emitter.initialize(
            request_id=utils.shortuuid(),
            sample_rate=self._gain_tts.sample_rate,
            num_channels=self._gain_tts.num_channels,
            mime_type="audio/pcm",
        )
        async with self._gain_tts.wrapped_tts.synthesize(
            self._input_text, conn_options=self._conn_options
        ) as inner:
            async for audio in inner:
                output_emitter.push(state.apply(_frame_bytes(audio.frame)))
        output_emitter.flush()


class GainSynthesizeStream(agents_tts.SynthesizeStream):
    def __init__(self, *, tts: GainTTS, conn_options: APIConnectOptions) -> None:
        super().__init__(tts=tts, conn_options=conn_options)
        self._gain_tts = tts

    async def _metrics_monitor_task(self, event_aiter: Any) -> None:
        pass  # the wrapped stream reports its own metrics

    async def _run(self, output_emitter: agents_tts.AudioEmitter) -> None:
        import asyncio

        inner = self._gain_tts.wrapped_tts.stream(conn_options=self._conn_options)
        state = GainState(self._gain_tts._gain)
        output_emitter.initialize(
            request_id=utils.shortuuid(),
            sample_rate=self._gain_tts.sample_rate,
            num_channels=self._gain_tts.num_channels,
            mime_type="audio/pcm",
            stream=True,
        )

        async def _forward_input() -> None:
            async for data in self._input_ch:
                if isinstance(data, self._FlushSentinel):
                    inner.flush()
                    continue
                inner.push_text(data)
            inner.end_input()

        async def _forward_audio() -> None:
            open_segment: str | None = None
            async for audio in inner:
                seg = audio.segment_id or ""
                if open_segment != seg:
                    if open_segment is not None:
                        output_emitter.end_segment()
                    output_emitter.start_segment(segment_id=seg)
                    open_segment = seg
                output_emitter.push(state.apply(_frame_bytes(audio.frame)))
                # Emit frame-for-frame: the wrapped stream already paced its
                # output, and holding a partial frame back would delay the
                # tail of every sentence until the next one arrives.
                output_emitter.flush()
                if audio.is_final:
                    output_emitter.end_segment()
                    open_segment = None
            if open_segment is not None:
                output_emitter.end_segment()

        tasks = [
            asyncio.create_task(_forward_input()),
            asyncio.create_task(_forward_audio()),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            await inner.aclose()
            await utils.aio.cancel_and_wait(*tasks)


def _frame_bytes(frame: rtc.AudioFrame) -> bytes:
    return frame.data.tobytes()
