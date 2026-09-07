"""Optional AI video actor — a face for the character, on top of its voice.

EXPERIMENTAL / TESTING FEATURE. Off everywhere by default. Read the safety
contract below before changing anything here.

## What it does

Normally the agent publishes one audio track and the learner sees a static
call card. With a video actor the agent's synthesized speech is routed through
an avatar renderer, which publishes a *synchronized* audio+video pair into the
same LiveKit room. The learner sees a talking face lip-synced to the voice
they already hear.

Nothing about STT, the LLM turn, turn detection or TTS changes. This layer
sits strictly after TTS, on the output side.

## Two runtime gates, both required (same shape as comfort audio)

* ``settings.VIDEO_ACTOR_ENABLED`` — the GLOBAL KILL SWITCH, default **True**.
  On means "the platform permits video where a roleplay asks for it", NOT
  "video is on". Set it False to stop video everywhere in one restart without
  touching a single roleplay.
* ``prompt_data.video_actor_enabled`` — the PER-ROLEPLAY flag, default
  **False**, and the one that actually decides. Unlike comfort audio (whose
  absence a learner experiences as a dead line, so it defaults on), an absent
  key here means off. A roleplay that has never heard of this feature must
  behave exactly as it does today, and "exactly as today" is audio-only. No
  roleplay sets it, so no session publishes video.

A third gate sits upstream in ally-be, out of this module's reach: the
``video_actor`` admin feature toggle decides which platform admins can even see
the per-roleplay switch in Simulation Studio. It is granted to nobody by
default, so nothing can reach the runtime gates here without a deliberate
grant first.

``is_video_actor_enabled`` is the only place the runtime decision is made.

## The safety contract — why this file is so defensive

Turning the avatar on means telling ``AgentSession`` to stop publishing its own
audio (``RoomOutputOptions(audio_enabled=False)``), because the avatar
republishes it in sync with the video. That is the one genuinely dangerous edge
in the feature: if the avatar is half-started, the learner hears **nothing**
and the session is worthless.

So the ordering is deliberate and must not be rearranged:

1. Gates are checked first. Disabled -> ``start_video_actor`` returns ``None``
   before importing, allocating or connecting anything at all. A disabled
   session executes two attribute reads more than it does today. That is the
   whole cost.
2. The avatar is started **before** ``session.start()``, under a bounded
   timeout (``VIDEO_ACTOR_START_TIMEOUT_S``).
3. Only if it returns a live handle does the caller pass ``audio_enabled=False``.

Any failure — bad config, missing plugin, vendor timeout, exception mid-start —
returns ``None``, and the caller starts the session exactly as it does today.
The feature degrades to plain voice, which is the product we already ship, and
the learner is never shown an error about a face they did not ask for.

## Providers

``settings.VIDEO_ACTOR_PROVIDER`` selects one:

* ``test_pattern`` (default) — renders IN THIS PROCESS with numpy. No new
  dependency, no vendor account, no per-minute bill, and explicitly NOT
  AI-generated video: it is an audio-reactive placeholder whose job is to prove
  the publish -> subscribe -> render path end to end. Use it to test the
  plumbing — but NOT to estimate bandwidth: it is a static image while the
  character is silent, so the encoder skips frames a real talking head would
  have to send.
* ``bey`` / ``tavus`` / ``hedra`` / ``anam`` / ``simli`` — real AI-generated
  streaming avatars. Each needs its ``livekit-plugins-<name>`` package and a
  vendor key. The package is imported LAZILY, so a deployment that has not
  installed it gets a log line and an audio-only session rather than an
  ImportError at worker boot.

Adding a hosted provider here means adding its row to the AI task registry
(``ally-be/src/llm/constants/ai-task-registry.constants.ts``) — a rendered
avatar is a model call like any other.
"""

from __future__ import annotations

import asyncio
import importlib
import time
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from livekit import rtc

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

# Provider id for the dependency-free in-process renderer.
PROVIDER_TEST_PATTERN = "test_pattern"

# Hosted providers -> the module that carries their ``AvatarSession``. Kept as
# data rather than a chain of imports so an unavailable vendor is a lookup miss
# instead of a crash, and so adding one is a one-line change.
HOSTED_PROVIDER_MODULES: Mapping[str, str] = {
    "bey": "livekit.plugins.bey",
    "tavus": "livekit.plugins.tavus",
    "hedra": "livekit.plugins.hedra",
    "anam": "livekit.plugins.anam",
    "simli": "livekit.plugins.simli",
}


def is_video_actor_enabled(scenario=None) -> bool:
    """Whether this session should publish a video actor.

    Two gates, BOTH required and both defaulting to off:
    ``settings.VIDEO_ACTOR_ENABLED`` is the global kill switch, and
    ``prompt_data.video_actor_enabled`` is the per-roleplay flag.

    Deliberately strict about the per-roleplay side: only an explicit true
    counts. A missing key, a null, a scenario with no prompt data at all — all
    of those are "this roleplay never opted in", which is every roleplay that
    exists today.
    """
    if not getattr(settings, "VIDEO_ACTOR_ENABLED", False):
        return False
    prompt_data = getattr(scenario, "prompt_data", None)
    if prompt_data is None:
        return False
    return getattr(prompt_data, "video_actor_enabled", False) is True


@dataclass
class VideoActorHandle:
    """A started video actor, and the one thing the caller must do with it.

    ``publishes_audio`` is the whole reason this object is returned rather than
    a bool: it is the caller's authority to pass
    ``RoomOutputOptions(audio_enabled=False)``. No handle, no suppression.
    """

    provider: str
    publishes_audio: bool
    _closer: Any = None

    async def aclose(self) -> None:
        """Tear the actor down. Never raises — this runs during shutdown."""
        if self._closer is None:
            return
        try:
            await self._closer()
        except Exception as e:  # noqa: BLE001 - shutdown must not fail
            logger.debug("[VIDEO_ACTOR] close error (ignored): %s", e)
        finally:
            self._closer = None


async def start_video_actor(
    *,
    session,
    room: rtc.Room,
    scenario=None,
) -> Optional[VideoActorHandle]:
    """Start the video actor for this session, or return ``None``.

    ``None`` means "run the session exactly as it runs today". Every failure
    path returns ``None``; this function does not raise. Call it BEFORE
    ``session.start()`` and only suppress room audio when it returns a handle.
    """
    if not is_video_actor_enabled(scenario):
        return None

    provider = str(getattr(settings, "VIDEO_ACTOR_PROVIDER", PROVIDER_TEST_PATTERN))
    timeout = float(getattr(settings, "VIDEO_ACTOR_START_TIMEOUT_S", 6.0))
    t0 = time.monotonic()

    try:
        handle = await asyncio.wait_for(
            _start_provider(
                provider=provider, session=session, room=room, scenario=scenario
            ),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        # The one failure worth a warning rather than a debug line: the vendor
        # accepted the connection but did not finish inside the start budget,
        # which is exactly the latency risk this feature carries.
        logger.warning(
            "[VIDEO_ACTOR] provider=%s did not start within %ss — "
            "session continues audio-only",
            provider,
            timeout,
        )
        return None
    except Exception as e:  # noqa: BLE001 - must never break a session
        logger.warning(
            "[VIDEO_ACTOR] provider=%s failed to start (%s) — "
            "session continues audio-only",
            provider,
            e,
        )
        return None

    if handle is None:
        return None

    logger.info(
        "[VIDEO_ACTOR] started provider=%s in %.0fms (agent audio now rides "
        "the avatar track)",
        provider,
        (time.monotonic() - t0) * 1000,
    )
    return handle


async def _start_provider(
    *, provider: str, session, room: rtc.Room, scenario=None
) -> Optional[VideoActorHandle]:
    """Dispatch to the configured provider. Raises; the caller converts."""
    if provider == PROVIDER_TEST_PATTERN:
        return await _start_test_pattern(session=session, room=room, scenario=scenario)

    module_path = HOSTED_PROVIDER_MODULES.get(provider)
    if module_path is None:
        logger.warning(
            "[VIDEO_ACTOR] unknown VIDEO_ACTOR_PROVIDER=%r (known: %s) — "
            "session continues audio-only",
            provider,
            ", ".join([PROVIDER_TEST_PATTERN, *sorted(HOSTED_PROVIDER_MODULES)]),
        )
        return None

    return await _start_hosted(
        provider=provider,
        module_path=module_path,
        session=session,
        room=room,
        scenario=scenario,
    )


# ---------------------------------------------------------------------------
# Hosted providers (real AI-generated streaming video)
# ---------------------------------------------------------------------------


async def _start_hosted(
    *, provider: str, module_path: str, session, room: rtc.Room, scenario=None
) -> Optional[VideoActorHandle]:
    """Start a vendor avatar that joins the room and publishes its own tracks.

    The import is lazy on purpose. These packages are not in ``pyproject.toml``
    — a deployment that wants a hosted avatar installs the one it pays for. An
    installation that has not gets a log line here rather than an ImportError
    at worker boot, which would take down every session including the ones with
    the feature off.
    """
    try:
        plugin = importlib.import_module(module_path)
    except ImportError:
        logger.warning(
            "[VIDEO_ACTOR] provider=%s selected but %s is not installed "
            "(pip install livekit-plugins-%s) — session continues audio-only",
            provider,
            module_path,
            provider,
        )
        return None

    avatar_session_cls = getattr(plugin, "AvatarSession", None)
    if avatar_session_cls is None:
        logger.warning(
            "[VIDEO_ACTOR] %s exposes no AvatarSession — session continues "
            "audio-only",
            module_path,
        )
        return None

    avatar_id = _resolve_avatar_id(scenario)
    if not avatar_id:
        logger.warning(
            "[VIDEO_ACTOR] provider=%s needs an avatar id (roleplay "
            "videoActorAvatarId, else VIDEO_ACTOR_AVATAR_ID) — session "
            "continues audio-only",
            provider,
        )
        return None

    # Vendors disagree on the kwarg name for "which face", and on whether the
    # key comes from the constructor or the environment. Offer what we have and
    # let the plugin take what it understands, rather than encoding one
    # vendor's signature as if it were the shared one.
    kwargs: dict[str, Any] = {"avatar_id": avatar_id}
    api_key = getattr(settings, "VIDEO_ACTOR_API_KEY", None)
    if api_key:
        kwargs["api_key"] = api_key

    try:
        avatar = avatar_session_cls(**kwargs)
    except TypeError:
        # Signature mismatch on the optional key — retry with the id alone,
        # which every plugin in the family accepts.
        avatar = avatar_session_cls(avatar_id=avatar_id)

    await avatar.start(session, room=room)

    async def _close() -> None:
        closer = getattr(avatar, "aclose", None)
        if closer is not None:
            await closer()

    return VideoActorHandle(provider=provider, publishes_audio=True, _closer=_close)


def _resolve_avatar_id(scenario=None) -> Optional[str]:
    """Per-roleplay avatar id, falling back to the deployment default."""
    prompt_data = getattr(scenario, "prompt_data", None)
    per_sim = (
        getattr(prompt_data, "video_actor_avatar_id", None) if prompt_data else None
    )
    return per_sim or getattr(settings, "VIDEO_ACTOR_AVATAR_ID", None) or None


# ---------------------------------------------------------------------------
# test_pattern — in-process, no dependency, NOT AI-generated
# ---------------------------------------------------------------------------


async def _start_test_pattern(
    *, session, room: rtc.Room, scenario=None
) -> Optional[VideoActorHandle]:
    """Publish an audio-reactive placeholder using the SDK's own AvatarRunner.

    Same output shape as a hosted avatar — one synchronized audio+video pair on
    a second participant-visible track — so everything downstream (the token
    grants, the learner's renderer, the bandwidth bill) is exercised for real.
    Only the pixels are fake.
    """
    from livekit.agents.voice.avatar import (
        AvatarOptions,
        AvatarRunner,
        QueueAudioOutput,
    )

    width = int(getattr(settings, "VIDEO_ACTOR_WIDTH", 480))
    height = int(getattr(settings, "VIDEO_ACTOR_HEIGHT", 480))
    fps = float(getattr(settings, "VIDEO_ACTOR_FPS", 15.0))
    sample_rate = int(getattr(settings, "VIDEO_ACTOR_SAMPLE_RATE", 24000))

    audio_io = QueueAudioOutput(sample_rate=sample_rate)
    video_gen = _TestPatternVideoGenerator(
        width=width, height=height, fps=fps, seed=_character_seed(scenario)
    )
    runner = AvatarRunner(
        room,
        audio_recv=audio_io,
        video_gen=video_gen,
        options=AvatarOptions(
            video_width=width,
            video_height=height,
            video_fps=fps,
            audio_sample_rate=sample_rate,
            audio_channels=1,
        ),
    )

    # Route the agent's TTS into the avatar instead of straight to the room.
    # Done only after the runner is constructed, so a construction failure
    # leaves the session's own audio output untouched.
    session.output.audio = audio_io
    try:
        await runner.start()
    except Exception:
        # Put the session's audio back the way we found it before re-raising,
        # so the caller's audio-only fallback really is audio-only.
        session.output.audio = None
        await video_gen.aclose()
        raise

    async def _close() -> None:
        await runner.aclose()
        await video_gen.aclose()

    return VideoActorHandle(
        provider=PROVIDER_TEST_PATTERN, publishes_audio=True, _closer=_close
    )


def _character_seed(scenario=None) -> int:
    """Stable hue per character, so the same roleplay always looks the same."""
    prompt_data = getattr(scenario, "prompt_data", None)
    name = (getattr(prompt_data, "name", None) or "ally") if prompt_data else "ally"
    return sum(ord(c) for c in str(name)) % 360


class _TestPatternVideoGenerator:
    """Audio-reactive placeholder frames. Implements ``VideoGenerator``.

    Structural-typing on purpose (no ABC subclass): ``AvatarRunner`` only ever
    calls ``push_audio``, ``clear_buffer`` and ``__aiter__``, and not inheriting
    keeps this module importable for the gate checks even on a build where the
    avatar package moved.

    The renderer is deliberately cheap — a precomputed background plus one
    filled circle whose radius follows the speech envelope — because it runs
    inside the same event loop as the conversation, and a placeholder that
    steals time from turn handling would poison the very latency measurement it
    exists to enable.
    """

    def __init__(self, *, width: int, height: int, fps: float, seed: int) -> None:
        self._width = width
        self._height = height
        self._fps = max(1.0, fps)
        self._closed = False
        # Bounded: if the renderer ever falls behind the TTS stream we drop the
        # oldest audio rather than growing without limit inside a live session.
        self._audio_q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._background, self._radius_grid = _build_static_layers(width, height, seed)

    async def push_audio(self, frame) -> None:
        try:
            self._audio_q.put_nowait(frame)
        except asyncio.QueueFull:
            logger.debug("[VIDEO_ACTOR] frame queue full — dropping oldest")
            try:
                self._audio_q.get_nowait()
                self._audio_q.put_nowait(frame)
            except Exception:  # noqa: BLE001
                pass

    def clear_buffer(self) -> None:
        """Barge-in: the learner interrupted, so pending speech is dead."""
        while True:
            try:
                self._audio_q.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def aclose(self) -> None:
        self._closed = True

    def __aiter__(self):
        return self._stream()

    async def _stream(self):
        """Interleave passthrough audio with video frames at a steady cadence.

        Audio is yielded untouched — the AVSynchronizer downstream is what
        aligns it with video, and re-timing it here would desync the lip
        movement from the voice the learner hears.

        THE VIDEO CLOCK IS CHECKED FIRST, and that ordering is the whole point.
        An earlier version waited on the audio queue and only rendered when
        that wait timed out. TTS delivers ~95 audio frames a second, so the
        queue was almost never empty, the deadline never came up, and a 15fps
        avatar measured 1.3fps against a live subscriber — audio passthrough
        starving the very frames the feature exists to publish. Deadline first,
        audio in the gaps: at 15fps the render costs ~7% of the interval, so
        both fit with room to spare.
        """
        from livekit.agents.voice.avatar import AudioSegmentEnd

        frame_interval = 1.0 / self._fps
        next_frame_at = time.monotonic()
        envelope = 0.0

        while not self._closed:
            now = time.monotonic()
            if now >= next_frame_at:
                yield self._render(envelope)
                # Decay between frames so the mouth closes after speech stops
                # instead of freezing open at the last amplitude it saw.
                envelope *= 0.72
                next_frame_at += frame_interval
                # A late tick must not send the loop into a catch-up burst of
                # frames the synchronizer would only have to drop.
                if next_frame_at < now:
                    next_frame_at = now + frame_interval
                continue

            try:
                item = await asyncio.wait_for(
                    self._audio_q.get(), timeout=next_frame_at - now
                )
            except asyncio.TimeoutError:
                # Deadline reached with no audio waiting — render on the next
                # pass rather than duplicating the render call here.
                continue

            if isinstance(item, AudioSegmentEnd):
                envelope = 0.0
            else:
                envelope = max(envelope, _frame_envelope(item))
            yield item

    def _render(self, envelope: float):
        import numpy as np

        buf = self._background.copy()
        # 0.18..0.42 of the frame: never a dot, never edge-to-edge.
        radius = (0.18 + 0.24 * min(1.0, envelope * 6.0)) * min(
            self._width, self._height
        )
        mask = self._radius_grid <= radius
        buf[mask, 0:3] = np.minimum(255, buf[mask, 0:3].astype(np.int16) + 70).astype(
            np.uint8
        )
        return rtc.VideoFrame(
            width=self._width,
            height=self._height,
            type=rtc.VideoBufferType.RGBA,
            data=buf.tobytes(),
        )


def _build_static_layers(width: int, height: int, seed: int):
    """Precompute the background and the per-pixel distance-to-centre grid.

    Both are constant for the session, so the per-frame cost is one array copy
    and one masked add rather than a full repaint.
    """
    import numpy as np

    r, g, b = _hue_to_rgb(seed)
    background = np.zeros((height, width, 4), dtype=np.uint8)
    background[:, :, 0] = r // 3
    background[:, :, 1] = g // 3
    background[:, :, 2] = b // 3
    background[:, :, 3] = 255

    ys, xs = np.mgrid[0:height, 0:width]
    radius_grid = np.sqrt((xs - width / 2.0) ** 2 + (ys - height / 2.0) ** 2)
    return background, radius_grid


def _hue_to_rgb(hue_deg: int) -> tuple[int, int, int]:
    """Full-saturation HSV->RGB, enough for a per-character tint."""
    h = (hue_deg % 360) / 60.0
    x = 1.0 - abs(h % 2.0 - 1.0)
    table = [
        (1.0, x, 0.0),
        (x, 1.0, 0.0),
        (0.0, 1.0, x),
        (0.0, x, 1.0),
        (x, 0.0, 1.0),
        (1.0, 0.0, x),
    ]
    r, g, b = table[int(h) % 6]
    return int(r * 255), int(g * 255), int(b * 255)


def _frame_envelope(frame) -> float:
    """Rough 0..1 loudness of one audio frame, for the pulse radius.

    RMS over int16 samples. Wrapped because a malformed frame must cost a still
    picture, never a raised exception inside the media loop.
    """
    try:
        import numpy as np

        samples = np.frombuffer(frame.data, dtype=np.int16)
        if samples.size == 0:
            return 0.0
        rms = float(np.sqrt(np.mean(np.square(samples.astype(np.float32)))))
        return min(1.0, rms / 8000.0)
    except Exception:  # noqa: BLE001 - a bad frame is not worth a dead avatar
        return 0.0
