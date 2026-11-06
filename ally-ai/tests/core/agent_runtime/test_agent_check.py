"""The agent's check rules, as a pure function."""

import pytest

from app.core.agent_runtime.check import (
    REJECTIONS,
    check_reply,
    detail_kinds,
    looks_factual,
    mentions_sources,
    organisation_of,
    plain_text,
    rejection_feedback,
    unsupported_details,
)
from tests.core.knowledge_agent.test_agent import CHUNK_A, CHUNK_B, passage

PASSAGES = [passage(CHUNK_A, 0.7), passage(CHUNK_B, 0.6)]
ALLY = organisation_of(
    {
        "persona": {"display_name": "Ally FAQ"},
        "knowledge_topics": ["Ally FAQ – About Ally", "Ally FAQ – Privacy and Data"],
    }
)
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

    def test_general_bot_answers_a_general_topic_after_a_search_found_nothing(self):
        result, rejection = review(
            answer="CBT is a talking therapy…",
            general=True,
            searched=True,
            passages=[],
            question="What is CBT?",
            organisation=ALLY,
        )
        assert rejection is None
        assert result["intent"] == "answer"
        assert result["retrieval"]["unsupported"] is True

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


class TestGeneralKnowledgeNeverCoversTheOrganisation:
    """documents_and_general: uncited only for other topics, only after a search."""

    def general(self, *args, **kw):
        options = dict(general=True, organisation=ALLY)
        if not args:
            options["answer"] = "Ally is a platform…"
        options.update(kw)
        return review(*args, **options)

    def test_the_organisations_names_come_from_the_bot(self):
        assert ALLY.terms == ("Ally FAQ", "Ally")
        assert ALLY.named_in("Ally kya hai?")
        assert ALLY.named_in("who made ally?")
        assert not ALLY.named_in("who are you, Ally FAQ?")  # the bot itself
        assert not ALLY.named_in("What is CBT?")

    def test_a_question_naming_it_with_no_search_is_sent_back_to_search(self):
        result, rejection = self.general(
            question="Ally kya hai?", searched=False, passages=[]
        )
        assert result["intent"] == "decline"
        assert result["answer"] == ""
        assert rejection == "uncited"
        feedback = rejection_feedback(rejection, {}, searched=False)
        assert feedback.endswith("You haven't searched yet: search before you reply.")

    def test_not_even_after_a_search_that_found_nothing(self):
        result, rejection = self.general(
            question="who made Ally?", searched=True, passages=[]
        )
        assert result["intent"] == "decline"
        assert rejection == "uncited"

    def test_nor_when_a_search_found_passages(self):
        result, rejection = self.general(question="What is Ally?", searched=True)
        assert rejection == "uncited"
        assert result["retrieval"]["unsupported"] is False

    def test_an_answer_to_a_question_that_names_it_counts_too(self):
        _, rejection = self.general(
            question="who runs this?", searched=True, passages=[], turn_type="question"
        )
        assert rejection == "uncited"

    def test_a_general_topic_needs_a_search_first(self):
        _, rejection = self.general(
            question="What is CBT?", answer="CBT is…", searched=False, passages=[]
        )
        assert rejection == "uncited"

    def test_a_general_topic_with_passages_found_must_cite_them(self):
        _, rejection = self.general(
            question="What is CBT?", answer="CBT is…", searched=True
        )
        assert rejection == "uncited"

    def test_small_talk_answering_a_question_about_it_needs_a_source(self):
        result, rejection = self.general(
            "smalltalk",
            "Ally is a not-for-profit platform.",
            question="What is Ally?",
            turn_type="about_bot",
            passages=[],
        )
        assert result["intent"] == "decline"
        assert rejection == "uncited"

    def test_saying_who_it_is_stays_small_talk(self):
        result, rejection = review(
            "answer",
            "I'm Ally FAQ. I can help with questions about Ally.",
            question="who are you?",
            turn_type="about_bot",
            passages=[],
            organisation=ALLY,
        )
        assert rejection is None
        assert result["intent"] == "answer"


class TestDeclineThatIgnoresWhatWasFound:
    def test_is_sent_back_to_use_the_passages(self):
        result, rejection = review(
            "decline",
            "Yeh general jankari hai — documents mein iska varnan nahi hai.",
            question="Ally kya hai?",
            organisation=ALLY,
            searched=True,
        )
        assert rejection == "use_found"
        # If the rewrite fails too, nothing of this text is sent.
        assert result["answer"] == ""

    def test_a_decline_about_something_else_keeps_its_words(self):
        result, rejection = review(
            "decline",
            "I can't help with weather forecasts.",
            question="weather tomorrow?",
            organisation=ALLY,
            searched=True,
        )
        assert rejection is None
        assert result["answer"] == "I can't help with weather forecasts."

    def test_a_link_in_a_decline_needs_a_passage(self):
        result, rejection = review(
            "decline",
            "I don't have that. Try www.example.org or call 1800 123 456.",
            passages=[],
        )
        assert rejection == "unsourced_detail"
        assert result["answer"] == ""

    def test_a_link_a_passage_gives_is_fine(self):
        found = [passage(CHUNK_A, 0.7, text="Contact us at www.helloally.ai.")]
        _, rejection = review(
            "decline",
            "Refunds aren't covered here; ask through www.helloally.ai.",
            passages=found,
            question="refund policy?",
        )
        assert rejection is None


class TestPlainText:
    def test_a_markdown_link_becomes_its_bare_url(self):
        assert (
            plain_text("Visit [www.helloally.ai](https://www.helloally.ai) today.")
            == "Visit https://www.helloally.ai today."
        )

    def test_bold_and_headings_are_dropped(self):
        assert plain_text("## Steps\n**Open** the app and tap *Sign in*.") == (
            "Steps\nOpen the app and tap Sign in."
        )

    def test_every_reply_goes_out_as_plain_text(self):
        result = check(
            "answer",
            "**Yes.** See [the policy](https://app.helloally.ai/privacy).",
            citations=[1],
        )
        assert result["answer"] == "Yes. See https://app.helloally.ai/privacy."

    def test_unsupported_details_checks_links_emails_and_numbers(self):
        found = [passage(CHUNK_A, 0.7, text="Call Tele-MANAS on 14416.")]
        assert unsupported_details("Call 14416 or 112.", found) == ["112"]
        assert unsupported_details("Email a@b.org", []) == ["a@b.org"]


class TestDeclineWithoutSearching:
    def test_about_the_organisation_is_sent_back_to_search(self):
        result, rejection = review(
            "decline",
            "I don't have that information.",
            question="Does Ally store the audio of my real sessions?",
            organisation=ALLY,
            searched=False,
            passages=[],
        )
        assert rejection == "search_first"
        assert result["answer"] == ""

    def test_about_something_else_keeps_its_words(self):
        _, rejection = review(
            "decline",
            "I can't help with the weather.",
            question="weather tomorrow?",
            organisation=ALLY,
            searched=False,
            passages=[],
        )
        assert rejection is None


class TestTalkAboutSources:
    @pytest.mark.parametrize(
        "text",
        [
            "I don't have a refund policy in my reference material.",
            "The documents don't cover this.",
            "Hamare diye gaye documents mein iska varnan nahi hai.",
            "Based on the passages, yes.",
        ],
    )
    def test_is_recognised(self, text):
        assert mentions_sources(text)

    def test_a_product_feature_named_documents_is_not(self):
        assert not mentions_sources("Upload documents to Ally Assist to share notes.")

    def test_is_sent_back_but_kept_if_the_rewrite_still_does_it(self):
        result, rejection = review(
            "decline",
            "I don't have that in my reference material.",
            passages=[],
            question="refund policy?",
        )
        assert rejection == "mentions_sources"
        # Wording, not safety: the final pass keeps the text.
        assert result["answer"] == "I don't have that in my reference material."

    def test_a_cited_answer_keeps_its_citations(self):
        result, rejection = review(
            "answer", "Per the documents I have, sign-in uses a code.", citations=[1]
        )
        assert rejection == "mentions_sources"
        assert result["intent"] == "answer"
        assert len(result["citations"]) == 1
