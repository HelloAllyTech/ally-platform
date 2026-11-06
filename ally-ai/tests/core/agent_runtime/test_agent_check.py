"""The agent's check rules, as a pure function."""

import pytest

from app.core.agent_runtime.check import (
    REJECTIONS,
    check_reply,
    detail_kinds,
    looks_factual,
    rejection_feedback,
)
from tests.core.knowledge_agent.test_agent import CHUNK_A, CHUNK_B, passage

PASSAGES = [passage(CHUNK_A, 0.7), passage(CHUNK_B, 0.6)]
META = {"provider": "openai", "model": "gpt-5-mini"}
RETRIEVAL = {"hit_count": 2, "top_similarity": 0.7, "unsupported": False}


def check(*args, **kw):
    return review(*args, **kw)[0]


def review(
    intent="answer",
    answer="Text.",
    citations=(),
    action="reply",
    passages=PASSAGES,
    **kw,
):
    """``(result, rejection)``."""
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
        search_gate=None,
    )
    args.update(kw)
    return check_reply(step, META, list(passages), **args)


class TestAnswer:
    def test_cited_answer_passes_with_resolved_citations(self):
        result = check(citations=[2])
        assert result["intent"] == "answer"
        assert result["decline_reason"] == "none"
        assert [c["chunk_id"] for c in result["citations"]] == [CHUNK_B]
        assert result["retrieval"]["passages_used"] == 2

    def test_uncited_answer_becomes_a_decline_with_no_text(self):
        result, rejection = review(answer="Refunds take 5 days.")
        assert result["intent"] == "decline"
        assert result["decline_reason"] == "model_declined"
        assert result["answer"] == ""
        assert rejection == "uncited"

    def test_a_cited_answer_is_not_rejected(self):
        assert review(citations=[1])[1] is None

    def test_out_of_range_citations_are_dropped(self):
        result = check(citations=[9, 1, 1])
        assert [c["passage_number"] for c in result["citations"]] == [1]

    def test_only_out_of_range_citations_is_uncited(self):
        assert check(citations=[7])["intent"] == "decline"

    def test_general_bot_keeps_an_uncited_answer_flagged(self):
        result, rejection = review(answer="General info: …", general=True)
        assert result["intent"] == "answer"
        assert result["retrieval"]["unsupported"] is True
        assert rejection is None

    def test_empty_answer_is_a_decline(self):
        result, rejection = review(answer="  ", citations=[1])
        assert result["intent"] == "decline"
        assert rejection == "empty"


class TestSmalltalk:
    def test_passes_without_citations_as_an_answer(self):
        result, rejection = review(
            "smalltalk", "Hi! I'm here to help.", turn_type="smalltalk", passages=[]
        )
        assert rejection is None
        assert result["intent"] == "answer"
        assert result["decline_reason"] == "none"
        assert result["citations"] == []
        assert result["turn_type"] == "smalltalk"
        assert result["retrieval"]["unsupported"] is False

    def test_citations_on_smalltalk_are_cleared(self):
        result = check("smalltalk", "Hello!", citations=[1], passages=[])
        assert result["citations"] == []

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
        result, rejection = review("smalltalk", text, passages=[])
        assert result["intent"] == "decline"
        assert result["answer"] == ""
        assert rejection == "unsourced_detail"

    def test_factual_looking_smalltalk_with_a_citation_is_an_answer(self):
        result = check("smalltalk", "Plans start at ₹500.", citations=[1])
        assert result["intent"] == "answer"
        assert len(result["citations"]) == 1

    def test_smalltalk_after_a_search_that_found_something_must_be_cited(self):
        result = check("smalltalk", "Sure, happy to help.")
        assert result["intent"] == "decline"

    def test_an_uncited_answer_to_about_bot_is_smalltalk(self):
        result, rejection = review(
            "answer",
            "I help with questions about Ally.",
            turn_type="about_bot",
            passages=[],
        )
        assert rejection is None
        assert result["intent"] == "answer"
        assert result["turn_type"] == "about_bot"

    def test_but_not_with_a_detail_or_to_a_question(self):
        about = review(
            "answer", "Visit www.example.org", turn_type="about_bot", passages=[]
        )
        assert about[1] == "uncited"
        assert review("answer", "Refunds take days.", passages=[])[1] == "uncited"

    def test_plain_greeting_is_not_factual(self):
        assert not looks_factual("Namaste! How can I help you today?")


class TestClarifyAndDecline:
    def test_clarify_carries_no_citations(self):
        result = check("clarify", "What doesn't work: the app or sign-in?", [1])
        assert result["intent"] == "clarify"
        assert result["citations"] == []

    def test_model_decline_keeps_its_own_words(self):
        result, rejection = review(
            "decline", "I don't have that, but I can help with sign-in."
        )
        assert result["answer"].startswith("I don't have that")
        assert result["decline_reason"] == "model_declined"
        assert rejection is None

    def test_decline_after_a_search_that_found_nothing_keeps_the_gate_reason(self):
        result = check("decline", "No.", search_gate="no_hits", passages=[])
        assert result["decline_reason"] == "no_hits"

    def test_gate_reason_dropped_once_a_later_search_found_passages(self):
        result = check("decline", "No.", search_gate="no_hits")
        assert result["decline_reason"] == "model_declined"

    def test_a_tool_call_past_the_budget_is_a_decline(self):
        result, rejection = review(action="search_knowledge", answer="")
        assert result["intent"] == "decline"
        assert result["decline_reason"] == "model_declined"
        assert rejection == "empty"


class TestRejectionFeedback:
    def test_names_the_kinds_of_unsourced_detail(self):
        step = {"answer": "See www.example.org or call 1800 123."}
        assert detail_kinds(step["answer"]) == ["a link", "a number"]
        feedback = rejection_feedback("unsourced_detail", step)
        assert feedback.endswith("It contained a link and a number.")
        assert "example.org" not in feedback

    def test_asks_for_a_search_when_none_was_made(self):
        feedback = rejection_feedback("uncited", {"answer": "x"}, searched=False)
        assert feedback.endswith("You haven't searched yet: search before you reply.")
        assert "searched yet" not in rejection_feedback("empty", {}, searched=False)

    def test_other_reasons_are_plain(self):
        assert rejection_feedback("uncited", {"answer": "5 days"}) == (
            REJECTIONS["uncited"]
        )
