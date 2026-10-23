"""Predict how long this turn's reply will take, before it takes it.

WHY THIS EXISTS
---------------
The filler used to decide whether a turn had a gap by WAITING to find out:
sleep a random 300-600 ms after the agent starts thinking, then play only if the
reply still hadn't arrived. That works, but it spends the very latency it exists
to mask — the filler lands half a second after the moment it was supposed to
cover, which is the single largest term in its lead time.

The wait is unnecessary because the answer is predictable. Every turn already
records ``llm_ttft_ms`` (time to the model's first token) and ``tts_ttfb_ms``
(time to the first audio byte) into ``turn_metrics``; their sum is, within noise,
how long the learner will wait for the reply. A session's own recent history is a
far better predictor of its next turn than a fixed timer, because the dominant
terms — model, provider, region, prompt size — are constant within a session.

So: keep an exponential moving average of that sum, seeded from a prior until
enough real turns exist, and at "thinking" decide immediately. Fast turns get no
filler and no delay; slow turns get one straight away.

The EMA is deliberately simple and defensive — a predictor that throws, or that
needs tuning per language, would be worse than the timer it replaces.
"""

from __future__ import annotations

from typing import Optional

from app.core.logger import get_logger

logger = get_logger(__name__)


class GapPredictor:
    """Exponential moving average of observed reply latency, in milliseconds.

    ``alpha`` weights the newest observation; 0.4 tracks a session that warms up
    or degrades within a handful of turns without chasing a single outlier.
    ``prior_ms`` is used until ``min_samples`` real turns have been seen, so the
    first turns of a session behave sensibly rather than randomly.
    """

    def __init__(
        self,
        prior_ms: float = 900.0,
        alpha: float = 0.4,
        min_samples: int = 2,
    ) -> None:
        self._prior = max(0.0, float(prior_ms))
        self._alpha = min(1.0, max(0.01, float(alpha)))
        self._min_samples = max(0, int(min_samples))
        self._value: Optional[float] = None
        self._samples = 0
        #: This turn's LLM time-to-first-token, waiting for its TTS half.
        self._pending_llm_ms: Optional[float] = None
        #: Whether a measured end-to-end wait has been seen (``observe_wait``).
        #: From then on only measured waits count.
        self._measured = False

    @property
    def samples(self) -> int:
        return self._samples

    @property
    def is_warm(self) -> bool:
        """Whether enough real turns have been observed to trust the estimate."""
        return self._samples >= self._min_samples

    def observe(self, latency_ms: Optional[float]) -> None:
        """Fold one turn's observed reply latency into the average.

        Ignores None and non-positive values (a turn that never reached the
        model, or a clock artefact) and clamps absurd values, so one pathological
        turn — a 30 s LLM timeout, say — can't poison the estimate for the rest
        of the session.
        """
        if latency_ms is None:
            return
        try:
            value = float(latency_ms)
        except (TypeError, ValueError):
            return
        if value <= 0:
            return
        value = min(value, 10_000.0)
        self._value = (
            value
            if self._value is None
            else (self._alpha * value + (1.0 - self._alpha) * self._value)
        )
        self._samples += 1

    def observe_wait(self, wait_ms: Optional[float]) -> None:
        """Fold in one turn's MEASURED wait: "thinking" to the reply's audio.

        The component sum (LLM time-to-first-token + TTS time-to-first-byte)
        leaves out the rest of the pipeline between the learner finishing and
        the reply sounding. Prod V2V (2026-10-16) measured it at ~0.8x the real
        wait (2.1-2.5 s predicted vs 2.7-3.2 s real), so the interim never fit
        in a gap that left 1.1-1.5 s of silence after the filler. The first
        measured wait replaces the component estimate; component timings are
        ignored after that.
        """
        try:
            value = float(wait_ms) if wait_ms is not None else None
        except (TypeError, ValueError):
            return
        if value is None or value <= 0:
            return
        if not self._measured:
            self._measured = True
            self._value = None
            self._samples = 0
        self.observe(value)

    def observe_turn(
        self, llm_ttft_ms: Optional[float], tts_ttfb_ms: Optional[float]
    ) -> None:
        """Fold in a turn from its two component timings.

        Either component may be missing (a cached reply, a provider that doesn't
        report TTFB); the sum of what IS present is still a usable lower bound,
        which is the safe direction — it under-predicts the gap, so the filler
        errs toward not playing rather than talking over the reply. Ignored once
        measured waits are arriving (``observe_wait``).
        """
        if self._measured:
            return
        total = 0.0
        for part in (llm_ttft_ms, tts_ttfb_ms):
            try:
                if part is not None and float(part) > 0:
                    total += float(part)
            except (TypeError, ValueError):
                continue
        if total > 0:
            self.observe(total)

    def observe_llm_ttft(self, llm_ttft_ms: Optional[float]) -> None:
        """Hold a turn's LLM time-to-first-token until its TTS half arrives.

        LiveKit reports the two halves of one turn's wait as SEPARATE metrics
        events. Folding each into the average on its own — what this class used
        to be fed — makes the EMA converge on roughly the MEAN of the two
        components rather than their SUM: prod measured the prediction at 0.39x
        the real gap on the median turn, under-predicting on 97.8% of turns, so
        every clip chosen to fit the gap was far too short. The halves are
        paired here instead, one observation per turn.
        """
        try:
            value = float(llm_ttft_ms) if llm_ttft_ms is not None else None
        except (TypeError, ValueError):
            return
        if value is not None and value > 0:
            # A turn that never reached TTS (interrupted) is replaced, not summed.
            self._pending_llm_ms = value

    def observe_tts_ttfb(self, tts_ttfb_ms: Optional[float]) -> None:
        """Complete the pending turn with its first TTS time-to-first-byte.

        Only the FIRST TTS metric after an LLM one counts: per-sentence TTS
        paths emit one metric per sentence, and a clip rendered off the session
        instance is not a reply at all. Either way a TTS metric with no pending
        LLM half is ignored rather than folded in alone.
        """
        pending = self._pending_llm_ms
        if pending is None:
            return
        self._pending_llm_ms = None
        self.observe_turn(pending, tts_ttfb_ms)

    def predict_ms(self) -> float:
        """Best estimate of the coming turn's time to first reply audio.

        A single measured wait is already a better estimate than the prior: it
        is the real thing, where the prior is a fleet-wide guess.
        """
        if self._value is None:
            return self._prior
        if self._measured or self.is_warm:
            return self._value
        return self._prior
