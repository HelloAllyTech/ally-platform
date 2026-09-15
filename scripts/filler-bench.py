#!/usr/bin/env python3
"""Offline bench for the thinking-filler layer.

WHAT THIS MEASURES, AND WHAT IT DOES NOT
----------------------------------------
This drives the REAL decision, selection, rendering and cache code over a
simulated conversation, with a stub TTS standing in for the provider. That makes
the structural properties measurable on a laptop, with no LiveKit stack, no API
keys and no audio hardware:

* **Lead time** — the cost of the play path itself (choose a clip, build the
  frame iterator). The deliberate 300-600 ms wait it replaces is gone by
  construction, so what is left to measure is that the remaining path is cheap.
* **Slow-turn coverage** — of the turns that genuinely had a gap, how many got a
  filler, under the predicted-gap gate.
* **Diversity** — exact repeats inside the repeat window, distinct phrases over
  the run, and identical-waveform replays.
* **Gap bridging** — how much silence is left after each filler ends, and how
  often a filler is cut off mid-word instead.
* **Cost** — LLM calls and TTS syntheses per session, and the cache hit rate,
  including the cross-session hit rate a warm worker sees.

It does NOT measure real network latency, real TTS timing, or anything about how
the fillers SOUND — character fit and context fit are judged on real sessions by
the language-quality rubric, not here. Treat this as the structural half of the
evidence; the per-turn metrics from live traffic are the other half.

    python scripts/filler-bench.py --sessions 3 --turns 20
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import statistics
import sys
import time
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# The app's Settings model requires the full provider env at import time. This
# bench never reaches a provider (the TTS is a stub and no LLM is called), so
# placeholders are enough — and mean the bench runs on a laptop with no secrets.
for _key, _value in {
    "LIVEKIT_LOG_LEVEL": "WARNING",
    "LIVEKIT_API_KEY": "bench",
    "LIVEKIT_API_SECRET": "bench",
    "LIVEKIT_URL": "wss://bench.invalid",
    "OPENAI_API_KEY": "bench",
    "DEEPGRAM_API_KEY": "bench",
    "AWS_ACCESS_KEY_ID": "bench",
    "AWS_SECRET_ACCESS_KEY": "bench",
    "SQS_MESSAGE_EVENT_QUEUE_NAME": "bench",
    "ELEVEN_API_KEY": "bench",
    "SARVAM_API_KEY": "bench",
    "HUME_API_KEY": "bench",
    "CARTESIA_API_KEY": "bench",
    "SMALLEST_API_KEY": "bench",
    "LLM_TEMPERATURE": "0.7",
    "DEFAULT_MALE_VOICE_MODEL": "bench",
    "DEFAULT_FEMALE_VOICE_MODEL": "bench",
    "DEFAULT_NON_BINARY_VOICE_MODEL": "bench",
    "CORE_SERVICE_BASE_URL": "https://bench.invalid",
    "CORE_SERVICE_API_KEY": "bench",
    "SLACK_ALERTS_API_TOKEN": "bench",
    "SLACK_ALERTS_CHANNEL_ID": "bench",
}.items():
    os.environ.setdefault(_key, _value)

from app.core.livekit import filler_clips  # noqa: E402
from app.core.livekit.filler_clips import synthesize_clips  # noqa: E402
from app.core.livekit.filler_pool import FillerPool  # noqa: E402
from app.core.livekit.gap_predictor import GapPredictor  # noqa: E402

#: Base phrases, with the spoken length each one would have. Tiers matter more
#: than the exact words here: the selection logic is what is under test.
_BASE_PHRASES = [
    ("Hmm", "hesitation", 420),
    ("I see", "acknowledgement", 520),
    ("Right", "acknowledgement", 380),
    ("Let me think about that", "reflection", 1250),
    ("Mm-hmm", "acknowledgement", 400),
    ("Go on", "encouragement", 450),
    ("That's… a lot to sit with", "reflection", 1850),
    ("Okay", "acknowledgement", 360),
    ("Give me a moment with that", "reflection", 1600),
    ("Ah", "hesitation", 300),
    ("Well", "hesitation", 340),
    ("I hear you", "acknowledgement", 640),
    ("Take your time", "encouragement", 780),
    ("That's not a small thing", "reflection", 1420),
    ("Mm", "hesitation", 280),
    ("Yes…", "acknowledgement", 460),
    ("I'm still with you", "encouragement", 900),
    ("Let me sit with that a second", "reflection", 1720),
    ("Oh", "hesitation", 260),
    ("I understand", "acknowledgement", 820),
]


def _phrase_catalog(size: int):
    """A vocabulary of ``size`` phrases, so the pool can reach a realistic size.

    Production pools hold up to FILLER_POOL_MAX_CLIPS (40) accumulated over a
    session. Benching against ten phrases would report repeat rates that are an
    artefact of the toy vocabulary rather than of the selection rules.
    """
    catalog = list(_BASE_PHRASES)
    i = 0
    while len(catalog) < size:
        phrase, ftype, ms = _BASE_PHRASES[i % len(_BASE_PHRASES)]
        catalog.append((f"{phrase} ({len(catalog)})", ftype, ms))
        i += 1
    return catalog[:size]


def _next_latency(rng: random.Random, baseline: float, model: str) -> float:
    """One turn's reply latency, in ms.

    Real voice-pipeline latency within a session is AUTOCORRELATED: the model,
    region, prompt size and network path are all constant, so turns cluster
    around a session baseline with noise and the occasional spike. That is what
    makes a per-session EMA predictive at all.

    ``iid`` draws independently from the whole range instead. That is the
    worst case for any predictor — no history can inform the next draw — and is
    kept as a deliberately pessimistic bound, not as a model of reality.
    """
    if model == "iid":
        return rng.choice((350, 420, 500, 650, 800, 900, 1100, 1400, 1800, 2400, 3200))
    jitter = rng.gauss(0, baseline * 0.18)
    spike = rng.random() < 0.08
    value = baseline + jitter + (rng.uniform(600, 1800) if spike else 0.0)
    return max(180.0, value)


class _StubFrame:
    def __init__(self, data, sample_rate, num_channels):
        self.data = data
        self.sample_rate = sample_rate
        self.num_channels = num_channels


class _StubStream:
    def __init__(self, pcm, sample_rate):
        self._events = [_StubFrame(pcm, sample_rate, 1)]
        self._i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._i >= len(self._events):
            raise StopAsyncIteration
        frame = self._events[self._i]
        self._i += 1
        return type("E", (), {"frame": frame})()

    async def aclose(self):
        pass


class _StubTTS:
    """Stands in for the provider: returns silence of the scripted duration."""

    def __init__(self, counter, catalog):
        self.counter = counter
        self.catalog = catalog

    def synthesize(self, text):
        self.counter["synths"] += 1
        duration_ms = next(
            (
                ms
                for phrase, _, ms in self.catalog
                if phrase.lower().rstrip("….?") in text.lower()
            ),
            700,
        )
        samples = int(24000 * duration_ms / 1000)
        return _StubStream(b"\x00\x00" * samples, 24000)

    def stream(self):
        return _StubStream(b"", 24000)

    async def aclose(self):
        pass


class _StubClient:
    def __init__(self, counter, catalog, voice="asha"):
        self.counter = counter
        self.catalog = catalog
        self._voice = voice
        self._current_params = {"voice": voice}
        self._default_params = {}

    def create_clip_tts(self):
        return _StubTTS(self.counter, self.catalog)


class _SessionResult:
    def __init__(self):
        self.lead_ms: List[float] = []
        self.post_silence_ms: List[float] = []
        self.cut_early_ms: List[float] = []
        self.slow_turns = 0
        self.slow_turns_masked = 0
        self.played: List[str] = []
        self.repeats_in_window = 0
        self.waveform_repeats = 0
        self.llm_calls = 0


async def _run_session(args, counter, rng: random.Random, warm: bool) -> _SessionResult:
    result = _SessionResult()
    catalog = _phrase_catalog(args.vocabulary)
    client = _StubClient(counter, catalog)
    pool = FillerPool(max_clips=args.pool_max, repeat_window_plays=args.repeat_window)
    predictor = GapPredictor(prior_ms=900.0)
    # Each session runs on its own baseline latency, the way different scenarios
    # and models do in production.
    baseline = rng.uniform(500.0, 1600.0)

    # Session-start seed batch: this is what makes a filler available before the
    # learner's first turn at all.
    seed = [(p, t, 0) for p, t, _ in catalog[: args.seed_count]]
    result.llm_calls += 1
    counter["llm"] += 1
    pool.add(await synthesize_clips(client, seed, language="en-US", source="seed"))

    played_at: dict = {}
    played_waveforms: set = set()
    consecutive = 0

    for turn in range(args.turns):
        actual_ms = _next_latency(rng, baseline, args.latency_model)
        is_slow = actual_ms >= args.slow_threshold_ms
        if is_slow:
            result.slow_turns += 1

        predicted_ms = predictor.predict_ms()

        # The same gate the worker applies.
        play = predicted_ms >= args.floor_ms
        if play and consecutive >= args.max_consecutive:
            play = False
        elif play and predicted_ms < args.certain_ms:
            play = rng.random() <= args.probability

        if play:
            t0 = time.perf_counter()
            clip = pool.choose(target_ms=max(0.0, predicted_ms - args.tier_margin_ms))
            if clip is not None:
                pool.mark_played(clip)
                list(clip.frames)  # what building the audio source costs
                lead = (time.perf_counter() - t0) * 1000.0
                result.lead_ms.append(lead)
                result.played.append(clip.phrase)
                consecutive += 1
                if is_slow:
                    result.slow_turns_masked += 1

                # Measured in PLAYS, matching the pool's own window unit.
                play_index = len(result.played)
                prev = played_at.get(clip.phrase)
                if prev is not None and play_index - prev <= args.repeat_window:
                    result.repeats_in_window += 1
                played_at[clip.phrase] = play_index

                waveform = (clip.phrase, clip.variant)
                if waveform in played_waveforms:
                    result.waveform_repeats += 1
                played_waveforms.add(waveform)

                # A played phrase gets a second rendering queued for later, the
                # same way the worker does it — this is what stops a repeat
                # being the identical waveform.
                for phrase, ftype, variant in pool.variant_needed():
                    if phrase == clip.phrase:
                        pool.add(
                            await synthesize_clips(
                                client,
                                [(phrase, ftype, variant)],
                                language="en-US",
                                source="variant",
                            )
                        )

                # Continuation: if the clip ends into silence and the reply still
                # has not started, one more filler covers it (capped per turn).
                elapsed = lead + clip.duration_ms
                fillers_this_turn = 1
                while (
                    fillers_this_turn < args.max_per_turn
                    and actual_ms - elapsed > args.continuation_gap_ms
                ):
                    elapsed += args.continuation_gap_ms
                    nxt = pool.choose(target_ms=actual_ms - elapsed)
                    if nxt is None:
                        break
                    pool.mark_played(nxt)
                    result.played.append(nxt.phrase)
                    elapsed += nxt.duration_ms
                    fillers_this_turn += 1

                remaining = actual_ms - elapsed
                if remaining >= 0:
                    result.post_silence_ms.append(remaining)
                else:
                    result.cut_early_ms.append(-remaining)
            else:
                consecutive = 0
        else:
            consecutive = 0

        predictor.observe(actual_ms)

        # Exchange-driven regeneration: only when the pool is running low.
        if pool.fresh_count() < args.min_fresh:
            extra = [
                (p, t, 0) for p, t, _ in rng.sample(catalog, k=min(6, len(catalog)))
            ]
            extra.extend(pool.variant_needed()[:2])
            result.llm_calls += 1
            counter["llm"] += 1
            pool.add(
                await synthesize_clips(
                    client, extra, language="en-US", source="exchange"
                )
            )

    return result


def _pct(values: List[float], q: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, int(q * len(ordered)))
    return ordered[idx]


def _fmt(value: Optional[float], suffix: str = "") -> str:
    return "n/a" if value is None else f"{value:.1f}{suffix}"


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--sessions", type=int, default=3)
    ap.add_argument("--turns", type=int, default=20)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--floor-ms", type=float, default=700.0)
    ap.add_argument("--certain-ms", type=float, default=1200.0)
    ap.add_argument("--probability", type=float, default=0.6)
    ap.add_argument("--tier-margin-ms", type=float, default=150.0)
    ap.add_argument("--repeat-window", type=int, default=12)
    ap.add_argument("--max-consecutive", type=int, default=3)
    ap.add_argument("--min-fresh", type=int, default=5)
    ap.add_argument("--max-per-turn", type=int, default=2)
    ap.add_argument("--vocabulary", type=int, default=30)
    ap.add_argument("--pool-max", type=int, default=40)
    ap.add_argument(
        "--latency-model",
        choices=("autocorrelated", "iid"),
        default="autocorrelated",
        help="autocorrelated models a real session; iid is the pessimistic bound",
    )
    ap.add_argument("--continuation-gap-ms", type=float, default=450.0)
    ap.add_argument("--seed-count", type=int, default=8)
    ap.add_argument("--slow-threshold-ms", type=float, default=1000.0)
    args = ap.parse_args()

    counter = {"synths": 0, "llm": 0}
    filler_clips._CACHE = filler_clips._ClipCache(max_entries=200)
    rng = random.Random(args.seed)

    results: List[_SessionResult] = []
    per_session_synths: List[int] = []
    for i in range(args.sessions):
        before = counter["synths"]
        results.append(await _run_session(args, counter, rng, warm=i > 0))
        per_session_synths.append(counter["synths"] - before)

    lead = [v for r in results for v in r.lead_ms]
    silence = [v for r in results for v in r.post_silence_ms]
    cut = [v for r in results for v in r.cut_early_ms]
    played = [p for r in results for p in r.played]
    slow = sum(r.slow_turns for r in results)
    masked = sum(r.slow_turns_masked for r in results)
    cache = filler_clips.cache_stats()

    print()
    print(
        f"  sessions={args.sessions}  turns/session={args.turns}  "
        f"latency={args.latency_model}  vocabulary={args.vocabulary}"
    )
    print("  " + "-" * 58)
    print("  LEAD TIME (thinking -> first frame handed to the mixer)")
    print(f"    p50 {_fmt(_pct(lead, 0.5), 'ms')}   p95 {_fmt(_pct(lead, 0.95), 'ms')}")
    print("    (the 300-600ms deliberate wait is gone by construction)")
    print()
    print("  COVERAGE")
    pct = (masked / slow * 100.0) if slow else 0.0
    print(f"    slow turns {slow}, masked {masked}  ->  {pct:.0f}%")
    print()
    print("  GAP BRIDGING")
    print(
        f"    post-filler silence p50 {_fmt(_pct(silence, 0.5), 'ms')}"
        f"   p95 {_fmt(_pct(silence, 0.95), 'ms')}"
    )
    long_gaps = sum(1 for v in silence if v > 1000.0)
    total_played = len(played) or 1
    print(
        f"    'filler then >1s gap' turns: {long_gaps}/{total_played}"
        f" ({long_gaps / total_played * 100:.0f}%)"
    )
    print(f"    cut off mid-word p95 {_fmt(_pct(cut, 0.95), 'ms')} ({len(cut)} turns)")
    print()
    print("  DIVERSITY")
    print(
        f"    distinct phrases played {len(set(played))}/{len(played)}"
        f" ({len(set(played)) / total_played * 100:.0f}%)"
    )
    print(
        f"    repeats inside a {args.repeat_window}-play window: "
        f"{sum(r.repeats_in_window for r in results)}"
    )
    print(
        f"    identical waveform replayed: "
        f"{sum(r.waveform_repeats for r in results)}"
    )
    print()
    print("  COST")
    print(
        f"    llm calls total {counter['llm']} "
        f"({counter['llm'] / args.sessions:.1f}/session)"
    )
    print(
        f"    tts syntheses total {counter['synths']} "
        f"({counter['synths'] / args.sessions:.1f}/session)"
    )
    print(
        f"    first session {per_session_synths[0]} syntheses; "
        f"later sessions {statistics.mean(per_session_synths[1:]):.1f}"
        if len(per_session_synths) > 1
        else f"    first session {per_session_synths[0]} syntheses"
    )
    lookups = max(1, cache["hits"] + cache["misses"])
    print(
        f"    cache hits {cache['hits']} misses {cache['misses']} "
        f"({cache['hits'] / lookups * 100:.0f}% hit rate)"
    )
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
