"""The agent's check rules, as a pure function."""

import pytest

from app.core.agent_runtime.check import (
    REJECTIONS,
    check_reply,
    detail_kinds,
    fallback_contact,
    looks_factual,
    mentions_sources,
    organisation_of,
    plain_text,
    rejection_feedback,
    says_it_has_nothing,
    unsupported_details,
)
from app.core.agent_runtime.prompt import NO_TOPICS, format_topics
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
        priced = [passage(CHUNK_A, 0.7, text="Plans start at ₹500 a month.")]
        result = check(
            "smalltalk", "Plans start at ₹500.", citations=[1], passages=priced
        )
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
        assert about[1] == "unsourced_detail"
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
        # A nudge: the passages may be about something else, so a decline the
        # rewrite still chooses goes out in its own words.
        assert result["answer"].startswith("Yeh general jankari hai")

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
        # If the rewrite still has it, the sentence carrying it is removed.
        assert result["answer"] == "I don't have that."
        assert result["intent"] == "decline"

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
        policy = [passage(CHUNK_A, 0.7, text="See app.helloally.ai/privacy.")]
        result = check(
            "answer",
            "**Yes.** See [the policy](https://app.helloally.ai/privacy).",
            citations=[1],
            passages=policy,
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
    def test_the_no_topics_line_does_not_lead_to_talk_about_sources(self):
        """Whatever the prompt tells the model to say, the check must let through."""
        assert format_topics([]) == NO_TOPICS
        assert not mentions_sources(NO_TOPICS)

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

    @pytest.mark.parametrize(
        "written,sent",
        [
            (
                "I don't have information on refunds in my reference material.",
                "I don't have information on refunds.",
            ),
            (
                "I don't have a description of Ally in my reference materials. Ask "
                "your admin.",
                "I don't have a description of Ally. Ask your admin.",
            ),
            (
                "I don't have that in my references, sorry.",
                "I don't have that, sorry.",
            ),
            (
                "Mujhe meri reference materials mein iski jaankari nahi hai.",
                "Mujhe iski jaankari nahi hai.",
            ),
        ],
    )
    def test_the_common_phrase_is_cut_without_a_rewrite(self, written, sent):
        result, rejection = review(
            "decline", written, passages=[], question="refund policy?"
        )
        assert rejection is None
        assert result["answer"] == sent

    def test_other_source_talk_is_sent_back_and_kept_if_the_rewrite_does_it(self):
        result, rejection = review(
            "decline",
            "The documents don't cover that.",
            passages=[],
            question="refund policy?",
        )
        assert rejection == "mentions_sources"
        # Wording, not safety: the final pass keeps the text.
        assert result["answer"] == "The documents don't cover that."

    def test_a_cited_answer_keeps_its_citations(self):
        result, rejection = review(
            "answer", "The documents say sign-in uses a code.", citations=[1]
        )
        assert rejection == "mentions_sources"
        assert result["intent"] == "answer"
        assert len(result["citations"]) == 1


class TestContactDetailsInEveryReply:
    """Phone numbers, links and emails must be in a passage offered this run, word
    for word: sent back once, then the sentence carrying one is removed."""

    def test_a_cited_answer_with_unsourced_helplines(self):
        found = [passage(CHUNK_A, 0.7, text="Ally is a not-for-profit platform.")]
        result, rejection = review(
            "answer",
            "Ally is a not-for-profit platform. In a crisis call Tele-MANAS 14416 "
            "or 112.",
            citations=[1],
            passages=found,
        )
        assert rejection == "unsourced_detail"
        assert result["intent"] == "answer"
        assert result["answer"] == "Ally is a not-for-profit platform."
        assert len(result["citations"]) == 1

    def test_the_same_numbers_from_a_passage_stay(self):
        found = [passage(CHUNK_A, 0.7, text="Call Tele-MANAS on 14416, or 112.")]
        result, rejection = review(
            "answer", "Call Tele-MANAS on 14416, or 112.", citations=[1], passages=found
        )
        assert rejection is None
        assert "14416" in result["answer"]

    @pytest.mark.parametrize(
        "intent,turn_type",
        [("smalltalk", "smalltalk"), ("clarify", "unclear"), ("decline", "question")],
    )
    def test_every_reply_type(self, intent, turn_type):
        result, rejection = review(
            intent,
            "Happy to help. Write to help@example.org or call 1800-123-456.",
            turn_type=turn_type,
            passages=[],
        )
        assert rejection == "unsourced_detail"
        assert result["answer"] == "Happy to help."

    def test_nothing_left_is_a_decline(self):
        result, _ = review("smalltalk", "Call 1800 123 456.", passages=[])
        assert result["intent"] == "decline"
        assert result["answer"] == ""

    def test_step_numbers_and_short_counts_are_not_contacts(self):
        result, rejection = review(
            "answer", "1. Open the app.\n2. Wait 5 minutes.", citations=[1]
        )
        assert rejection is None
        assert result["answer"] == "1. Open the app.\n2. Wait 5 minutes."

    def test_a_bare_domain_counts_as_a_link(self):
        assert unsupported_details("Visit helloally.ai today.", []) == ["helloally.ai"]


class TestCrisisWordingOncePerConversation:
    INTRO = [
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": "Hi, I'm Ally FAQ. I'm not a crisis service. How can I help?",
        },
    ]

    def test_later_small_talk_drops_crisis_lines(self):
        result, rejection = review(
            "smalltalk",
            "You're welcome! If you're in crisis, call your local helpline.",
            turn_type="smalltalk",
            passages=[],
            history=self.INTRO,
        )
        # Trimmed directly: no rewrite for a wording fix.
        assert rejection is None
        assert result["answer"] == "You're welcome!"

    def test_not_a_crisis_service_is_said_once(self):
        result, _ = review(
            "smalltalk",
            "I'm Ally FAQ, here for questions about Ally. I'm not a crisis service.",
            turn_type="about_bot",
            passages=[],
            history=self.INTRO,
        )
        assert result["answer"] == "I'm Ally FAQ, here for questions about Ally."

    def test_the_first_introduction_keeps_it(self):
        _, rejection = review(
            "smalltalk",
            "Hi, I'm Ally FAQ. I'm not a crisis service.",
            turn_type="smalltalk",
            passages=[],
        )
        assert rejection is None


class TestOneHindiForm:
    @pytest.mark.parametrize(
        "written,sent",
        [
            ("Main madad kar sakta/ti hoon.", "Main madad kar sakta hoon."),
            ("Main bata sakta / sakti hoon.", "Main bata sakta hoon."),
            ("Main batata/batati hoon.", "Main batata hoon."),
            ("Main help karunga/karungi.", "Main help karunga."),
        ],
    )
    def test_both_genders_become_one(self, written, sent):
        assert plain_text(written) == sent

    def test_ordinary_slashes_stay(self):
        assert plain_text("Use sign-in/sign-up.") == "Use sign-in/sign-up."


class TestAnswerThatHasNothing:
    def test_is_a_decline_in_its_own_words(self):
        result, rejection = review(
            "answer",
            "I don't have information on refunds. Ask your organisation.",
            citations=[1],
            question="what's your refund policy?",
        )
        assert rejection is None
        assert result["intent"] == "decline"
        assert result["citations"] == []
        assert result["answer"].startswith("I don't have information on refunds.")

    def test_a_real_answer_is_not(self):
        result, _ = review("answer", "Yes, sign-in uses a code.", citations=[1])
        assert result["intent"] == "answer"


class TestTopicsOfferedOnce:
    HI = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "Hi, I'm Ally FAQ. What can I help with?"},
    ]
    BOT = organisation_of(
        {
            "persona": {"display_name": "Ally FAQ"},
            "knowledge_topics": [
                "Ally FAQ – Skills Lab Practice",
                "Ally FAQ – Privacy and Data",
                "Ally FAQ – Getting Access and Signing In",
            ],
        }
    )

    def test_later_small_talk_drops_the_list(self):
        result, rejection = review(
            "smalltalk",
            "Great! I can help with Skills Lab practice, privacy and getting access.",
            turn_type="smalltalk",
            passages=[],
            history=self.HI,
            organisation=self.BOT,
        )
        assert rejection is None  # trimmed directly
        assert result["answer"] == "Great!"

    def test_a_list_and_nothing_else_is_kept_rather_than_declined(self):
        result, rejection = review(
            "smalltalk",
            "I can help with Skills Lab practice, privacy and getting access.",
            turn_type="smalltalk",
            passages=[],
            history=self.HI,
            organisation=self.BOT,
        )
        # Better than the bot's decline wording in reply to "ok".
        assert rejection is None
        assert result["intent"] == "answer"
        assert result["answer"].startswith("I can help with Skills Lab")

    def test_keeps_the_rest(self):
        result, _ = review(
            "smalltalk",
            "Sure. I can help with Skills Lab practice, privacy and getting access.",
            turn_type="smalltalk",
            passages=[],
            history=self.HI,
            organisation=self.BOT,
        )
        assert result["answer"] == "Sure."

    def test_a_list_in_other_words_counts(self):
        assert (
            self.BOT.topics_named_in(
                "Tell me what you need: Skills Lab practice, privacy, or access?"
            )
            == 3
        )
        assert self.BOT.topics_named_in("Anything else you need with Ally?") == 0

    def test_the_first_message_may_list_them(self):
        _, rejection = review(
            "smalltalk",
            "Hi! I can help with Skills Lab practice, privacy and getting access.",
            turn_type="smalltalk",
            passages=[],
            organisation=self.BOT,
        )
        assert rejection is None


class TestOrganisationFromPageTitles:
    """Crawled pages are titled "Page — Business" (chunk 20a): the business is the
    shared side, never the page label (chunk 20a-2)."""

    BOT = {
        "persona": {"display_name": "Bright Minds Academy assistant"},
        "knowledge_topics": [
            "Bright Minds Academy — Coaching for Class 8 to 12 in Kothrud",
            "Batch timings — Bright Minds Academy",
            "Courses — Bright Minds Academy",
            "Contact — Bright Minds Academy",
        ],
    }

    def test_the_business_is_the_name_and_page_labels_are_topics(self):
        org = organisation_of(self.BOT)
        assert "Bright Minds Academy" in org.terms
        assert "Batch timings" not in org.terms
        assert "Courses" not in org.terms
        assert "Batch timings" in org.topics

    def test_an_ordinary_question_doesnt_name_the_organisation(self):
        org = organisation_of(self.BOT)
        assert not org.named_in("What are the morning and evening batch timings?")
        assert org.named_in("Where is Bright Minds Academy?")

    def test_shared_prefixes_still_name_the_organisation(self):
        org = organisation_of(
            {"knowledge_topics": ["Ally FAQ – About Ally", "Ally FAQ – Pricing"]}
        )
        assert "Ally FAQ" in org.terms
        assert org.topics == ("About Ally", "Pricing")


class TestSaysItHasNothing:
    """A reply that opens by saying it has nothing is a decline, whatever the model
    labelled it (chunk 20a-2: curly apostrophes, and "I don't have a …")."""

    @pytest.mark.parametrize(
        "text",
        [
            "I don’t have a refund policy. Ask your organisation instead.",
            "I don’t have information about that.",
            "Sorry, I don’t have the batch timings.",
            "I don't have any details on parking.",
        ],
    )
    def test_declines(self, text):
        assert says_it_has_nothing(text)

    @pytest.mark.parametrize(
        "text",
        [
            "We don’t have a cancellation fee.",
            "I don’t have to ask: yes, it is free.",
            "Yes, there is parking in the basement.",
        ],
    )
    def test_answers(self, text):
        assert not says_it_has_nothing(text)


class TestFallbackContact:
    """Every decline gives the owner's fallback contact (onboarding's "When it
    doesn't know"), word for word from the bot's decline wording (chunk 20a-2)."""

    WORDING = "I don't have that information — please call +91 20 0000 4400."

    def test_a_decline_without_it_gets_the_configured_contact(self):
        result, _ = review(
            "decline",
            "I can't share a staff member's personal number.",
            decline_text=self.WORDING,
        )
        assert result["intent"] == "decline"
        assert result["answer"] == (
            "I can't share a staff member's personal number. "
            "Please call +91 20 0000 4400."
        )

    def test_a_decline_that_has_it_is_left_alone(self):
        text = "I don't have that. Please call +91 20 0000 4400 to ask."
        result, _ = review("decline", text, decline_text=self.WORDING)
        assert result["answer"] == text

    def test_an_invented_number_is_removed_and_the_configured_one_added(self):
        result, _ = review(
            "decline",
            "I don't have her number. Try 98765 43210.",
            decline_text=self.WORDING,
            passages=[],
        )
        assert "98765" not in result["answer"]
        assert result["answer"].endswith("Please call +91 20 0000 4400.")

    def test_no_contact_in_the_wording_adds_nothing(self):
        text = "I don't have that information."
        result, _ = review("decline", text, decline_text="Please ask our front desk.")
        assert result["answer"] == text

    def test_answers_are_untouched(self):
        result, _ = review(
            "answer", "It costs Rs. 1,800.", citations=[1], decline_text=self.WORDING
        )
        assert "4400" not in result["answer"]

    def test_the_contact_clause(self):
        assert fallback_contact(self.WORDING) == "Please call +91 20 0000 4400."
        assert fallback_contact("Please ask our front desk.") == ""


class TestOutRefund:
    """3a eval case `out-refund`: the reply declines in words but the model labelled
    it an answer and cited where to go. The label follows what the reply does, so
    ally-be files it as unanswered (chunk 20a-2)."""

    def test_a_cited_answer_that_says_it_has_nothing_is_a_decline(self):
        result, _ = review(
            "answer",
            "I don’t have any information about a refund policy. Please ask your "
            "organisation, who manage access and billing.",
            citations=[1],
        )
        assert result["intent"] == "decline"
        assert result["citations"] == []
        assert result["answer"].startswith("I don’t have any information")


class TestBookingOffers:
    """The assistant can't book, so offers to are trimmed (chunk 20a-2)."""

    def test_an_offer_to_book_is_trimmed_and_how_to_book_stays(self):
        result, _ = review(
            "answer",
            "Couples sessions are 75 minutes. You can book on WhatsApp. "
            "Would you like me to book a slot for you?",
            citations=[1],
        )
        assert result["answer"] == (
            "Couples sessions are 75 minutes. You can book on WhatsApp."
        )

    def test_a_decline_keeps_its_contact_and_loses_the_offer(self):
        result, _ = review(
            "decline",
            "I can't diagnose anyone. I can help you find and book a consultation.",
            decline_text="Please call +91 20 0000 4400.",
        )
        assert result["answer"] == (
            "I can't diagnose anyone. Please call +91 20 0000 4400."
        )

    def test_a_reply_that_is_only_an_offer_is_kept(self):
        text = "Would you like me to book a slot for you?"
        result, _ = review("decline", text)
        assert result["answer"] == text
