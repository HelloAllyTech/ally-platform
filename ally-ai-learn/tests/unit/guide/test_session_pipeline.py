"""The relay inside a real (text-only) LiveKit AgentSession.

No room, STT or TTS: LiveKit's own pipeline drives ``GuideVoiceAgent.llm_node``
and adds the assistant messages the ledger listens for, exactly as in a voice
session minus the audio.
"""

from livekit.agents import AgentSession

from app.core.guide.agent import BackendRelayLLM, GuideVoiceAgent
from app.core.guide.crisis import DEFAULT_CRISIS_TEXT, DeliveryState
from app.core.guide.ledger import SpokenReplyLedger
from app.core.guide.turns import GuideVoiceTurns
from tests.unit.guide.test_turns import FakeClient, delta, done, hint


async def test_replies_flow_through_livekits_pipeline():
    client = FakeClient(
        [delta("Hello there. "), hint("It's just below."), delta("Ready?"), done("t1")],
        [delta(DEFAULT_CRISIS_TEXT), done("t2")],
    )
    ledger = SpokenReplyLedger()
    delivery = DeliveryState()
    turns = GuideVoiceTurns(
        client,
        token="vt",
        language="en",
        ledger=ledger,
        delivery=delivery,
        on_leave=lambda reason: None,
        slow_turn_after_s=0,
    )
    session = AgentSession(llm=BackendRelayLLM())
    replies = []

    @session.on("conversation_item_added")
    def _on_item(event):
        item = event.item
        if item.role == "assistant":
            replies.append(item.text_content)
            ledger.on_assistant_message(
                item.text_content or "", interrupted=item.interrupted
            )

    await session.start(GuideVoiceAgent(turns, delivery))
    try:
        await session.run(user_input="let's start")
        await session.run(user_input="I don't feel safe")
    finally:
        await session.aclose()

    assert [r.text for r in client.requests] == ["let's start", "I don't feel safe"]
    assert replies == [
        "Hello there. It's just below. Ready?",
        DEFAULT_CRISIS_TEXT,  # the flushes around it never reach the transcript
    ]
    # The first reply played to the end, so nothing is reported as cut off.
    second = client.requests[1].model_dump(by_alias=True, exclude_none=True)
    assert "interruptedTurnId" not in second
    assert delivery.crisis is True
