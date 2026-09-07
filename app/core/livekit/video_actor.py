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

* ``tavus`` (default) — real AI-generated video, and the vendor this platform
  is wired for. Needs ``VIDEO_ACTOR_API_KEY`` (or ``TAVUS_API_KEY``) and a
  replica id; without either it falls back to audio-only, which is exactly why
  it is the default rather than the placeholder below — a misconfiguration
  should cost the learner nothing, not render them a coloured blob.
* ``test_pattern`` — an audio-reactive placeholder rendered IN THIS PROCESS
  with numpy. No dependency, no vendor account, no bill, and explicitly NOT
  AI-generated video. Kept as an explicit opt-in for proving the
  publish -> subscribe -> render path without a vendor account; never point it
  at a real cohort. Also not a bandwidth estimate: it is a static image while
  the character is silent, so the encoder skips frames a real talking head
  would have to send.
* ``bey`` / ``anam`` / ``simli`` — same abstraction, plugins not installed.
  Imports are LAZY, so an absent one gets a log line and an audio-only session
  rather than an ImportError at worker boot.

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
    "tavus": "livekit.plugins.tavus",
    "bey": "livekit.plugins.bey",
    "anam": "livekit.plugins.anam",
    "simli": "livekit.plugins.simli",
}

# Identities the hosted providers give the participant they add to the room.
#
# This is not cosmetic bookkeeping. A hosted avatar joins as a SECOND remote
# participant, and this worker has two "is anyone still here?" checks that read
# ``room.remote_participants`` — the orphan deadline and the pause guard. Left
# unfiltered, the avatar counts as company: a learner who closes the tab before
# connecting leaves an agent that never notices it is alone, holding a worker
# slot and a metered vendor conversation open until the max-duration cap fires.
# ``is_avatar_participant`` is what keeps those checks counting humans.
#
# Tavus's own default (``_AVATAR_AGENT_IDENTITY`` in its avatar.py) is
# "tavus-avatar-agent"; the rest follow the same ``<vendor>-avatar-agent``
# shape. The suffix check below is the real guard, so a vendor that renames its
# default is still caught.
AVATAR_PARTICIPANT_IDENTITIES: Mapping[str, str] = {
    "tavus": "tavus-avatar-agent",
    "bey": "bey-avatar-agent",
    "anam": "anam-avatar-agent",
    "simli": "simli-avatar-agent",
}

_AVATAR_IDENTITY_SUFFIX = "-avatar-agent"


def _as_websocket_url(url: Optional[str]) -> Optional[str]:
    """Coerce a LiveKit URL to the ws/wss scheme a vendor can dial.

    The job URL the SDK hands us (``RunningJobInfo.url``) can carry an http(s)
    scheme — that is the API form, not the client form. Vendors differ in how
    forgiving they are: Tavus normalises it silently, while Beyond Presence
    rejects it outright with

        400 Invalid LiveKit URL. Expected format: ws[s]://<host>[:<port>].

    which surfaces here only as "failed to start" and an audio-only session.
    The host is never the problem — a regional media host dials fine — so this
    rewrites the scheme and leaves everything else alone.
    """
    if not url:
        return url
    if url.startswith("https://"):
        return "wss://" + url[len("https://") :]
    if url.startswith("http://"):
        return "ws://" + url[len("http://") :]
    return url


def is_avatar_participant(identity: Optional[str]) -> bool:
    """Whether a room participant is a rendering avatar rather than a person.

    Used by every "is anyone still here?" check in the worker. Errs toward
    calling something an avatar ONLY on an exact known identity or the shared
    ``-avatar-agent`` suffix, so a real learner can never be mistaken for one
    and silently stripped from a headcount.
    """
    if not identity:
        return False
    return identity in AVATAR_PARTICIPANT_IDENTITIES.values() or identity.endswith(
        _AVATAR_IDENTITY_SUFFIX
    )


def human_participants(room) -> list:
    """Remote participants that are actual people.

    The avatar the agent itself commissioned does not count as company.
    """
    remote = getattr(room, "remote_participants", None) or {}
    return [
        p
        for p in remote.values()
        if not is_avatar_participant(getattr(p, "identity", None))
    ]


def _tavus_kwargs(plugin, *, avatar_id, api_key, character_name) -> dict:
    """Tavus names its two ids `replica_id` (the face) and `persona_id`.

    `replica_id` takes the resolved per-roleplay/deployment avatar id, so one
    setting means the same thing across vendors. `persona_id` is optional and
    Tavus falls back to a stock persona without it — which is what we want: the
    character's personality comes from OUR prompt and OUR LLM, and letting a
    vendor persona speak for it would put a second, unversioned character
    definition in the loop.

    NOTE the replica must be a **phoenix-3** model. A phoenix-4 replica is
    accepted by the API, joins the room, and then publishes nothing at all
    (observed 2026-09-07).
    """
    kwargs: dict[str, Any] = {}
    if avatar_id:
        kwargs["replica_id"] = avatar_id
    persona = getattr(settings, "VIDEO_ACTOR_TAVUS_PERSONA_ID", None)
    if persona:
        kwargs["persona_id"] = persona
    if api_key:
        kwargs["api_key"] = api_key
    return kwargs


def _bey_kwargs(plugin, *, avatar_id, api_key, character_name) -> dict:
    """Beyond Presence: a plain `avatar_id`, key alongside it."""
    kwargs: dict[str, Any] = {"avatar_id": avatar_id}
    if api_key:
        kwargs["api_key"] = api_key
    return kwargs


def _anam_kwargs(plugin, *, avatar_id, api_key, character_name) -> dict:
    """Anam wants a `PersonaConfig(name, avatarId)`, not a bare id.

    The name is cosmetic — it labels the session in Anam's own dashboard — so
    it carries the character's name, which is what someone debugging a specific
    roleplay from that end would search for.
    """
    kwargs: dict[str, Any] = {
        "persona_config": plugin.PersonaConfig(
            name=character_name or "ally-roleplay", avatarId=avatar_id
        )
    }
    if api_key:
        kwargs["api_key"] = api_key
    return kwargs


def _simli_kwargs(plugin, *, avatar_id, api_key, character_name) -> dict:
    """Simli wants a `SimliConfig`, and its key goes INSIDE that config.

    Note there is no top-level `api_key` on Simli's AvatarSession, so passing
    one the way every other vendor takes it is a TypeError.
    """
    return {
        "simli_config": plugin.SimliConfig(api_key=api_key or "", face_id=avatar_id)
    }


# Per-vendor constructor arguments. Vendors genuinely disagree on what the id is
# called AND on its shape, so this maps rather than guesses.
#
# This is the third time that mattered. The first version passed `avatar_id` to
# everything: Tavus wants `replica_id`, Anam wants a `PersonaConfig` object and
# Simli a `SimliConfig`, so three of four vendors raised TypeError — which this
# module converts into a clean audio-only fallback, meaning they would have been
# permanently broken with nothing in the logs but "failed to start". Only Beyond
# Presence happened to match. The builders take the imported plugin module
# precisely so they can construct the vendor's own config types, and they own
# the api_key placement too, because Simli's belongs inside its config.
#
# Adding a vendor: read its real AvatarSession signature (download the wheel and
# look — the published docs track a newer livekit-agents than we pin), add a
# builder, and add a test that binds the kwargs against the installed signature.
HOSTED_PROVIDER_KWARGS = {
    "tavus": _tavus_kwargs,
    "bey": _bey_kwargs,
    "anam": _anam_kwargs,
    "simli": _simli_kwargs,
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
    livekit_url: Optional[str] = None,
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
                provider=provider,
                session=session,
                room=room,
                scenario=scenario,
                livekit_url=livekit_url,
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
    *,
    provider: str,
    session,
    room: rtc.Room,
    scenario=None,
    livekit_url: Optional[str] = None,
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
        livekit_url=livekit_url,
    )


# ---------------------------------------------------------------------------
# Hosted providers (real AI-generated streaming video)
# ---------------------------------------------------------------------------


async def _start_hosted(
    *,
    provider: str,
    module_path: str,
    session,
    room: rtc.Room,
    scenario=None,
    livekit_url: Optional[str] = None,
) -> Optional[VideoActorHandle]:
    """Start a vendor avatar that joins the room and publishes its own tracks.

    The import is lazy on purpose. Only the vendor a deployment actually pays
    for needs to be installed; an absent one gets a log line here rather than
    an ImportError at worker boot, which would take down every session
    including the ones with the feature off.
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
            "videoActorAvatarId, else VIDEO_ACTOR_AVATAR_ID; for Tavus this is "
            "the replica id) — session continues audio-only",
            provider,
        )
        return None

    build_kwargs = HOSTED_PROVIDER_KWARGS.get(provider)
    if build_kwargs is None:
        # A provider in the module map with no kwargs builder. Refusing loudly
        # beats sending a guessed `avatar_id`: a wrong kwarg name raises
        # TypeError, which this module turns into a silent audio-only fallback,
        # and the vendor then looks broken for reasons nothing logs.
        logger.warning(
            "[VIDEO_ACTOR] provider=%s has no constructor mapping — refusing to "
            "guess its arguments; session continues audio-only",
            provider,
        )
        return None

    # The key is passed explicitly when configured so it lives with the rest of
    # this feature's settings; every plugin also reads its own <VENDOR>_API_KEY
    # from the environment, which stays the fallback. Placement is the builder's
    # job — Simli's belongs inside its config object, not beside it.
    prompt_data = getattr(scenario, "prompt_data", None)
    avatar = avatar_session_cls(
        **build_kwargs(
            plugin,
            avatar_id=avatar_id,
            api_key=getattr(settings, "VIDEO_ACTOR_API_KEY", None),
            character_name=getattr(prompt_data, "name", None) if prompt_data else None,
        )
    )

    # A hosted avatar is dispatched into the room SERVER-SIDE: the vendor dials
    # LiveKit itself using a URL we hand it, and defaults to reading LIVEKIT_URL
    # from our environment. That default is wrong here for the same reason the
    # Krisp gate is (see app/core/livekit/audio_filters.py): a worker registers
    # with settings.LIVEKIT_URL but each job's room lives on whatever media URL
    # the server assigned that job, which can differ. Handing over the
    # registration URL would send the avatar to a different server than the
    # learner, and the failure looks like "video never arrives" with no error.
    start_kwargs: dict[str, Any] = {}
    ws_url = _as_websocket_url(livekit_url)
    if ws_url:
        start_kwargs["livekit_url"] = ws_url

    try:
        await avatar.start(session, room=room, **start_kwargs)
    except TypeError:
        # A plugin whose start() does not accept livekit_url — fall back to its
        # own env resolution rather than failing the session over a kwarg.
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
