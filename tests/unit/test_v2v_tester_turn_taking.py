"""The V2V tester waits for the agent to finish speaking before it replies.

Prod V2V (2026-10-16..19): ElevenLabs v3 renders Hindi replies a sentence at a
time with gaps longer than the transcript debounce, so the tester answered
mid-reply and cut off nearly every Hindi reply.
"""

from __future__ import annotations

import asyncio

import pytest

from app.v2v_tester import tester_bot
from app.v2v_tester.tester_bot import V2VTesterBot


def _bot():
    return V2VTesterBot(
        room_name="room-v2v",
        tester_token="t",
        max_exchanges=3,
        language="hi-IN",
        scenario_title="",
        scenario_context="",
        scenario_session_id="sess-v2v",
        counselor_id=1,
    )


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(tester_bot, "_AGENT_IDLE_SETTLE_S", 0.1)
    monkeypatch.setattr(tester_bot, "_TRANSCRIPT_TAIL_S", 0.1)
    monkeypatch.setattr(tester_bot, "_AGENT_REPLY_MAX_WAIT_S", 3.0)


@pytest.mark.asyncio
async def test_a_reply_in_pieces_is_heard_as_one_turn():
    bot = _bot()
    bot._note_agent_state("speaking")

    async def agent_finishes():
        await asyncio.sleep(0.3)
        await bot._utterance_queue.put("दूसरा वाक्य।")
        await asyncio.sleep(0.2)
        bot._note_agent_state("listening")
        await asyncio.sleep(0.05)
        await bot._utterance_queue.put("तीसरा वाक्य।")

    task = asyncio.create_task(agent_finishes())
    text = await bot._finish_counselor_turn("पहला वाक्य।")
    await task
    assert text == "पहला वाक्य। दूसरा वाक्य। तीसरा वाक्य।"


@pytest.mark.asyncio
async def test_it_does_not_reply_until_the_agent_has_settled():
    bot = _bot()
    bot._note_agent_state("speaking")
    loop = asyncio.get_running_loop()
    started = loop.time()

    async def agent_finishes():
        await asyncio.sleep(0.4)
        bot._note_agent_state("listening")

    task = asyncio.create_task(agent_finishes())
    await bot._finish_counselor_turn("Hello.")
    await task
    # 0.4 s speaking + 0.1 s settle + 0.1 s transcript tail.
    assert loop.time() - started >= 0.55


@pytest.mark.asyncio
async def test_without_a_published_state_it_falls_back_at_once():
    bot = _bot()
    assert bot._agent_idle_for() is None
    loop = asyncio.get_running_loop()
    started = loop.time()
    assert await bot._finish_counselor_turn("Hello.") == "Hello."
    assert loop.time() - started < 0.05


@pytest.mark.asyncio
async def test_a_stuck_agent_does_not_hang_the_run(monkeypatch):
    monkeypatch.setattr(tester_bot, "_AGENT_REPLY_MAX_WAIT_S", 0.3)
    bot = _bot()
    bot._note_agent_state("speaking")
    assert await bot._finish_counselor_turn("Hello.") == "Hello."
