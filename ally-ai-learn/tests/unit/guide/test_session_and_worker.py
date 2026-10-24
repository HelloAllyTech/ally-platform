"""Dispatch parsing, session resolution (including 401), and leaving."""

import asyncio
import json
import types

import pytest

from app.core.guide.client import GuideBackendError, GuideSessionEnded
from app.core.guide.lines import (
    SESSION_ENDED_EN,
    VOICE_OFF_EN,
    VOICE_UNAVAILABLE_EN,
    LeaveReason,
    leave_line,
)
from app.core.guide.session import GuideVoiceSessionInfo, parse_dispatch
from app.guide_worker import GuideVoiceWorker, guide_agent_name, resolve_session

# -- dispatch ------------------------------------------------------------------


def test_dispatch_is_parsed():
    dispatch = parse_dispatch(
        json.dumps(
            {
                "kind": "ally_guide",
                "voiceSessionToken": "vt",
                "language": "hi",
                "turnMode": "push_to_talk",
            }
        )
    )
    assert dispatch.voice_session_token == "vt"
    assert dispatch.language == "hi"
    assert dispatch.turn_mode == "push_to_talk"


def test_unknown_turn_mode_is_served_hands_free():
    dispatch = parse_dispatch(
        json.dumps({"kind": "ally_guide", "voiceSessionToken": "vt", "turnMode": "x"})
    )
    assert dispatch.turn_mode == "hands_free"


@pytest.mark.parametrize(
    "metadata",
    [
        None,
        "",
        "not json",
        json.dumps({"kind": "roleplay", "voiceSessionToken": "vt"}),
        json.dumps({"kind": "ally_guide"}),
        json.dumps({"kind": "ally_guide", "voiceSessionToken": ""}),
    ],
)
def test_unusable_dispatches_are_refused(metadata):
    assert parse_dispatch(metadata) is None


def test_agent_name_defaults_to_the_roleplay_name_plus_guide(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "LIVEKIT_GUIDE_AGENT_NAME", None)
    monkeypatch.setattr(settings, "AGENT_NAME", "AgentStaging")
    assert guide_agent_name() == "AgentStagingGuide"
    monkeypatch.setattr(settings, "LIVEKIT_GUIDE_AGENT_NAME", "Custom")
    assert guide_agent_name() == "Custom"


# -- session resolution ----------------------------------------------------------


class FakeSessionClient:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.lookups = 0
        self.ended = []
        self.closed = False

    async def get_session(self, token):
        self.lookups += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    async def end_session(self, token):
        self.ended.append(token)

    async def aclose(self):
        self.closed = True


INFO = GuideVoiceSessionInfo(
    threadId="th-1", roomName="guide-abc", language="en", turnMode="hands_free"
)


async def test_a_live_session_resolves():
    client = FakeSessionClient(INFO)
    assert await resolve_session(client, "vt") == (INFO, None)


async def test_session_401_means_leave_with_the_ended_line_and_no_retry():
    client = FakeSessionClient(GuideSessionEnded())

    info, reason = await resolve_session(client, "vt", backoff_s=0)

    assert info is None
    assert reason is LeaveReason.SESSION_ENDED
    assert client.lookups == 1
    assert leave_line(reason, "en") == SESSION_ENDED_EN


async def test_unreachable_ally_be_is_retried_then_voice_is_unavailable():
    client = FakeSessionClient(
        GuideBackendError("x", code="transport"),
        GuideBackendError("x", code="transport"),
        GuideBackendError("x", code="transport"),
    )
    info, reason = await resolve_session(client, "vt", attempts=3, backoff_s=0)
    assert (info, reason) == (None, LeaveReason.UNAVAILABLE)
    assert client.lookups == 3


async def test_a_transient_failure_then_success_resolves():
    client = FakeSessionClient(GuideBackendError("x", code="transport"), INFO)
    assert await resolve_session(client, "vt", backoff_s=0) == (INFO, None)


def test_leave_lines():
    assert leave_line(LeaveReason.VOICE_OFF, "en") == VOICE_OFF_EN
    assert leave_line(LeaveReason.UNAVAILABLE, "ta") == VOICE_UNAVAILABLE_EN


# -- leaving -------------------------------------------------------------------


class FakeHandle:
    def __init__(self):
        self.played = asyncio.Event()

    async def wait_for_playout(self):
        self.played.set()


class FakeSession:
    def __init__(self):
        self.said = []

    def say(self, text, *, allow_interruptions=True, add_to_chat_ctx=True):
        self.said.append((text, allow_interruptions))
        return FakeHandle()


def _worker(client, metadata=None):
    ctx = types.SimpleNamespace(
        job=types.SimpleNamespace(metadata=metadata),
        room=types.SimpleNamespace(name="guide-abc"),
        proc=types.SimpleNamespace(userdata={}),
    )
    worker = GuideVoiceWorker(ctx, client=client)
    worker.session = FakeSession()
    return worker


async def test_leaving_says_the_line_uninterruptibly_then_finishes():
    worker = _worker(FakeSessionClient())

    worker.request_leave(LeaveReason.SESSION_ENDED)
    worker.request_leave(LeaveReason.VOICE_OFF)  # idempotent
    await asyncio.wait_for(worker._finished.wait(), 1)

    assert worker.session.said == [(SESSION_ENDED_EN, False)]
    assert worker._finish_reason == "guide_session_ended"


async def test_shutdown_ends_the_session_in_ally_be():
    client = FakeSessionClient()
    worker = _worker(
        client, json.dumps({"kind": "ally_guide", "voiceSessionToken": "vt"})
    )
    worker.dispatch = parse_dispatch(worker.ctx.job.metadata)

    await worker._on_job_shutdown("room closed")

    assert client.ended == ["vt"]
    assert client.closed


async def test_shutdown_skips_ending_a_token_ally_be_already_refused():
    client = FakeSessionClient()
    worker = _worker(
        client, json.dumps({"kind": "ally_guide", "voiceSessionToken": "vt"})
    )
    worker.dispatch = parse_dispatch(worker.ctx.job.metadata)
    worker.request_leave(LeaveReason.SESSION_ENDED)
    await asyncio.wait_for(worker._finished.wait(), 1)

    await worker._on_job_shutdown("left")

    assert client.ended == []
    assert client.closed


async def test_a_bad_dispatch_shuts_the_job_down():
    reasons = []
    worker = _worker(FakeSessionClient(), metadata="{}")
    worker.ctx.shutdown = reasons.append

    await worker.run()

    assert reasons == ["guide_bad_dispatch"]
