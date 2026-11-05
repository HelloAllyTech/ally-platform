"""The agent's check rules, as a pure function."""

import pytest

from app.core.agent_runtime.check import check_reply, looks_factual
from tests.core.knowledge_agent.test_agent import CHUNK_A, CHUNK_B, passage

PASSAGES = [passage(CHUNK_A, 0.7), passage(CHUNK_B, 0.6)]
META = {"provider": "openai", "model": "gpt-5-mini"}
RETRIEVAL = {"hit_count": 2, "top_similarity": 0.7, "unsupported": False}


def check(intent="answer", answer="Text.", citations=(), action="reply", **kw):
    step = {
        "action": action,
        "intent": intent,
        "answer": answer,
        "citations": list(citations),
        "language": "en",
    }
    args = dict(
        turn_type="question",
        language="en",
        retrieval=dict(RETRIEVAL),
        general=False,
        prefetch_gate=None,
        tool_passages=0,
    )
    args.update(kw)
    return check_reply(step, META, PASSAGES, **args)


class TestAnswer:
    def test_cited_answer_passes_with_resolved_citations(self):
        result = check(citations=[2])
        assert result["intent"] == "answer"
        assert result["decline_reason"] == "none"
        assert [c["chunk_id"] for c in result["citations"]] == [CHUNK_B]
        assert result["retrieval"]["passages_used"] == 2

    def test_uncited_answer_becomes_a_decline_with_no_text(self):
        result = check(answer="Refunds take 5 days.")
        assert result["intent"] == "decline"
        assert result["decline_reason"] == "model_declined"
        assert result["answer"] == ""

    def test_out_of_range_citations_are_dropped(self):
        result = check(citations=[9, 1, 1])
        assert [c["passage_number"] for c in result["citations"]] == [1]

    def test_only_out_of_range_citations_is_uncited(self):
        assert check(citations=[7])["intent"] == "decline"

    def test_general_bot_keeps_an_uncited_answer_flagged(self):
        result = check(answer="General info: …", general=True)
        assert result["intent"] == "answer"
        assert result["retrieval"]["unsupported"] is True

    def test_empty_answer_is_a_decline(self):
        assert check(answer="  ", citations=[1])["intent"] == "decline"


class TestSmalltalk:
    def test_passes_without_citations_as_an_answer(self):
        result = check("smalltalk", "Hi! I'm here to help.", turn_type="smalltalk")
        assert result["intent"] == "answer"
        assert result["decline_reason"] == "none"
        assert result["citations"] == []
        assert result["turn_type"] == "smalltalk"
        assert result["retrieval"]["unsupported"] is False

    def test_citations_on_smalltalk_are_cleared(self):
        assert check("smalltalk", "Hello!", citations=[1])["citations"] == []

    @pytest.mark.parametrize(
        "text",
        [
            "Sure! It costs ₹500 a month.",
            "Our office opens at 9.",
            "Write to help@example.org",
            "See https://example.org",
            "We give 20% off.",
        ],
    )
    def test_factual_looking_smalltalk_must_be_cited(self, text):
        result = check("smalltalk", text)
        assert result["intent"] == "decline"
        assert result["answer"] == ""

    def test_factual_looking_smalltalk_with_a_citation_is_an_answer(self):
        result = check("smalltalk", "Plans start at ₹500.", citations=[1])
        assert result["intent"] == "answer"
        assert len(result["citations"]) == 1

    def test_smalltalk_after_a_search_that_found_something_must_be_cited(self):
        result = check("smalltalk", "Sure, happy to help.", tool_passages=1)
        assert result["intent"] == "decline"

    def test_plain_greeting_is_not_factual(self):
        assert not looks_factual("Namaste! How can I help you today?")


class TestClarifyAndDecline:
    def test_clarify_carries_no_citations(self):
        result = check("clarify", "What doesn't work: the app or sign-in?", [1])
        assert result["intent"] == "clarify"
        assert result["citations"] == []

    def test_model_decline_keeps_its_own_words(self):
        result = check("decline", "I don't have that, but I can help with sign-in.")
        assert result["answer"].startswith("I don't have that")
        assert result["decline_reason"] == "model_declined"

    def test_decline_after_a_weak_prefetch_keeps_the_gate_reason(self):
        assert check("decline", "No.", prefetch_gate="no_hits")["decline_reason"] == (
            "no_hits"
        )

    def test_gate_reason_dropped_once_a_tool_found_passages(self):
        result = check("decline", "No.", prefetch_gate="no_hits", tool_passages=1)
        assert result["decline_reason"] == "model_declined"

    def test_a_tool_call_past_the_budget_is_a_decline(self):
        result = check(action="search_knowledge", answer="")
        assert result["intent"] == "decline"
        assert result["decline_reason"] == "model_declined"
