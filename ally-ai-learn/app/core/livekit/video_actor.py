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

## Deferred attach — the session starts, THEN the face arrives

The ordering above is safe but slow, and the slowness is the whole cost of the
feature: the vendor sits in front of ``session.start()``, so the learner waits
out the render before the character says a word. Measured against live
accounts, that is 5-12s of nothing, and up to
``VIDEO_ACTOR_START_TIMEOUT_S + VIDEO_ACTOR_PUBLISH_TIMEOUT_S`` when the vendor
fails — a session that never gets a face pays the most.

``attach_video_actor`` inverts it, the way a video call lets you join with the
camera off and turn it on later:

1. The session starts audio-only, exactly as it does with the feature off. The
   agent publishes its own audio track and speaks its opening statement on time.
2. A background task starts the vendor. Its ``start()`` ends by pointing
   ``session.output.audio`` at its data stream, which withholds every frame
   until the avatar's video exists — so this path takes that back IMMEDIATELY
   and keeps the learner on the room track they are already hearing.
3. Only once the avatar's video is verified live does the agent's speech move
   onto it, at a gap between utterances.

The safety contract survives intact, and one hazard it guards against is gone
rather than mitigated: the agent's audio is never suppressed on the strength of
a vendor promise, so a vendor that accepts the job and renders nothing costs a
faceless session instead of a silent one. The learner has been hearing the
character throughout.

Two things make the swap safe rather than clever. ``AgentActivity`` re-reads
``session.output.audio`` at the start of each speech task, so a swap between
turns is total and a swap mid-utterance leaves that utterance to finish on the
track it started on. And the room's audio output stays published (silent) after
the swap, so nothing has to be torn down and re-established.

The client needs no changes for any of this: ``ActorVideo`` in ally-web already
renders nothing until a remote camera track exists and overlays the call card
when one arrives, deliberately treating "no track" as a resting state rather
than a spinner.

``VIDEO_ACTOR_DEFER_ATTACH`` (default **True**) selects this path; setting it
False restores the blocking order in one restart. ``test_pattern`` is always
eager — it renders in-process in milliseconds, so it has no delay to hide.

## Providers

A roleplay picks its own vendor via ``prompt_data.video_actor_provider``
(Studio: videoActorProvider); ``settings.VIDEO_ACTOR_PROVIDER`` is the
deployment default for every roleplay that names none. Each vendor reads its
own key — ``VIDEO_ACTOR_BEY_API_KEY`` / ``VIDEO_ACTOR_TAVUS_API_KEY``, falling
back to the single ``VIDEO_ACTOR_API_KEY`` — because one deployment can now
need both vendors live at once. The selectable ones are:

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
import dataclasses
import importlib
import os
import time
from dataclasses import dataclass
from typing import Any, Mapping, Optional

import aiohttp
from livekit import rtc
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

# Provider id for the dependency-free in-process renderer.
PROVIDER_TEST_PATTERN = "test_pattern"

# Tavus needs naming because it is the one vendor with a teardown obligation of
# its own — see _end_tavus_conversation.
PROVIDER_TAVUS = "tavus"

_TAVUS_API_URL = "https://tavusapi.com/v2"

# Providers that must be handed the project's REGISTRATION url rather than the
# per-job regional media url.
#
# Tavus cannot publish into a room that already has participants when it is
# pointed at a regional media host. It connects, joins as its participant, and
# then publishes no track at all — which this worker cannot tell apart from a
# healthy start, so the session goes silent for its whole duration (agent audio
# rides the avatar track and the avatar never arrives).
#
# It needs BOTH conditions, which is why it survived every isolated test.
# Measured 2026-09-07, same replica / same echo PAL / same token shape:
#
#   regional url + occupied room -> NEVER published   <- every real session
#   regional url + empty room    -> published in 11.8s
#   project url  + occupied room -> published in  5.3s
#   project url  + empty room    -> published in  8.4s
#
# So this is not the scheme bug that _as_websocket_url fixes, and not the room:
# it is the host. Beyond Presence handles the regional host fine, hence a
# per-provider set rather than reverting the job-url change for everyone — that
# change is right, and passing the registration url would send a vendor to a
# different media server than the learner on a self-hosted deployment.
PROVIDERS_NEEDING_REGISTRATION_URL = frozenset({PROVIDER_TAVUS})

# Teardown runs on the shutdown path, so it gets a short leash: a slow vendor
# must not hold a worker slot open behind a session that is already over.
_TAVUS_END_TIMEOUT_S = 5.0

# How long a deferred attach waits for a gap between utterances before moving
# the agent's speech onto the avatar anyway.
#
# A courtesy, not a correctness requirement. AgentActivity resolves
# session.output.audio once per speech task and holds it for the duration, so an
# utterance already in flight finishes on the room track regardless — the cost
# of swapping mid-speech is one line that is heard but not lip-synced. Hence a
# bound: waiting out a monologue to spare that would delay the face for longer
# than the seam is worth.
_ATTACH_QUIET_TIMEOUT_S = 15.0

# Poll interval for the quiet-moment wait. Nothing is blocked on it, so this is
# just "fine enough to land in a real gap between turns".
_ATTACH_QUIET_POLL_S = 0.1

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


def _vendor_livekit_url(provider: str, job_url: Optional[str]) -> Optional[str]:
    """Which LiveKit URL to hand this vendor to dial in on.

    The job URL by default — see the comment in ``_start_hosted`` for why that
    matters. For the providers in ``PROVIDERS_NEEDING_REGISTRATION_URL`` it is
    the registration URL instead, because they cannot publish into an
    established room from a regional media host.

    Falls back to the job URL when no registration URL is configured: a vendor
    dialling the wrong host still has a chance of working, whereas handing it
    nothing means it reads ``LIVEKIT_URL`` from our env, which is the same value
    and would silently defeat the point on a deployment that has none.
    """
    if provider not in PROVIDERS_NEEDING_REGISTRATION_URL:
        return job_url
    registration_url = getattr(settings, "LIVEKIT_URL", None)
    if not registration_url:
        return job_url
    if registration_url != job_url:
        logger.info(
            "[VIDEO_ACTOR] provider=%s dials the registration URL, not this "
            "job's media host — it cannot publish into an established room "
            "from a regional host",
            provider,
        )
    return registration_url


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


#: One attempt at Beyond Presence, not the plugin's default three.
#:
#: `_start_agent` loops `max_retry` times and each attempt commissions an avatar
#: that JOINS the room and then drops when the attempt fails — so a failure the
#: learner should never have seen becomes a participant flickering in and out of
#: their session. Observed in prod on 2026-09-17: three joins and two leaves in
#: 13 seconds, against an error the vendor had already marked as final:
#:
#:     400 {"detail":"Connection timed out after 4 seconds."} retryable=False
#:
#: That flag is the whole argument. The plugin's loop does not read it, so the
#: retries could never have helped — the only lever we hold is how many times it
#: gets to try. Derived with `dataclasses.replace` so the timeout and interval
#: stay whatever the installed livekit-agents considers sane.
#:
#: The cost, stated plainly: a genuinely transient failure now costs the session
#: its face where a retry might have recovered it. That is the right trade while
#: the failure is systematic — attaching degrades to audio-only, which the
#: learner barely notices, whereas a participant appearing and vanishing three
#: times is something they watch happen.
_BEY_CONN_OPTIONS = dataclasses.replace(DEFAULT_API_CONNECT_OPTIONS, max_retry=1)
_BEY_CONN_OPTIONS_WITH_FIX = dataclasses.replace(
    DEFAULT_API_CONNECT_OPTIONS, max_retry=1, timeout=20.0
)


def _bey_kwargs(plugin, *, avatar_id, api_key, character_name) -> dict:
    """Beyond Presence: a plain `avatar_id`, key alongside it."""
    kwargs: dict[str, Any] = {
        "avatar_id": avatar_id,
        "conn_options": _BEY_CONN_OPTIONS_WITH_FIX,
    }
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

    It is True for the whole life of a handle from ``start_video_actor``, which
    only ever returns one after verifying the avatar. A handle from the deferred
    ``attach_video_actor`` starts False and flips True at the moment the swap
    commits, so it reads as "the character's voice is on the avatar track right
    now" rather than "an avatar was requested". A caller that has already
    started its session has nothing to suppress and does not consult it; the
    field stays honest for the sake of anyone who later does.
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

    provider = _resolve_provider(scenario)
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


def defers_attach(scenario=None) -> bool:
    """Whether this session brings the avatar up AFTER it starts talking.

    The default, and the reason is latency: a hosted vendor takes 5-12s to
    render, and in the blocking order every second of that is a second before
    the character says its first word. See the module docstring.

    ``test_pattern`` is excluded because it publishes in-process in
    milliseconds — there is no delay to hide, and deferring it would be
    plumbing for nothing.
    """
    if not getattr(settings, "VIDEO_ACTOR_DEFER_ATTACH", True):
        return False
    return _resolve_provider(scenario) != PROVIDER_TEST_PATTERN


async def attach_video_actor(
    *,
    session,
    room: rtc.Room,
    scenario=None,
    livekit_url: Optional[str] = None,
    on_vendor_session=None,
) -> Optional[VideoActorHandle]:
    """Bring the avatar up beside a session that is already running.

    The deferred counterpart to ``start_video_actor``. Call it from a background
    task AFTER ``session.start()``, having passed no ``audio_enabled=False``:
    the learner is already hearing the character on the agent's own room track
    when this begins, keeps hearing it there for however long the vendor takes,
    and the speech only moves onto the avatar once its video is verified live.

    Returns a handle once that swap is committed, or ``None`` if the vendor
    never rendered. Like ``start_video_actor`` it does not raise — but unlike it
    there is no audio-only fallback to arrange, because the session was never
    taken off its own audio in the first place.

    ``on_vendor_session`` is called with the handle as soon as the vendor has a
    session that would need ending, BEFORE video is verified, so a learner who
    leaves during the render wait does not strand a metered conversation. Its
    ``publishes_audio`` is False until the swap commits.
    """
    if not is_video_actor_enabled(scenario):
        return None

    provider = _resolve_provider(scenario)
    module_path = HOSTED_PROVIDER_MODULES.get(provider)
    if module_path is None:
        logger.warning(
            "[VIDEO_ACTOR] unknown VIDEO_ACTOR_PROVIDER=%r (known: %s) — "
            "session continues audio-only",
            provider,
            ", ".join(sorted(HOSTED_PROVIDER_MODULES)),
        )
        return None

    t0 = time.monotonic()
    try:
        return await _attach_hosted(
            provider=provider,
            module_path=module_path,
            session=session,
            room=room,
            scenario=scenario,
            livekit_url=livekit_url,
            on_vendor_session=on_vendor_session,
            t0=t0,
        )
    except asyncio.CancelledError:
        # The session is shutting down. Propagate so the worker's task cleanup
        # completes; the handle was already registered for teardown.
        raise
    except Exception as e:  # noqa: BLE001 - must never break a live session
        logger.warning(
            "[VIDEO_ACTOR] provider=%s failed to attach (%s) — the session "
            "keeps its own audio track and stays faceless",
            provider,
            e,
        )
        return None


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


@dataclass
class _PreparedAvatar:
    """A constructed vendor AvatarSession that has not dialled out yet.

    Split out so the eager and deferred paths share every validation and every
    vendor quirk, and differ only in WHEN the agent's speech moves onto the
    avatar. ``handle`` arrives with ``publishes_audio=False`` — it becomes True
    at the moment the swap is actually committed, so the flag never overstates
    what the learner is hearing.
    """

    avatar: Any
    start_kwargs: dict
    handle: VideoActorHandle


def _prepare_hosted(
    *,
    provider: str,
    module_path: str,
    scenario=None,
    livekit_url: Optional[str] = None,
) -> Optional[_PreparedAvatar]:
    """Import the vendor plugin and build its AvatarSession. Dials nothing.

    The import is lazy on purpose. Only the vendor a deployment actually pays
    for needs to be installed; an absent one gets a log line here rather than
    an ImportError at worker boot, which would take down every session
    including the ones with the feature off.
    """
    prompt_data = getattr(scenario, "prompt_data", None)
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
    api_key = _resolve_api_key(provider)
    if not api_key and provider == "bey":
        logger.warning(
            "[VIDEO_ACTOR] provider=%s needs an API key (roleplay "
            "VIDEO_ACTOR_BEY_API_KEY, else VIDEO_ACTOR_API_KEY) — session continues "
            "audio-only",
            provider,
        )
        return None
    avatar = avatar_session_cls(
        **build_kwargs(
            plugin,
            avatar_id=avatar_id,
            api_key=api_key,
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
    ws_url = _as_websocket_url(_vendor_livekit_url(provider, livekit_url))
    if ws_url:
        start_kwargs["livekit_url"] = ws_url

    async def _close() -> None:
        closer = getattr(avatar, "aclose", None)
        if closer is not None:
            await closer()
        if provider == PROVIDER_TAVUS:
            await _end_tavus_conversation(avatar)

    return _PreparedAvatar(
        avatar=avatar,
        start_kwargs=start_kwargs,
        handle=VideoActorHandle(
            provider=provider, publishes_audio=False, _closer=_close
        ),
    )


async def _call_avatar_start(prepared: _PreparedAvatar, session, room) -> None:
    """Dial the vendor in. Raises whatever the plugin raises."""
    try:
        await prepared.avatar.start(session, room=room, **prepared.start_kwargs)
    except TypeError:
        # A plugin whose start() does not accept livekit_url — fall back to its
        # own env resolution rather than failing the session over a kwarg.
        await prepared.avatar.start(session, room=room)


async def _start_hosted(
    *,
    provider: str,
    module_path: str,
    session,
    room: rtc.Room,
    scenario=None,
    livekit_url: Optional[str] = None,
) -> Optional[VideoActorHandle]:
    """Start a vendor avatar IN FRONT of ``session.start`` — the blocking path.

    Kept behind ``VIDEO_ACTOR_DEFER_ATTACH=false`` as the one-restart revert for
    the deferred path below, and used unconditionally by ``test_pattern``.
    """
    prepared = _prepare_hosted(
        provider=provider,
        module_path=module_path,
        scenario=scenario,
        livekit_url=livekit_url,
    )
    if prepared is None:
        return None

    # The vendor's start() sets session.output.audio to its own data-stream
    # output. Remember what was there so a failed verification below can put it
    # back exactly as found.
    previous_audio_output = getattr(session.output, "audio", None)

    await _call_avatar_start(prepared, session, room)

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
        await prepared.handle.aclose()
        try:
            session.output.audio = (
                previous_audio_output if previous_audio_output is not None else None
            )
        except Exception as e:  # noqa: BLE001
            logger.debug("[VIDEO_ACTOR] could not restore audio output: %s", e)
        return None

    prepared.handle.publishes_audio = True
    return prepared.handle


async def _attach_hosted(
    *,
    provider: str,
    module_path: str,
    session,
    room: rtc.Room,
    scenario=None,
    livekit_url: Optional[str] = None,
    on_vendor_session=None,
    t0: float,
) -> Optional[VideoActorHandle]:
    """Bring a vendor avatar up BESIDE a session that is already talking."""
    prepared = _prepare_hosted(
        provider=provider,
        module_path=module_path,
        scenario=scenario,
        livekit_url=livekit_url,
    )
    if prepared is None:
        return None

    # Whatever the running session is currently speaking through — RoomIO's own
    # participant audio output, which the learner is already subscribed to and
    # hearing. This is the thing we must NOT lose hold of.
    room_audio = getattr(session.output, "audio", None)

    # Hand the vendor its teardown obligation before it can incur one. A learner
    # who hangs up during the render wait would otherwise leave a Tavus
    # conversation open, metered, and counting against the account's concurrent
    # cap. publishes_audio is still False, so this handle cannot be mistaken for
    # authority to suppress the session's own audio.
    if on_vendor_session is not None:
        on_vendor_session(prepared.handle)

    try:
        await _call_avatar_start(prepared, session, room)
    finally:
        # THE POINT OF THIS WHOLE PATH. The vendor's start() ends by pointing
        # session.output.audio at its data stream, and that output is built with
        # wait_remote_track=KIND_VIDEO — it withholds every frame until the
        # avatar's video track exists. Leaving it in place would mute the
        # character for the 5-12s the vendor takes to render, which is exactly
        # the delay we are removing. Take it back before anything can speak
        # through it; in a finally so a raising start() cannot leave the session
        # pointed at a dead output either.
        avatar_audio = getattr(session.output, "audio", None)
        if avatar_audio is not room_audio:
            try:
                session.output.audio = room_audio
            except Exception as e:  # noqa: BLE001 - never worsen a live session
                logger.debug("[VIDEO_ACTOR] could not hold the room track: %s", e)

    if avatar_audio is None or avatar_audio is room_audio:
        # The plugin accepted start() without installing an output. There is
        # nothing to move the speech onto, so there is no avatar.
        logger.warning(
            "[VIDEO_ACTOR] provider=%s start() installed no audio output — "
            "nothing to attach; session stays on its own audio track",
            provider,
        )
        await prepared.handle.aclose()
        return None

    # The learner is mid-conversation and hearing everything, so this wait can
    # be far more generous than the blocking path's: nobody is sitting in
    # silence while it runs.
    publish_timeout = float(
        getattr(settings, "VIDEO_ACTOR_ATTACH_PUBLISH_TIMEOUT_S", 30.0)
    )
    if not await _await_avatar_video(room, publish_timeout):
        logger.warning(
            "[VIDEO_ACTOR] provider=%s published no video within %ss — the "
            "session keeps its own audio track and stays faceless. The vendor "
            "accepted the job but never rendered; check the vendor dashboard "
            "for this conversation.",
            provider,
            publish_timeout,
        )
        # Nothing to restore: the agent's speech never left the room track, so
        # a vendor that never renders costs a face rather than a voice. That is
        # the whole reason this path exists.
        await prepared.handle.aclose()
        return None

    if not await _await_quiet(session, _ATTACH_QUIET_TIMEOUT_S):
        logger.debug(
            "[VIDEO_ACTOR] no gap between utterances within %ss — attaching "
            "mid-speech; the line in flight finishes on the room track",
            _ATTACH_QUIET_TIMEOUT_S,
        )

    # Commit. AgentActivity resolves session.output.audio once per speech task,
    # so from the next utterance on the character's voice rides the avatar and
    # is lip-synced. The room's audio output stays published and simply stops
    # receiving frames — nothing to unpublish, and nothing a client renders as
    # a second voice.
    #
    # Expect one benign line from livekit-agents here: resume_false_interruption
    # defaults on and the vendor's data-stream output cannot pause, so it logs
    # that the option is ignored. The blocking path logs the same thing at
    # session start.
    session.output.audio = avatar_audio
    prepared.handle.publishes_audio = True
    logger.info(
        "[VIDEO_ACTOR] provider=%s attached %.0fms into the session — the "
        "character's speech now rides the avatar track",
        provider,
        (time.monotonic() - t0) * 1000,
    )
    return prepared.handle


async def _await_quiet(session, timeout: float) -> bool:
    """Wait for a gap between utterances. False means the budget ran out.

    Only ``current_speech`` is consulted, because that is the thing a swap
    could seam: the agent's state can be "thinking" with nothing yet flowing to
    an audio output, and waiting that out would be waiting for nothing.
    """
    deadline = time.monotonic() + timeout
    while True:
        speech = getattr(session, "current_speech", None)
        if speech is None:
            return True
        done = getattr(speech, "done", None)
        try:
            if done is not None and done():
                return True
        except Exception:  # noqa: BLE001 - a stub without a real handle
            return True
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(_ATTACH_QUIET_POLL_S)


async def _end_tavus_conversation(avatar: Any) -> None:
    """End the Tavus conversation this session opened. The plugin never does.

    ``livekit-plugins-tavus`` has no ``aclose`` on its ``AvatarSession`` — not
    in the 1.3.12 we pin, and not in 1.5.6 either — so the conversation it
    creates with ``POST /v2/conversations`` outlives the room. It stays open,
    metered, and counting against the account's concurrent-conversation cap.

    That cap is the suspected cause of "Tavus joins and publishes nothing".
    Once it is reached Tavus still answers the create call with 200 and a
    conversation_id, and the replica still joins the LiveKit room — it just
    never publishes a track. From this worker's side that is indistinguishable
    from a healthy start, which is why 11 of 12 test conversations on
    2026-09-07 produced silence with nothing in the logs. Beyond Presence never
    showed it because their session ends with the room.

    Best-effort by construction: this runs during shutdown, the handle's
    ``aclose`` swallows what it raises, and a conversation we fail to end is
    the status quo rather than a regression.
    """
    conversation_id = getattr(avatar, "conversation_id", None)
    if not conversation_id:
        return

    api_key = _resolve_api_key(PROVIDER_TAVUS) or os.getenv("TAVUS_API_KEY")
    if not api_key:
        # The plugin resolved a key we cannot see. Say so rather than failing
        # silently: the leak is the thing that breaks the NEXT session.
        logger.warning(
            "[VIDEO_ACTOR] tavus conversation %s cannot be ended (no API key "
            "visible to this worker) — it stays open against the account's "
            "concurrent-conversation cap",
            conversation_id,
        )
        return

    url = f"{_TAVUS_API_URL}/conversations/{conversation_id}/end"
    timeout = aiohttp.ClientTimeout(total=_TAVUS_END_TIMEOUT_S)
    async with aiohttp.ClientSession(timeout=timeout) as http:
        async with http.post(url, headers={"x-api-key": api_key}) as response:
            if response.status >= 400:
                logger.warning(
                    "[VIDEO_ACTOR] failed to end tavus conversation %s "
                    "(HTTP %s) — it stays open against the account's "
                    "concurrent-conversation cap",
                    conversation_id,
                    response.status,
                )
                return
    logger.info("[VIDEO_ACTOR] ended tavus conversation %s", conversation_id)


def _resolve_provider(scenario=None) -> str:
    """Which vendor renders this session, per-roleplay first.

    A roleplay names its own vendor because the choice is editorial, not
    operational: which face suits a character, and whose lip-sync holds up in
    the language it is played in. The env var stays the deployment default for
    every roleplay that names none, so this field arriving changed nothing for
    anything that already existed.
    """
    prompt_data = getattr(scenario, "prompt_data", None)
    per_sim = (
        getattr(prompt_data, "video_actor_provider", None) if prompt_data else None
    )
    if per_sim:
        return str(per_sim).strip().lower()
    return str(getattr(settings, "VIDEO_ACTOR_PROVIDER", PROVIDER_TEST_PATTERN))


def _resolve_api_key(provider: str) -> Optional[str]:
    """This vendor's key, falling back to the single-vendor setting.

    Once a roleplay can pick its vendor, one deployment can need both vendors'
    keys at the same time, which ``VIDEO_ACTOR_API_KEY`` alone cannot express.
    The fallback is what keeps a deployment that configured only that one
    working untouched — and a vendor with no key reachable at all still degrades
    to audio-only rather than failing the session.
    """
    per_provider = {
        PROVIDER_TAVUS: "VIDEO_ACTOR_TAVUS_API_KEY",
        "bey": "VIDEO_ACTOR_BEY_API_KEY",
    }.get(provider)
    if per_provider:
        key = getattr(settings, per_provider, None)
        if key:
            return key
    return getattr(settings, "VIDEO_ACTOR_API_KEY", None)


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
