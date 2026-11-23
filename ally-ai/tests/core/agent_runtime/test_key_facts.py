"""Q4 G3: key facts are in every run's passages, citable, never counted as found."""

from unittest.mock import patch

import pytest

from app.core.agent_runtime.key_facts import MAX_CHARS, MAX_FACTS, key_fact_passages
from app.schemas.agent_runtime import KeyFacts
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, reply

DOC = "11111111-2222-3333-4444-555555555555"
FACTS = {
    "facts": [
        "Robin Hood Army is zero-funds: it takes no money, so there is no 80G receipt.",
        "Anyone can join for free on the Join Us page or at info@robinhoodarmy.com.",
    ],
    "document_id": DOC,
    "title": "What we learned",
}


def test_each_fact_is_a_citable_passage_from_its_document():
    passages = key_fact_passages({"key_facts": FACTS})
    assert [p["text"] for p in passages] == FACTS["facts"]
    assert {p["document_id"] for p in passages} == {DOC}
    assert all(p["key_fact"] for p in passages)
    # The same fact always has the same id, so citing it twice is one source.
    assert (
        passages[0]["chunk_id"]
        == key_fact_passages({"key_facts": FACTS})[0]["chunk_id"]
    )


def test_capped_at_ten_facts_and_about_500_tokens():
    many = {"facts": [f"Fact {i}." for i in range(15)], "document_id": DOC}
    assert len(key_fact_passages({"key_facts": many})) == MAX_FACTS
    long = {"facts": ["x" * 400] * 10, "document_id": DOC}
    assert (
        sum(len(p["text"]) for p in key_fact_passages({"key_facts": long})) <= MAX_CHARS
    )
    assert key_fact_passages({}) == []


def test_the_request_trims_and_caps_them():
    facts = KeyFacts(facts=["  a  ", "", "b" * 500])
    assert facts.facts == ["a", "b" * 400]
    with pytest.raises(ValueError):
        KeyFacts(facts=["f"] * 11)


@pytest.mark.asyncio
async def test_an_answer_can_cite_a_key_fact_without_a_search(run, chunk_service):
    llm = FakeLLM(
        reply(
            answer="No, we don't take money, so there is no 80G receipt [1].",
            citations=[1],
        )
    )
    with patch(f"{CONVERSATION}.generate_structured", llm):
        state = await run(
            "Can I donate ₹10,000 and get an 80G receipt?", key_facts=FACTS
        )
    assert state["result"]["intent"] == "answer"
    cited = state["result"]["citations"]
    assert cited and cited[0]["document_id"] == DOC
