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


def _is_agent_kind(participant) -> bool:
    """Whether LiveKit itself classifies this participant as an agent.

    The vendor plugins mint their avatar's token with ``.with_kind("agent")``,
    so the server reports these as AGENT-kind participants. That is a far
    stronger signal than any name: it comes from the token, not a convention.

    Safe as a "not a human" test because the worker's own agent is the LOCAL
    participant — it never appears in ``remote_participants`` — so an
    agent-kind participant in that map is always something the session
    commissioned, never a learner.
    """
    kind = getattr(participant, "kind", None)
    if kind is None:
        return False
    agent_kind = getattr(rtc.ParticipantKind, "PARTICIPANT_KIND_AGENT", 4)
    try:
        return int(kind) == int(agent_kind)
    except (TypeError, ValueError):
        return False


def is_avatar_participant(identity: Optional[str]) -> bool:
    """Whether a participant identity belongs to a rendering avatar.

    The name-based half of the test, for callers that only have an identity
    string. Errs toward calling something an avatar ONLY on an exact known
    identity or the shared ``-avatar-agent`` suffix, so a real learner is never
    mistaken for one and silently stripped from a headcount.
    """
    if not identity:
        return False
    return identity in AVATAR_PARTICIPANT_IDENTITIES.values() or identity.endswith(
        _AVATAR_IDENTITY_SUFFIX
    )


def human_participants(room) -> list:
    """Remote participants that are actual people.

    The avatar the agent itself commissioned does not count as company. Kind
    first (authoritative, it comes from the token), name second (covers a
    vendor whose token does not carry the agent kind).
    """
    remote = getattr(room, "remote_participants", None) or {}
    return [
        p
        for p in remote.values()
        if not _is_agent_kind(p)
        and not is_avatar_participant(getattr(p, "identity", None))
    ]


def _avatar_video_is_live(room) -> bool:
    """Whether a rendering avatar has actually published video into the room.

    Accepts the track on EITHER attribution deliberately. Vendors mint the
    avatar's token with a publish-on-behalf attribute naming our agent, so the
    video can be attributed to the avatar participant or to the agent it
    publishes for depending on who is looking.
    """
    remote = getattr(room, "remote_participants", None) or {}
    for participant in remote.values():
        if not (
            _is_agent_kind(participant)
            or is_avatar_participant(getattr(participant, "identity", None))
        ):
            continue
        publications = getattr(participant, "track_publications", None) or {}
        for publication in publications.values():
            if getattr(publication, "kind", None) == rtc.TrackKind.KIND_VIDEO:
                return True
    return False


async def _await_avatar_video(room, timeout: float) -> bool:
    """Block until the avatar publishes video, or the budget runs out.

    THIS IS THE GUARD THAT STOPS A SILENT SESSION, and it closes a hole the
    handle contract alone cannot.

    A vendor's ``start()`` returning successfully only means it accepted the
    job. Tavus's own audio output is constructed with
    ``wait_remote_track=KIND_VIDEO`` — the plugin will not send the agent's
    speech anywhere until the avatar's video track exists. So a vendor that
    starts and then never publishes leaves the agent's audio both SUPPRESSED
    (we routed it to the avatar) and UNDELIVERED (the avatar never became
    ready): the learner gets silence and no picture, which is strictly worse
    than never enabling the feature at all.

    Observed exactly that against a live Tavus account on 2026-09-07:
    conversation active, avatar joined, zero tracks published, and an opening
    statement that took 25.8s to "play out" against ~3s without the avatar.

    Polls rather than subscribing to track_published: the caller wants a plain
    bounded wait it can abandon, and at this point in startup a 250ms tick
    costs nothing beside the network round-trips happening around it.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _avatar_video_is_live(room):
            return True
        await asyncio.sleep(0.25)
    return _avatar_video_is_live(room)


def _tavus_kwargs(avatar_id: Optional[str]) -> dict:
    """Tavus names its two ids `replica_id` (the face) and `persona_id`.

    `replica_id` takes the resolved per-roleplay/deployment avatar id, so one
    setting means the same thing across vendors. `persona_id` is optional and
    Tavus falls back to a stock persona without it — which is what we want:
    the character's personality comes from OUR prompt and OUR LLM, and letting
    a vendor persona speak for it would put a second, unversioned character
    definition in the loop.
    """
    kwargs: dict[str, Any] = {}
    if avatar_id:
        kwargs["replica_id"] = avatar_id
    persona = getattr(settings, "VIDEO_ACTOR_TAVUS_PERSONA_ID", None)
    if persona:
        kwargs["persona_id"] = persona
    return kwargs


def _single_avatar_id_kwargs(avatar_id: Optional[str]) -> dict:
    """The common shape: one `avatar_id` naming which face to render."""
    return {"avatar_id": avatar_id} if avatar_id else {}


# Per-vendor constructor arguments. Vendors genuinely disagree on what the id
# is called, so this maps rather than guesses — an earlier version passed
# `avatar_id` to everything, which Tavus rejects outright (it wants
# `replica_id`), and the failure was invisible because the module falls back to
# audio-only on any error.
HOSTED_PROVIDER_KWARGS = {
    "tavus": _tavus_kwargs,
    "bey": _single_avatar_id_kwargs,
    "anam": _single_avatar_id_kwargs,
    "simli": _single_avatar_id_kwargs,
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
    start_timeout = float(getattr(settings, "VIDEO_ACTOR_START_TIMEOUT_S", 6.0))
    publish_timeout = float(getattr(settings, "VIDEO_ACTOR_PUBLISH_TIMEOUT_S", 8.0))
    # The overall budget has to cover BOTH phases. An earlier version wrapped
    # everything in the start timeout alone, so the publish verification could
    # never finish before being cancelled — the guard was dead code, and the
    # cancellation landed mid-flight where cleanup had not run yet.
    timeout = start_timeout + publish_timeout
    t0 = time.monotonic()

    # Snapshot the session's audio output. A vendor's start() replaces this with
    # its own data-stream output, and if we then abandon the avatar for ANY
    # reason we must hand the session back exactly what it had — otherwise
    # AgentSession.start() sees a non-None output.audio, quietly disables room
    # audio, and the learner gets a session with no voice at all. Restoring on
    # the inner paths alone is not enough: the timeout below cancels mid-flight,
    # which is precisely when cleanup has not run.
    audio_output_before = getattr(getattr(session, "output", None), "audio", None)

    def _restore_audio_output() -> None:
        try:
            session.output.audio = audio_output_before
        except Exception as e:  # noqa: BLE001 - never worsen a fallback
            logger.debug("[VIDEO_ACTOR] could not restore audio output: %s", e)

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
        _restore_audio_output()
        return None
    except Exception as e:  # noqa: BLE001 - must never break a session
        logger.warning(
            "[VIDEO_ACTOR] provider=%s failed to start (%s) — "
            "session continues audio-only",
            provider,
            e,
        )
        _restore_audio_output()
        return None

    if handle is None:
        # Includes the publish verification declining the avatar. Restoring here
        # too is deliberate belt-and-braces: this invariant — "returning None
        # means the session's audio output is untouched" — is the single thing
        # standing between a vendor hiccup and a silent session.
        _restore_audio_output()
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

    build_kwargs = HOSTED_PROVIDER_KWARGS.get(provider, _single_avatar_id_kwargs)
    kwargs: dict[str, Any] = dict(build_kwargs(avatar_id))
    # Passed explicitly when configured so the key lives with the rest of this
    # feature's settings; every plugin also reads its own <VENDOR>_API_KEY from
    # the environment, which stays the fallback.
    api_key = getattr(settings, "VIDEO_ACTOR_API_KEY", None)
    if api_key:
        kwargs["api_key"] = api_key

    avatar = avatar_session_cls(**kwargs)

    # A hosted avatar is dispatched into the room SERVER-SIDE: the vendor dials
    # LiveKit itself using a URL we hand it, and defaults to reading LIVEKIT_URL
    # from our environment. That default is wrong here for the same reason the
    # Krisp gate is (see app/core/livekit/audio_filters.py): a worker registers
    # with settings.LIVEKIT_URL but each job's room lives on whatever media URL
    # the server assigned that job, which can differ. Handing over the
    # registration URL would send the avatar to a different server than the
    # learner, and the failure looks like "video never arrives" with no error.
    start_kwargs: dict[str, Any] = {}
    if livekit_url:
        start_kwargs["livekit_url"] = livekit_url

    # The vendor's start() sets session.output.audio to its own data-stream
    # output. Remember what was there so a failed verification below can put it
    # back exactly as found.
    previous_audio_output = getattr(session.output, "audio", None)

    async def _close() -> None:
        closer = getattr(avatar, "aclose", None)
        if closer is not None:
            await closer()

    try:
        await avatar.start(session, room=room, **start_kwargs)
    except TypeError:
        # A plugin whose start() does not accept livekit_url — fall back to its
        # own env resolution rather than failing the session over a kwarg.
        await avatar.start(session, room=room)

    # PUBLISH VERIFICATION. A successful start() only means the vendor accepted
    # the job; it is not a promise that a face ever arrives. See
    # _await_avatar_video for why an unverified start is the one failure mode
    # that leaves the learner in silence.
    publish_timeout = float(getattr(settings, "VIDEO_ACTOR_PUBLISH_TIMEOUT_S", 8.0))
    if not await _await_avatar_video(room, publish_timeout):
        logger.warning(
            "[VIDEO_ACTOR] provider=%s started but published no video within "
            "%ss — tearing it down and running audio-only. The vendor accepted "
            "the job but never rendered; check the vendor dashboard for this "
            "conversation.",
            provider,
            publish_timeout,
        )
        # Order matters: drop the vendor first so nothing can publish into a
        # session we have already decided is audio-only, then hand the session
        # its own audio output back so session.start() installs normal room
        # audio. Both are best-effort — a failure to tidy up must not turn a
        # recoverable degradation into a dead session.
        try:
            await _close()
        except Exception as e:  # noqa: BLE001
            logger.debug("[VIDEO_ACTOR] teardown after failed verify: %s", e)
        try:
            session.output.audio = (
                previous_audio_output if previous_audio_output is not None else None
            )
        except Exception as e:  # noqa: BLE001
            logger.debug("[VIDEO_ACTOR] could not restore audio output: %s", e)
        return None

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
