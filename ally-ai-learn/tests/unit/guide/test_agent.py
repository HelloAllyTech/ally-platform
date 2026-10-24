"""GuideVoiceAgent: llm_node relays to ally-be; tts_node paces the crisis."""

import pytest
from livekit import rtc
from livekit.agents import Agent, llm

from app.core.guide.agent import BackendRelayLLM, GuideVoiceAgent, latest_learner_text
from app.core.guide.crisis import DEFAULT_CRISIS_TEXT, DeliveryState


class FakeTurns:
    def __init__(self, *pieces):
        self.pieces = pieces
        self.heard = []

    async def speak(self, text):
        self.heard.append(text)
        for piece in self.pieces:
            yield piece


def _frame(samples=480, rate=24000):
    return rtc.AudioFrame(
        data=b"\x01\x00" * samples,
        sample_rate=rate,
        num_channels=1,
        samples_per_channel=samples,
    )


@pytest.fixture
def synthesised(monkeypatch):
    """Replace LiveKit's default TTS node: one frame per call, texts recorded."""
    calls = []

    async def fake_tts_node(agent, text, model_settings):
        calls.append("".join([chunk async for chunk in text]))
        yield _frame()

    monkeypatch.setattr(Agent.default, "tts_node", staticmethod(fake_tts_node))
    return calls


async def _gen(*chunks):
    for chunk in chunks:
        yield chunk


def test_latest_learner_text_reads_the_newest_user_message():
    ctx = llm.ChatContext.empty()
    ctx.add_message(role="assistant", content="Welcome back.")
    ctx.add_message(role="user", content="Can we start?")
    assert latest_learner_text(ctx) == "Can we start?"

    ctx.add_message(role="assistant", content="Sure.")
    assert latest_learner_text(ctx) is None


async def test_llm_node_relays_the_transcript_to_ally_be():
    turns = FakeTurns("Hello. ", "Let's begin.")
    agent = GuideVoiceAgent(turns, DeliveryState())
    ctx = llm.ChatContext.empty()
    ctx.add_message(role="user", content="I'm ready")

    out = [piece async for piece in agent.llm_node(ctx, [], None)]

    assert out == ["Hello. ", "Let's begin."]
    assert turns.heard == ["I'm ready"]


async def test_llm_node_does_nothing_without_a_new_learner_message():
    turns = FakeTurns("never")
    agent = GuideVoiceAgent(turns, DeliveryState())
    ctx = llm.ChatContext.empty()
    ctx.add_message(role="assistant", content="Hi")

    assert [piece async for piece in agent.llm_node(ctx, [], None)] == []
    assert turns.heard == []


def test_the_placeholder_llm_refuses_to_run():
    with pytest.raises(RuntimeError, match="never calls a model"):
        BackendRelayLLM().chat(chat_ctx=llm.ChatContext.empty())


async def test_normal_replies_use_the_default_tts_once(synthesised):
    agent = GuideVoiceAgent(FakeTurns(), DeliveryState())

    frames = [f async for f in agent.tts_node(_gen("One. ", "Two."), None)]

    assert synthesised == ["One. Two."]
    assert len(frames) == 1


async def test_crisis_is_synthesised_per_sentence_with_pauses(synthesised):
    delivery = DeliveryState()
    delivery.crisis = True
    agent = GuideVoiceAgent(FakeTurns(), delivery, crisis_pause_s=0.3)

    frames = [f async for f in agent.tts_node(_gen(DEFAULT_CRISIS_TEXT), None)]

    assert len(synthesised) == 5
    assert synthesised[0] == "I'm really glad you told me."
    speech = [f for f in frames if any(bytes(f.data))]
    pauses = [f for f in frames if not any(bytes(f.data))]
    # One frame per sentence, and a 0.3 s pause between sentences (none after
    # the last: Ally goes straight back to listening).
    assert len(speech) == 5
    assert sum(f.samples_per_channel for f in pauses) == 4 * 7200
    assert any(bytes(frames[-1].data))  # ends on speech, not on a pause


async def test_crisis_slows_the_voice_while_it_speaks(synthesised):
    class Rate:
        def __init__(self):
            self.events = []

        def slowed(self, rate):
            events = self.events

            class _Ctx:
                def __enter__(self):
                    events.append(("slow", rate))
                    return True

                def __exit__(self, *exc):
                    events.append(("restore",))

            return _Ctx()

    delivery = DeliveryState()
    delivery.crisis = True
    rate = Rate()
    agent = GuideVoiceAgent(FakeTurns(), delivery, speaking_rate=rate, crisis_rate=0.8)

    [f async for f in agent.tts_node(_gen("One. Two."), None)]

    assert rate.events == [("slow", 0.8), ("restore",)]


async def test_empty_segment_synthesises_nothing(synthesised):
    agent = GuideVoiceAgent(FakeTurns(), DeliveryState())
    assert [f async for f in agent.tts_node(_gen(), None)] == []
    assert synthesised == []
