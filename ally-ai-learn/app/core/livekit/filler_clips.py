"""In-memory, cached, duration-aware audio clips for the naturalness layers.

WHY THIS EXISTS
---------------
The original clip path (``filler_audio``, since deleted) rendered each phrase to
a temp WAV and handed LiveKit the PATH. That cost on every single play: the
library re-opens, decodes and resamples the file to 48 kHz inside the mixer
pull. It also loses the one fact the playback decision most needs — HOW LONG the
clip is — so a 0.6s "Hmm" can be chosen to mask a 2s gap and leave 1.4s of dead
air behind it, which reads worse than no filler at all.

This module renders a phrase ONCE into pre-decoded 48 kHz mono int16 frames held
in memory, exactly the way ``comfort_audio.comfort_ambient_source`` already feeds
the ambient slot, and keeps the measured duration alongside. Playback then costs
a list traversal, and the caller can pick a clip that FITS the gap.

Two further wins fall out of holding the audio rather than a path:

* **A process-local cache.** Fillers repeat by construction — the prompt asks for
  hesitations and acknowledgements, so "Hmm", "I see", "अच्छा" recur many times
  per session and across sessions on the same worker. Keyed by voice + language +
  phrase + variant, a hit costs no TTS call at all.
* **Rendering variants.** Playing the identical waveform twice is what makes a
  filler sound canned. A second rendering of the same phrase (different trailing
  punctuation) gives the pool two distinct takes of one line.

Everything here is best-effort: a failure yields fewer or zero clips and the
session continues without a filler — it must never break the agent.
"""

from __future__ import annotations

import array
import asyncio
import hashlib
import re
import sys
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Sequence, Tuple

from app.core.livekit import clip_store
from app.core.logger import get_logger

logger = get_logger(__name__)

#: The BackgroundAudioPlayer's mixer and source both run at 48 kHz
#: (``rtc.AudioMixer(48000, ...)``). Frames handed to it at another rate are
#: resampled by the library and read at the wrong character, so clips are
#: normalised to this rate — see comfort_audio for the same constraint.
MIXER_SAMPLE_RATE = 48000

#: Samples per emitted frame (100 ms at 48 kHz). Matches comfort audio's chunking:
#: small enough that the mixer's per-stream ``stream_timeout_ms`` (200 ms) can
#: never be exceeded by a pull, large enough not to churn objects.
FRAME_SAMPLES = 4800

#: Duration tiers, in milliseconds: (name, low, high). The playback decision picks
#: the tier whose span best covers the predicted gap, so a filler ends about when
#: the real reply starts instead of trailing silence. Bounds are inclusive-low,
#: exclusive-high; anything longer than the last tier's high still lands in it.
TIERS: Tuple[Tuple[str, float, float], ...] = (
    ("micro", 0.0, 700.0),
    ("short", 700.0, 1400.0),
    ("long", 1400.0, float("inf")),
)

#: Filler types the predictive prompt is asked to vary across. Playback rotates
#: types so two consecutive fillers are never the same kind of noise.
FILLER_TYPES = ("hesitation", "acknowledgement", "reflection", "encouragement")


def tier_for_duration(duration_ms: float) -> str:
    """Name the duration tier ``duration_ms`` falls into."""
    for name, low, high in TIERS:
        if low <= duration_ms < high:
            return name
    return TIERS[-1][0]


@dataclass
class FillerClip:
    """One rendered phrase: its text, its audio, and everything playback needs.

    ``frames`` holds pre-decoded ``rtc.AudioFrame`` objects at
    ``MIXER_SAMPLE_RATE``. The mixer treats frames as read-only (it copies before
    scaling volume), so the same objects are safe to replay and to share between
    the pool and the cache.
    """

    phrase: str
    frames: List[Any]
    duration_ms: float
    #: One of FILLER_TYPES; "unknown" for static Studio phrases, which carry no tag.
    filler_type: str = "unknown"
    #: Which rendering of this phrase (0 = first). Distinct variants of one phrase
    #: are different waveforms, so a repeat never sounds like a tape loop.
    variant: int = 0
    #: Turn index this clip was last played on; -1 = never. Used for recency.
    last_played_turn: int = -1
    #: Where the phrase came from: static | seed | exchange | in_turn.
    source: str = "unknown"
    #: Other curated takes of the same text, as ``(frames, duration_ms)``, from
    #: the clip store. Playback may rotate through them so a repeated line is
    #: never the same recording twice. Empty for a single render.
    alternates: List[Tuple[List[Any], float]] = field(default_factory=list)

    @property
    def tier(self) -> str:
        return tier_for_duration(self.duration_ms)

    @property
    def key(self) -> Tuple[str, int]:
        """Identity for de-duplication: the phrase text plus which rendering."""
        return (self.phrase.strip().lower(), self.variant)


def clip_audio_source(clip: FillerClip) -> AsyncIterator:
    """An async iterator over ``clip``'s frames, for ``AudioConfig``.

    Yields instantly (the audio is already decoded and in memory), so unlike a
    file-backed source it can never exceed the mixer's per-stream pull timeout
    and get dropped — the failure mode documented in ``comfort_audio``.
    """

    async def _iter():
        for frame in clip.frames:
            yield frame

    return _iter()


def _normalize_for_synthesis(phrase: str) -> str:
    """Avoid an ALL-CAPS filler being read out as spelled-out letters.

    Several TTS providers treat a fully-uppercase token as an acronym and spell
    it letter by letter — e.g. a "MMM" hesitation heard as "M, M, M" instead of a
    hum. Mixed- or lower-case text (the common case) is untouched.
    """
    return phrase.lower() if phrase.isupper() else phrase


def _variant_text(phrase: str, variant: int) -> str:
    """Text to synthesize for rendering ``variant`` of ``phrase``.

    Variant 0 is the phrase as authored. Later variants nudge the trailing
    punctuation, which most TTS engines render with a different contour and
    pause — enough that the two takes are audibly distinct rather than the same
    recording played twice. The words never change, so a variant can't alter what
    the character actually says.
    """
    if variant <= 0:
        return phrase
    stripped = phrase.rstrip(" .,!?…")
    if not stripped:
        return phrase
    suffixes = ("…", ".", "?")
    return stripped + suffixes[(variant - 1) % len(suffixes)]


_FINGERPRINT_IGNORED = frozenset({"_tts_instance", "_base_tts", "_api_key"})


def voice_fingerprint(tts_client) -> str:
    """A stable hash of everything that changes how this voice sounds.

    The cache is keyed on this, so it MUST cover every stored parameter, not just
    the voice id: serving a clip rendered in a different voice, speed or model is
    worse than having no filler at all. We hash the client class plus its full
    stored parameter dicts and any private scalar attributes (``_voice``,
    ``_model``, ``_language``, …), which is where each provider client keeps the
    settings it builds ``tts_instance`` from.
    """
    try:
        parts: List[str] = [type(tts_client).__name__]
        for attr in ("_default_params", "_current_params"):
            params = getattr(tts_client, attr, None)
            if isinstance(params, dict):
                parts.append(
                    ",".join(f"{k}={params[k]!r}" for k in sorted(params, key=str))
                )
        # Provider clients store their resolved settings as private scalars built
        # in __init__; include every simple one so nothing voice-affecting is
        # missed. Non-scalars (clients, instances) are skipped — they carry no
        # setting and their repr isn't stable.
        for name in sorted(vars(tts_client)):
            if name in ("_default_params", "_current_params"):
                continue
            # Not voice settings: the lazily built instance is None before first
            # use and an object after (so it flipped the hash mid-session), and
            # a rotated API key must not orphan every stored clip.
            if name in _FINGERPRINT_IGNORED:
                continue
            value = getattr(tts_client, name, None)
            if isinstance(value, (str, int, float, bool)) or value is None:
                parts.append(f"{name}={value!r}")
        return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16]
    except Exception:  # noqa: BLE001 - a fingerprint must never break a session
        # Unhashable client: fall back to a per-instance key so the cache stays
        # correct (it just can't be shared between sessions).
        return f"id{id(tts_client):x}"


class _ClipCache:
    """Bounded, thread-safe LRU of rendered clips, shared across sessions.

    Sized in clips rather than bytes: a filler is ~1 s of 48 kHz mono int16
    (~96 KB), so the default cap is on the order of 20 MB for a worker that runs
    many sessions. Values are immutable audio; the per-session pool wraps them in
    its own ``FillerClip`` records so playback bookkeeping never mutates a shared
    entry.
    """

    def __init__(self, max_entries: int = 200) -> None:
        self._max = max(1, max_entries)
        self._data: "OrderedDict[str, Tuple[List[Any], float, list]]" = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[Tuple[List[Any], float, list]]:
        with self._lock:
            value = self._data.get(key)
            if value is None:
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return value

    def put(
        self,
        key: str,
        frames: List[Any],
        duration_ms: float,
        alternates: Optional[list] = None,
    ) -> None:
        with self._lock:
            self._data[key] = (frames, duration_ms, list(alternates or []))
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def stats(self) -> Dict[str, int]:
        with self._lock:
            return {"hits": self.hits, "misses": self.misses, "size": len(self._data)}


#: Process-local clip cache, shared by every session this worker runs. A phrase
#: rendered for one learner is instantly available to the next.
_CACHE = _ClipCache()


def cache_stats() -> Dict[str, int]:
    """Hit/miss/size counters for the shared clip cache (for session logging)."""
    return _CACHE.stats()


def _cache_key(fingerprint: str, language: str, phrase: str, variant: int) -> str:
    return f"{fingerprint}|{language}|{variant}|{phrase.strip().lower()}"


def _frames_from_pcm(pcm: bytes, sample_rate: int, channels: int) -> List[Any]:
    """Slice int16 PCM into ``rtc.AudioFrame``s at ``FRAME_SAMPLES`` each."""
    from livekit import rtc

    bytes_per_frame = FRAME_SAMPLES * 2 * max(1, channels)
    frames: List[Any] = []
    for off in range(0, len(pcm), bytes_per_frame):
        chunk = pcm[off : off + bytes_per_frame]
        samples_per_channel = len(chunk) // (2 * max(1, channels))
        if samples_per_channel:
            frames.append(
                rtc.AudioFrame(
                    chunk, sample_rate, max(1, channels), samples_per_channel
                )
            )
    return frames


def _resample_to_mixer_rate(pcm: bytes, src_rate: int, channels: int) -> bytes:
    """Convert int16 PCM to mono at ``MIXER_SAMPLE_RATE``.

    Providers return whatever rate they like (Sarvam 22.05 kHz, others 24 kHz);
    the mixer runs at 48 kHz. Handing it off-rate frames makes the clip play at
    the wrong pitch and speed, so normalise here — once, at synthesis — rather
    than letting the library resample on every play. Nearest-neighbour is ample
    for a one-second hesitation and needs no extra dependency.
    """
    import array

    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) - (len(pcm) % 2)])
    if channels > 1:
        # Downmix to mono by averaging the interleaved channels.
        mono = array.array("h")
        for i in range(0, len(samples) - channels + 1, channels):
            mono.append(int(sum(samples[i : i + channels]) / channels))
        samples = mono
    if src_rate == MIXER_SAMPLE_RATE or not samples:
        return samples.tobytes()
    ratio = MIXER_SAMPLE_RATE / float(src_rate)
    out_len = int(len(samples) * ratio)
    out = array.array("h", bytes(out_len * 2))
    for i in range(out_len):
        src_index = int(i / ratio)
        if src_index >= len(samples):
            break
        out[i] = samples[src_index]
    return out.tobytes()


async def _collect_pcm(stream) -> Tuple[bytes, int, int]:
    """Drain a TTS stream into ``(pcm, sample_rate, num_channels)``."""
    chunks: List[bytes] = []
    sample_rate = 24000
    num_channels = 1
    try:
        async for ev in stream:
            frame = getattr(ev, "frame", None)
            if frame is None:
                continue
            chunks.append(bytes(frame.data))
            sample_rate = frame.sample_rate
            num_channels = frame.num_channels
    finally:
        aclose = getattr(stream, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:  # noqa: BLE001
                pass
    return b"".join(chunks), sample_rate, num_channels


#: Peak (int16) below which a 10 ms window counts as silence at a clip's edges.
_EDGE_SILENCE_PEAK = 300
#: Audio kept either side of the trimmed speech so onsets and tails aren't
#: clipped.
_EDGE_PAD_MS = 40.0
#: A render shorter than this is not speech (an empty or failed generation).
_MIN_CLIP_MS = 120.0
#: Longest plausible render: a fixed allowance plus a generous per-character
#: rate (conversational speech runs ~65 ms per character).
_MAX_CLIP_BASE_MS = 1200.0
_MAX_CLIP_MS_PER_CHAR = 110.0
#: Each trailing-off or sentence mark is a pause the voice is asked to take
#: ("Hmm… Well…"); v3 holds ~0.4-0.6 s on each.
_MAX_CLIP_MS_PER_PAUSE = 700.0
_PAUSE_MARKS = re.compile(r"…|\.\.\.|[.!?।]")
_AUDIO_TAG = re.compile(r"\[[^\]]*\]")


def _trim_edge_silence(mono: bytes) -> bytes:
    """Drop leading and trailing near-silence from 16-bit mono PCM.

    Generative voices (ElevenLabs v3) often open a render with a few hundred
    ms of silence. On an opener that silence is pure added latency, heard
    after the hold, so it is cut here, once, at render time.
    """
    samples = array.array("h")
    samples.frombytes(mono[: len(mono) - (len(mono) % 2)])
    if sys.byteorder != "little":
        samples.byteswap()
    win = MIXER_SAMPLE_RATE // 100
    n = len(samples)
    if n == 0:
        return mono

    def loud(start: int) -> bool:
        chunk = samples[start : start + win]
        return bool(chunk) and max(abs(v) for v in chunk) >= _EDGE_SILENCE_PEAK

    first = next((i for i in range(0, n, win) if loud(i)), None)
    if first is None:
        return b""
    last = next(i for i in range(((n - 1) // win) * win, -1, -win) if loud(i))
    pad = int(MIXER_SAMPLE_RATE * _EDGE_PAD_MS / 1000.0)
    start = max(0, first - pad)
    end = min(n, last + win + pad)
    return mono[start * 2 : end * 2]


def _plausible_duration(text: str, duration_ms: float) -> bool:
    """Whether a render's length fits the text it was asked to say.

    ElevenLabs v3 is unreliable on very short text: it can return a long
    run-on generation or near-nothing for "Hmm." A clip outside these bounds
    is dropped rather than played as a stray second utterance.
    """
    spoken = _AUDIO_TAG.sub("", text or "").strip()
    max_ms = (
        _MAX_CLIP_BASE_MS
        + _MAX_CLIP_MS_PER_CHAR * len(spoken)
        + _MAX_CLIP_MS_PER_PAUSE * len(_PAUSE_MARKS.findall(spoken))
    )
    return _MIN_CLIP_MS <= duration_ms <= max_ms


def _synthesis_text(phrase: str, variant: int) -> str:
    """The exact text sent to the TTS for ``variant`` of ``phrase``.

    One place, because it is also what clip TTS is billed on (characters).
    """
    return _variant_text(_normalize_for_synthesis(phrase), variant)


def _emit_clip_tts_usage(
    characters: int,
    room_id: Optional[str],
    provider: Optional[str],
    model: Optional[str],
) -> None:
    """Record real clip synthesis as ``clip_tts``. Never raises.

    The clip instance is an isolated clone (``create_clip_tts``), never the
    AgentSession's own TTS, so LiveKit's ``metrics_collected`` hook — which is
    where ``agent_tts`` comes from — never sees it. Without this row filler,
    back-channel and interim audio would be free on the cost dashboard.
    """
    try:
        from app.core.llm_usage.emitter import _resolve_room_id, emit_ai_usage
        from app.core.llm_usage.tasks import LLMTask

        emit_ai_usage(
            _resolve_room_id(room_id),
            service="tts",
            provider=provider,
            model=model,
            task=LLMTask.CLIP_TTS.value,
            characters=characters,
        )
    except Exception:  # noqa: BLE001 - usage must never break a session
        logger.debug("[FILLER] clip_tts usage skipped", exc_info=True)


async def _render_one(
    tts, phrase: str, variant: int
) -> Optional[Tuple[List[Any], float]]:
    """Synthesize one phrase variant to ``(frames, duration_ms)``, or None.

    Best-effort: returns ``None`` for an empty phrase, no synthesized audio, or
    any failure — never raises, so one bad phrase can't break the whole batch.

    Tries the one-shot ``synthesize()`` path first, then falls back to the
    websocket ``stream()`` path: some providers (Sarvam) have a broken one-shot
    endpoint (libav InvalidDataError, zero frames) while their streaming path —
    the one the live agent speaks through — works fine.
    """
    text = _synthesis_text(phrase, variant)
    if not text.strip():
        return None
    try:
        pcm, sample_rate, channels = b"", 24000, 1
        try:
            pcm, sample_rate, channels = await _collect_pcm(tts.synthesize(text))
        except Exception as e:  # noqa: BLE001 - fall through to stream()
            logger.info(
                "[FILLER] one-shot synth failed for %r (%s) — trying stream()", text, e
            )

        if not pcm:
            stream = tts.stream()
            stream.push_text(text)
            flush = getattr(stream, "flush", None)
            if flush is not None:
                flush()
            stream.end_input()
            pcm, sample_rate, channels = await _collect_pcm(stream)

        if not pcm:
            logger.warning("[FILLER] no audio synthesized for %r", text)
            return None

        mono = _trim_edge_silence(_resample_to_mixer_rate(pcm, sample_rate, channels))
        duration_ms = (len(mono) / 2.0) / MIXER_SAMPLE_RATE * 1000.0
        if not _plausible_duration(text, duration_ms):
            logger.warning(
                "[FILLER] dropped implausible render for %r: %.0f ms", text, duration_ms
            )
            return None
        frames = _frames_from_pcm(mono, MIXER_SAMPLE_RATE, 1)
        if not frames:
            return None
        return frames, duration_ms
    except Exception as e:  # noqa: BLE001 - a filler must never break a session
        logger.warning("[FILLER] failed to synthesize %r: %s", text, e)
        return None


def _synthesis_concurrency() -> int:
    """How many clip syntheses may run at once (``CLIP_SYNTH_CONCURRENCY``)."""
    try:
        from app.core.config import settings

        return max(1, int(getattr(settings, "CLIP_SYNTH_CONCURRENCY", 3)))
    except Exception:  # noqa: BLE001 - a setting must never break synthesis
        return 3


def clip_tts_available(tts_client) -> bool:
    """Whether ``tts_client`` can render clips at all this session.

    Checked before the filler, back-channel and interim LLM calls: their phrases
    are only ever heard as clips, so for a voice that renders none (the clip
    policy refuses it, or it can't be isolated) the call is paid for and thrown
    away. Fails closed on anything that isn't a ``BaseTTSClient``-shaped client.
    """
    check = getattr(tts_client, "can_create_clip_tts", None)
    if check is None:
        return False
    try:
        return check() is True
    except Exception:  # noqa: BLE001 - a policy check must never break a session
        logger.warning("[FILLER] clip availability check failed", exc_info=True)
        return False


def _pcm_of(frames: List[Any]) -> bytes:
    """The raw 16-bit mono PCM behind ``frames`` (the store's format)."""
    return b"".join(bytes(f.data) for f in frames)


def _take_from_pcm(pcm: bytes) -> Optional[Tuple[List[Any], float]]:
    pcm = pcm[: len(pcm) - (len(pcm) % 2)]
    frames = _frames_from_pcm(pcm, MIXER_SAMPLE_RATE, 1)
    if not frames:
        return None
    return frames, (len(pcm) / 2.0) / MIXER_SAMPLE_RATE * 1000.0


async def _fill_from_store(
    misses: List[int],
    requests: List[Tuple[str, str, int]],
    results: List[Optional[FillerClip]],
    fingerprint: str,
    language: str,
    source: str,
) -> List[int]:
    """Serve cache misses from the persistent store; return what is left.

    A stored line arrives with every curated take: the best becomes the clip,
    the rest its alternates. Loaded takes also go into the process cache, so
    the next session on this worker skips even the store.
    """
    if not clip_store.enabled():
        return misses
    texts = {i: _synthesis_text(requests[i][0], requests[i][2]) for i in misses}
    stored = await clip_store.load_many(
        fingerprint, clip_store.store_language(language), list(texts.values())
    )
    left: List[int] = []
    for i in misses:
        takes = [t for t in (_take_from_pcm(p) for p in stored.get(texts[i], [])) if t]
        if not takes:
            left.append(i)
            continue
        (frames, duration_ms), alternates = takes[0], takes[1:]
        phrase, ftype, variant = requests[i]
        _CACHE.put(
            _cache_key(fingerprint, language, phrase, variant),
            frames,
            duration_ms,
            alternates,
        )
        results[i] = FillerClip(
            phrase=phrase,
            frames=frames,
            duration_ms=duration_ms,
            filler_type=ftype,
            variant=variant,
            source=source,
            alternates=alternates,
        )
    if len(left) < len(misses):
        logger.info(
            "[CLIP_STORE] served %d of %d line(s) from the store",
            len(misses) - len(left),
            len(misses),
        )
    return left


async def synthesize_clips(
    tts_client,
    phrases: Sequence[Any],
    language: str = "unknown",
    source: str = "unknown",
    use_cache: bool = True,
    usage_room_id: Optional[str] = None,
    usage_provider: Optional[str] = None,
    usage_model: Optional[str] = None,
) -> List[FillerClip]:
    """Render ``phrases`` to in-memory clips, using the shared cache.

    ``phrases`` accepts plain strings or ``(phrase, filler_type)`` /
    ``(phrase, filler_type, variant)`` tuples, so a typed batch from the
    predictive prompt keeps its tags. Cache hits cost no TTS call; misses are
    synthesized in parallel on an ISOLATED TTS instance (``create_clip_tts``) —
    the AgentSession closes itself after a few unrecoverable errors on its own
    instance, so clip failures on the shared one can kill a live session (prod
    Marathi outage, 2026-08-20). When no isolated instance can be built we
    synthesize nothing and return only cache hits: silence is strictly better
    than a dead session.

    Input order is preserved; per-phrase failures are skipped, never raised.

    Every phrase actually synthesized is recorded as ``clip_tts`` (characters
    sent) against ``usage_room_id``, tagged ``usage_provider`` /
    ``usage_model``. Cache hits cost no TTS call and record nothing; a phrase
    that rendered no audio records nothing either.
    """
    requests: List[Tuple[str, str, int]] = []
    for item in phrases or []:
        phrase, ftype, variant = "", "unknown", 0
        if isinstance(item, str):
            phrase = item
        elif isinstance(item, (tuple, list)) and item:
            phrase = item[0] if isinstance(item[0], str) else ""
            if len(item) > 1 and isinstance(item[1], str):
                ftype = item[1]
            if len(item) > 2:
                try:
                    variant = int(item[2])
                except (TypeError, ValueError):
                    variant = 0
        if phrase and phrase.strip():
            requests.append((phrase.strip(), ftype, variant))
    if not requests:
        return []

    fingerprint = voice_fingerprint(tts_client)
    results: List[Optional[FillerClip]] = [None] * len(requests)
    misses: List[int] = []

    for i, (phrase, ftype, variant) in enumerate(requests):
        cached = (
            _CACHE.get(_cache_key(fingerprint, language, phrase, variant))
            if use_cache
            else None
        )
        if cached is not None:
            frames, duration_ms, alternates = cached
            results[i] = FillerClip(
                phrase=phrase,
                frames=frames,
                duration_ms=duration_ms,
                filler_type=ftype,
                variant=variant,
                source=source,
                alternates=list(alternates),
            )
        else:
            misses.append(i)

    if misses and use_cache:
        misses = await _fill_from_store(
            misses, requests, results, fingerprint, language, source
        )

    if misses:
        create = getattr(tts_client, "create_clip_tts", None)
        tts = create() if create is not None else None
        if tts is None:
            logger.warning(
                "[FILLER] no isolated clip TTS available — skipping %d synthesis "
                "(cache served %d) rather than risking the session's TTS error budget",
                len(misses),
                len(requests) - len(misses),
            )
        else:
            # Bounded, not all at once: a scenario with many Studio filler words
            # renders a 24-entry opener catalog at session start, and firing
            # every request together drew bursts of ElevenLabs 429 "Too Many
            # Requests" in prod (2026-09-30).
            limit = asyncio.Semaphore(_synthesis_concurrency())

            async def _bounded(index: int):
                async with limit:
                    return await _render_one(
                        tts, requests[index][0], requests[index][2]
                    )

            try:
                rendered = await asyncio.gather(*[_bounded(i) for i in misses])
            finally:
                aclose = getattr(tts, "aclose", None)
                if aclose is not None:
                    try:
                        await aclose()
                    except Exception:  # noqa: BLE001
                        pass
            synthesized_chars = 0
            for i, out in zip(misses, rendered):
                if out is None:
                    continue
                frames, duration_ms = out
                phrase, ftype, variant = requests[i]
                synthesized_chars += len(_synthesis_text(phrase, variant))
                if use_cache:
                    _CACHE.put(
                        _cache_key(fingerprint, language, phrase, variant),
                        frames,
                        duration_ms,
                    )
                    clip_store.save_in_background(
                        fingerprint,
                        clip_store.store_language(language),
                        _synthesis_text(phrase, variant),
                        _pcm_of(frames),
                    )
                results[i] = FillerClip(
                    phrase=phrase,
                    frames=frames,
                    duration_ms=duration_ms,
                    filler_type=ftype,
                    variant=variant,
                    source=source,
                )
            if synthesized_chars:
                _emit_clip_tts_usage(
                    synthesized_chars, usage_room_id, usage_provider, usage_model
                )

    return [clip for clip in results if clip is not None]
