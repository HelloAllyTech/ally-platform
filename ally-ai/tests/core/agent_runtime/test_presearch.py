"""Chunk H1 Part C: search before the first call, and the reply streamed as written."""

from unittest.mock import patch

import pytest

from app.core.agent_runtime import trace
from app.core.config import settings
from app.core.llm.dispatch import AnswerStream
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, chat, nodes, reply
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage


@pytest.fixture
def presearch_on(monkeypatch):
    monkeypatch.setattr(settings.AGENT_RUNTIME, "PRESEARCH", True)


@pytest.fixture
def agent_run(run):
    async def _run(question, llm, **bot):
        with patch(f"{CONVERSATION}.generate_structured", llm):
            return await run(question, **bot)

    return _run


@pytest.mark.asyncio
async def test_a_plain_question_is_answered_in_one_model_call(
    presearch_on, agent_run, chunk_service
):
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    llm = FakeLLM(reply(citations=[1]))
    state = await agent_run("What is Ally?", llm)

    assert chunk_service.search.call_args.kwargs["query"] == "What is Ally?"
    assert len(llm.calls) == 1
    assert nodes(state) == ["tool", "agent", "check"]
    assert state["result"]["intent"] == "answer"
    assert state["result"]["retrieval"]["hit_count"] == 1


@pytest.mark.asyncio
async def test_a_plain_yes_is_not_searched(presearch_on, agent_run, chunk_service):
    llm = FakeLLM(chat(turn_type="smalltalk"))
    await agent_run("Yes, book it.", llm)
    chunk_service.search.assert_not_called()


@pytest.mark.asyncio
async def test_a_greeting_or_introduction_is_not_searched(
    presearch_on, agent_run, chunk_service
):
    """TF1 round 2 (Saathi B-1): "Hi, I'm Asha" was searched, and the passages it
    found made the check decline the greeting."""
    llm = FakeLLM(chat(turn_type="smalltalk"))
    await agent_run("Hi, I'm Asha", llm)
    chunk_service.search.assert_not_called()


@pytest.mark.asyncio
async def test_a_question_after_a_greeting_is_searched(
    presearch_on, agent_run, chunk_service
):
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    # A second step for the check's one rewrite (the fake reply cites nothing).
    llm = FakeLLM(chat(turn_type="question"), chat(turn_type="question"))
    await agent_run("Hi, I'm Asha, are you open now?", llm)
    chunk_service.search.assert_called()


@pytest.mark.asyncio
async def test_a_message_in_another_script_is_searched_by_the_agent_in_english(
    presearch_on, agent_run, chunk_service
):
    # Q4: searched as written, a Hindi question found nothing in English pages.
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    llm = FakeLLM(chat(turn_type="smalltalk"))
    await agent_run("डिलीवरी में कितने दिन लगते हैं?", llm)
    chunk_service.search.assert_not_called()


def test_only_a_mostly_non_latin_message_counts_as_another_script():
    from app.core.agent_runtime.nodes.presearch import mostly_non_latin

    assert mostly_non_latin("डिलीवरी में कितने दिन लगते हैं?")
    assert mostly_non_latin("என் உணவகம் சென்னையில் உள்ளது")
    assert mostly_non_latin("আপনারা কি টাকা দান নেন?")
    assert not mostly_non_latin("Delhi wale centre ka time kya hai?")
    assert not mostly_non_latin("How much is a day pass at BKC?")
    assert not mostly_non_latin("Café opening hours?")
    assert not mostly_non_latin("12345")


@pytest.mark.asyncio
async def test_off_the_agent_decides_as_before(agent_run, chunk_service):
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    llm = FakeLLM(chat(turn_type="smalltalk"))
    await agent_run("hello", llm)
    chunk_service.search.assert_not_called()


def test_the_answer_streams_once_the_step_replies():
    out = []
    stream = AnswerStream(out.append)
    body = (
        '{"action":"reply","turn_type":"question","intent":"answer",'
        '"answer":"Mon\\u2013Sat, 9 AM \\"to\\" 7 PM.\\nCall us","citations":[1]}'
    )
    for i in range(0, len(body), 3):
        stream.feed(body[i : i + 3])
    assert "".join(out) == 'Mon–Sat, 9 AM "to" 7 PM.\nCall us'


def test_a_tool_step_streams_nothing():
    out = []
    stream = AnswerStream(out.append)
    for char in '{"action":"find_slots","find_slots":{"answer":"x"},"answer":"no"}':
        stream.feed(char)
    assert out == []


def test_streamed_tokens_drop_citation_markers(monkeypatch):
    sent = []
    monkeypatch.setattr(trace, "emit", lambda event, data: sent.append(data["text"]))
    flag = {"any": False}
    token = trace.STREAMED.set(flag)
    try:
        tokens = trace.ReplyTokens()
        for piece in ["Open 9 to 7 ", "[", "1]", "[2] and ", "Sunday 9 to 1 [3", "]."]:
            tokens(piece)
    finally:
        trace.STREAMED.reset(token)
    assert "".join(sent) == "Open 9 to 7 and Sunday 9 to 1."
    assert flag["any"] is True


def test_hinglish_is_left_to_the_agents_english_query():
    from app.core.agent_runtime.nodes.presearch import looks_hinglish

    assert looks_hinglish("Delhi wale centre ka time kya hai? Visit karna hai")
    assert looks_hinglish("paise donate kar sakte hain? 80G milega?")
    assert not looks_hinglish("Is it free to talk to a counsellor?")
    assert not looks_hinglish("Main road toh closed?")
