"""GuideVoiceWorker.run end to end, with LiveKit and the speech providers faked."""

import asyncio
import json
import types

import pytest

import app.guide_worker as guide_worker
from app.core.guide.client import GuideSessionEnded
from app.core.guide.lines import SESSION_ENDED_EN
from app.core.guide.session import GuideVoiceSessionInfo


class FakeEmitter:
    def __init__(self):
        self.handlers = {}

    def on(self, event, callback=None):
        def register(fn):
            self.handlers.setdefault(event, []).append(fn)
            return fn

        return register(callback) if callback is not None else register

    def emit(self, event, *args):
        for fn in self.handlers.get(event, []):
            fn(*args)


class FakeHandle:
    async def wait_for_playout(self):
        return None


class FakeAgentSession(FakeEmitter):
    instances = []

    def __init__(self, **kwargs):
        super().__init__()
        self.kwargs = kwargs
        self.said = []
        self.started = asyncio.Event()
        self.audio_enabled = True
        self.input = types.SimpleNamespace(set_audio_enabled=self._set_audio)
        FakeAgentSession.instances.append(self)

    def _set_audio(self, enabled):
        self.audio_enabled = enabled

    async def start(self, *, agent, room, room_options):
        self.agent = agent
        self.room_options = room_options
        self.started.set()

    def say(self, text, *, allow_interruptions=True, add_to_chat_ctx=True):
        self.said.append(text)
        return FakeHandle()


class FakeParticipant:
    def __init__(self):
        self.rpc = {}

    def register_rpc_method(self, name, handler):
        self.rpc[name] = handler


class FakeRoom(FakeEmitter):
    def __init__(self, name):
        super().__init__()
        self.name = name
        self.local_participant = FakeParticipant()


class FakeCtx:
    def __init__(self, metadata, room="guide-abc"):
        self.job = types.SimpleNamespace(metadata=metadata)
        self.room = FakeRoom(room)
        self.proc = types.SimpleNamespace(userdata={})
        self.shutdowns = []
        self.shutdown_callbacks = []
        self.connected = False

    async def connect(self):
        self.connected = True

    def shutdown(self, reason=""):
        self.shutdowns.append(reason)

    def add_shutdown_callback(self, callback):
        self.shutdown_callbacks.append(callback)

    async def wait_for_participant(self):
        return object()


class FakeClient:
    def __init__(self, session):
        self.session = session
        self.ended = []

    async def get_session(self, token):
        if isinstance(self.session, BaseException):
            raise self.session
        return self.session

    async def end_session(self, token):
        self.ended.append(token)

    async def aclose(self):
        pass


@pytest.fixture(autouse=True)
def fake_livekit(monkeypatch):
    FakeAgentSession.instances = []
    monkeypatch.setattr(guide_worker, "AgentSession", FakeAgentSession)
    monkeypatch.setattr(
        guide_worker,
        "build_stt_client",
        lambda config: types.SimpleNamespace(stt_instance="stt"),
    )
    monkeypatch.setattr(
        guide_worker,
        "build_tts_client",
        lambda config: types.SimpleNamespace(tts_instance=object()),
    )


def _dispatch(turn_mode="hands_free"):
    return json.dumps(
        {
            "kind": "ally_guide",
            "voiceSessionToken": "vt",
            "language": "en",
            "turnMode": turn_mode,
        }
    )


def _info(room="guide-abc", turn_mode="hands_free"):
    return GuideVoiceSessionInfo(
        threadId="th-1", roomName=room, language="hi", turnMode=turn_mode
    )


async def test_expired_session_at_startup_speaks_the_line_and_leaves():
    ctx = FakeCtx(_dispatch())
    client = FakeClient(GuideSessionEnded())

    await asyncio.wait_for(guide_worker.GuideVoiceWorker(ctx, client=client).run(), 2)

    session = FakeAgentSession.instances[0]
    assert session.said == [SESSION_ENDED_EN]
    assert ctx.connected
    assert ctx.shutdowns == ["guide_session_ended"]
    # A refused token is not "ended" again.
    for callback in ctx.shutdown_callbacks:
        await callback("guide_session_ended")
    assert client.ended == []


async def test_a_token_for_another_room_is_refused():
    ctx = FakeCtx(_dispatch())
    client = FakeClient(_info(room="guide-other"))

    await asyncio.wait_for(guide_worker.GuideVoiceWorker(ctx, client=client).run(), 2)

    assert FakeAgentSession.instances[0].said == [SESSION_ENDED_EN]
    assert ctx.shutdowns == ["guide_session_ended"]


async def test_live_session_waits_silently_then_ends_when_the_session_closes():
    ctx = FakeCtx(_dispatch())
    client = FakeClient(_info())
    worker = guide_worker.GuideVoiceWorker(ctx, client=client)
    run = asyncio.create_task(worker.run())

    await asyncio.sleep(0.05)
    session = FakeAgentSession.instances[0]
    assert session.said == []  # Ally never speaks first
    assert worker.language == "hi"  # the session's language wins
    assert session.room_options.text_input is False
    assert "llm" in session.kwargs and session.kwargs["turn_detection"] is None

    session.emit("close", types.SimpleNamespace(reason="user_initiated", error=None))
    await asyncio.wait_for(run, 1)

    assert ctx.shutdowns == ["guide_session_closed_user_initiated"]
    for callback in ctx.shutdown_callbacks:
        await callback("room closed")
    assert client.ended == ["vt"]


async def test_push_to_talk_registers_the_rpcs_and_starts_muted():
    ctx = FakeCtx(_dispatch("push_to_talk"))
    client = FakeClient(_info(turn_mode="push_to_talk"))
    worker = guide_worker.GuideVoiceWorker(ctx, client=client)
    run = asyncio.create_task(worker.run())
    await asyncio.sleep(0.05)

    session = FakeAgentSession.instances[0]
    assert session.kwargs["turn_detection"] == "manual"
    assert session.audio_enabled is False
    assert set(ctx.room.local_participant.rpc) == {
        "start_turn",
        "end_turn",
        "cancel_turn",
    }

    ctx.room.emit("disconnected")
    await asyncio.wait_for(run, 1)
    assert ctx.shutdowns == ["guide_room_disconnected"]
