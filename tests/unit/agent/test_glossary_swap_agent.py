from unittest.mock import patch

from livekit.agents import Agent, llm

from app.core.agent.factory import GlossarySwapAgent


def _chunks(*texts: str):
    return [
        llm.ChatChunk(id="c1", delta=llm.ChoiceDelta(role="assistant", content=t))
        for t in texts
    ]


async def _run(agent: GlossarySwapAgent, items) -> tuple[str, list]:
    async def fake_default(self, chat_ctx, tools, model_settings):
        for item in items:
            yield item

    out: list = []
    with patch.object(Agent.default, "llm_node", fake_default):
        async for chunk in agent.llm_node(None, [], None):
            out.append(chunk)
    text = "".join(c if isinstance(c, str) else (c.delta.content or "") for c in out)
    return text, out


async def test_llm_node_swaps_across_chunk_boundaries_and_records_metrics():
    agent = GlossarySwapAgent(
        instructions="",
        swap_table={"அதனால்": "அதனால"},
        room_name="room-1",
    )
    with patch("app.core.agent.factory.turn_metrics") as metrics:
        text, out = await _run(agent, _chunks("சரி அதனா", "ல் சொல்", "றேன்."))
    assert text == "சரி அதனால சொல்றேன்."
    assert all(isinstance(c, llm.ChatChunk) for c in out)
    metrics.record.assert_called_once_with(
        "room-1",
        metadata={"glossary_swaps": [{"avoid": "அதனால்", "say": "அதனால", "count": 1}]},
    )


async def test_llm_node_is_a_pass_through_without_a_table():
    agent = GlossarySwapAgent(instructions="", swap_table={}, room_name="room-1")
    items = _chunks("அதனால் ", "சரி")
    with patch("app.core.agent.factory.turn_metrics") as metrics:
        text, out = await _run(agent, items)
    assert text == "அதனால் சரி"
    assert out == items
    metrics.record.assert_not_called()


async def test_llm_node_handles_plain_string_chunks():
    agent = GlossarySwapAgent(
        instructions="", swap_table={"பற்றி": "பத்தி"}, room_name="room-1"
    )
    with patch("app.core.agent.factory.turn_metrics"):
        text, _ = await _run(agent, ["அது பற்", "றி தான்"])
    assert text == "அது பத்தி தான்"
