"""The builder's steps: which sub-tasks run, the copy it uses, what it proposes, and
what it can never propose."""

from unittest.mock import patch

import pytest

from app.core.builder import catalogue, purposes
from app.core.builder.flow import BUILDER_PATHS, allowed, run_step
from app.schemas.builder import BuilderStepRequest, PatchOp, PurposeId
from tests.core.builder.fakes import TASKS, FakeLLM, request

GAPS = [
    {
        "key": "fees",
        "item": "your fees",
        "why": "Price is one of the first things people ask.",
    },
    {
        "key": "cancellation",
        "item": "your cancellation policy",
        "why": "People often ask before they book.",
    },
]


async def run(body, fake):
    with patch(f"{TASKS}.generate_structured", fake):
        return await run_step(BuilderStepRequest.model_validate(body), budget=30)


def paths(response):
    return {p.path: p.value for p in response.patches}


class TestLearned:
    @pytest.mark.asyncio
    async def test_looks_right_classifies_finds_gaps_and_asks_the_first(self):
        fake = FakeLLM(
            ClassifyOut=[{"industry": "mental_health", "confidence": 0.9}],
            GapsOut=[
                {
                    "missing": ["hours", "cancellation", "fees", "session_modes"],
                    "extra": [{"item": "your fees for couples sessions", "why": "x"}],
                }
            ],
        )
        res = await run(request("learned", chip=catalogue.LOOKS_RIGHT), fake)

        assert fake.schemas() == ["ClassifyOut", "GapsOut"]  # no conversation call
        assert res.industry.value == "mental_health"
        # Checklist order, not the model's; capped at three.
        assert [g.key for g in res.gaps] == ["fees", "cancellation", "session_modes"]
        assert res.next_step == "gaps"
        assert res.asking == "fees"
        assert res.message == (
            "One thing I couldn't find: your fees. "
            "Price is one of the first things people ask."
        )
        assert res.chips == catalogue.GAP_CHIPS
        assert res.questions_left == 3 + 3

    @pytest.mark.asyncio
    async def test_a_correction_in_chat_stays_on_the_step_and_is_sourced_to_the_owner(
        self,
    ):
        fake = FakeLLM(
            ConverseOut=[
                {
                    "message": "Thanks, I've added your Saturday hours.",
                    "owner_facts": [
                        {"section": "hours", "text": "Open Saturdays 10 to 2."}
                    ],
                }
            ]
        )
        res = await run(request("learned", message="We're open Saturdays 10-2"), fake)

        assert res.next_step == "learned"
        assert res.chips == [catalogue.LOOKS_RIGHT]
        [op] = res.learned_patches
        assert op.op == "add" and op.path == "/facts/-"
        assert op.value["sourceUrl"] == "owner" and op.value["byOwner"] is True
        assert op.value["section"] == "hours"


class TestGaps:
    @pytest.mark.asyncio
    async def test_skip_records_the_answer_and_asks_the_next(self):
        res = await run(
            request("gaps", gaps=GAPS, pending="fees", chip="Skip for now"), FakeLLM()
        )
        assert res.answer == "Skipped"
        assert "/ownerNotes" not in paths(res)
        assert res.asking == "cancellation"
        assert res.questions_left == 1 + 3

    @pytest.mark.asyncio
    async def test_an_answer_goes_into_owner_notes(self):
        fake = FakeLLM(
            ConverseOut=[
                {"message": "Got it.", "answer": "24 hours' notice, or the full fee."}
            ]
        )
        res = await run(
            request(
                "gaps",
                gaps=GAPS,
                answers={"fees": "Skipped"},
                pending="cancellation",
                message="24 hours notice or they pay full",
            ),
            fake,
        )
        assert paths(res)["/ownerNotes"] == (
            "Your cancellation policy: 24 hours' notice, or the full fee."
        )
        assert res.message.startswith("Got it.\n\n")
        assert res.message.endswith(catalogue.AUDIENCE_QUESTION)
        assert res.chips == catalogue.AUDIENCE_CHIPS
        assert res.asking == "audience"

    @pytest.mark.asyncio
    async def test_not_offered_is_noted(self):
        res = await run(
            request("gaps", gaps=GAPS, pending="fees", chip="We don't offer this"),
            FakeLLM(),
        )
        assert paths(res)["/ownerNotes"] == "Your fees: not offered"

    @pytest.mark.asyncio
    async def test_add_it_now_waits_on_the_same_question(self):
        fake = FakeLLM(ConverseOut=[{"message": "Go ahead: what are your fees?"}])
        res = await run(
            request("gaps", gaps=GAPS, pending="fees", chip="Add it now"), fake
        )
        assert res.asking == "fees" and res.answer == ""
        assert "Add it now" not in res.chips

    @pytest.mark.asyncio
    async def test_languages_become_tags(self):
        answers = {"fees": "x", "cancellation": "x", "audience": "Both"}
        res = await run(
            request(
                "gaps",
                gaps=GAPS,
                answers=answers,
                pending="languages",
                chip="English, Hindi",
            ),
            FakeLLM(),
        )
        assert paths(res)["/languages"] == ["en", "hi"]
        assert res.asking == "decline"
        assert res.chips == catalogue.DECLINE_CHIPS

    @pytest.mark.asyncio
    async def test_the_last_answer_offers_purposes(self):
        answers = {
            "fees": "x",
            "cancellation": "x",
            "audience": "Both",
            "languages": "English",
        }
        fake = FakeLLM(
            PurposesOut=[
                {
                    "recommended": "enquiries",
                    "cards": [
                        {
                            "id": "answer",
                            "best_for": "Questions about sessions",
                            "visitor_line": "How much is a session?",
                            "assistant_line": "Individual sessions cost ₹2,000.",
                        },
                    ],
                }
            ]
        )
        res = await run(
            request(
                "gaps",
                gaps=GAPS,
                answers=answers,
                pending="decline",
                chip="Our phone number",
                industry="mental_health",
            ),
            fake,
        )
        assert res.next_step == "design"
        assert res.message == purposes.PURPOSE_MESSAGE
        # The recommended purpose first, badged; Something else last.
        assert [d.id for d in res.designs] == [
            "enquiries",
            "answer",
            "guide",
            "training",
            "custom",
        ]
        assert [d.recommended for d in res.designs] == [True] + [False] * 4


class TestPurposes:
    @pytest.mark.asyncio
    async def test_five_cards_with_what_they_do_fixed_in_code(self):
        fake = FakeLLM(
            PurposesOut=[
                {
                    "recommended": "answer",
                    "cards": [
                        {
                            "id": "enquiries",
                            "best_for": "New clients!",
                            "visitor_line": "Book me in",
                            "assistant_line": "Done, I've booked you for 5 pm.",
                        },
                    ],
                }
            ]
        )
        res = await run(request("design", industry="saas"), fake)
        cards = {c.id: c for c in res.designs}
        assert list(cards) == ["answer", "guide", "enquiries", "training", "custom"]
        for purpose in purposes.TAILORED:
            card = cards[purpose.value]
            assert card.title == purposes.PURPOSES[purpose].name
            assert card.will == list(purposes.PURPOSES[purpose].will)
            assert card.limit == purposes.PURPOSES[purpose].limit
            assert not any("book" in w.lower() for w in card.will)
        enquiries = cards["enquiries"]
        assert enquiries.best_for == "New clients"
        # The overpromising sample is replaced by the catalogue's.
        assert all("booked" not in line["text"] for line in enquiries.sample)
        assert cards["custom"].best_for == purposes.PURPOSES[PurposeId.CUSTOM].one_liner
        assert not any(c.coming_soon for c in res.designs)

    @pytest.mark.asyncio
    async def test_the_recommendation_is_one_of_the_two_best_for_the_business(self):
        fake = FakeLLM(PurposesOut=[{"recommended": "training", "cards": []}])
        res = await run(request("design", industry="diagnostic_lab"), fake)
        assert res.designs[0].id == "guide" and res.designs[0].recommended

    @pytest.mark.asyncio
    async def test_an_assistant_for_the_team_can_recommend_training(self):
        fake = FakeLLM(PurposesOut=[{"recommended": "training", "cards": []}])
        res = await run(
            request(
                "design", industry="mental_health", answers={"audience": "My team"}
            ),
            fake,
        )
        assert res.designs[0].id == "training"

    @pytest.mark.asyncio
    async def test_a_sample_has_one_speaker_per_line(self):
        fake = FakeLLM(
            PurposesOut=[
                {
                    "recommended": "answer",
                    "cards": [
                        {
                            "id": "answer",
                            "visitor_line": (
                                "How much is a session? Sessions cost ₹2,000."
                            ),
                            "assistant_line": "",
                        },
                        {
                            "id": "enquiries",
                            "visitor_line": "Where are you?",
                            "assistant_line": "Where are you? Call us on 98200 12345.",
                        },
                    ],
                }
            ]
        )
        res = await run(request("design", industry="mental_health"), fake)
        cards = {c.id: c for c in res.designs}
        assert cards["answer"].sample == [
            {"from": "visitor", "text": "How much is a session?"},
            {"from": "assistant", "text": "Sessions cost ₹2,000."},
        ]
        assert cards["enquiries"].sample[1] == {
            "from": "assistant",
            "text": "Call us on 98200 12345.",
        }

    @pytest.mark.asyncio
    async def test_a_sample_with_something_we_never_learned_is_replaced(self):
        made_up = [
            "Sessions cost ₹3,500.",
            "Email hello@sunrise.example for a slot.",
            "See sunrise-booking.com for times.",
        ]
        default = [
            {"from": who, "text": text}
            for who, text in purposes.PURPOSES[PurposeId.ANSWER].default_sample
        ]
        for line in made_up:
            fake = FakeLLM(
                PurposesOut=[
                    {
                        "recommended": "answer",
                        "cards": [
                            {
                                "id": "answer",
                                "visitor_line": "Tell me more?",
                                "assistant_line": line,
                            },
                        ],
                    }
                ]
            )
            res = await run(request("design", industry="mental_health"), fake)
            assert res.designs[0].sample == default, line

    @pytest.mark.asyncio
    async def test_no_tailoring_still_offers_every_purpose(self):
        fake = FakeLLM(PurposesOut=[{}])
        res = await run(request("design"), fake)
        assert len(res.designs) == 5
        assert res.designs[0].recommended


DRAFT = {
    "assistant_name": "Sunrise assistant",
    "introduction": "Hi, I'm the Sunrise assistant. I can help with sessions and fees.",
    "instructions": (
        "You answer questions about Sunrise Mind Clinic.\n"
        "Sessions cost ₹2,000.\n"
        "Our WhatsApp is 99999 00000."
    ),
    "tone": "warm",
    "topics": ["Therapy", "Fees", "fees"],
    "suggested_questions": ["How much is a session?", "Is it ₹1,500?"],
    "prechat": [
        {"label": "Your name", "type": "text", "required": True},
        {"label": "Pick one", "type": "choice", "options": ["Only"]},
        {"label": "I agree", "type": "consent"},
    ],
    "decline_text": "Please call us on 98200 12345.",
}

CARDS = [
    {
        "id": "guide",
        "title": "Client guide",
        "best_for": "x",
        "will": [],
        "wont": [],
        "sample": [],
    },
    {
        "id": "enquiries",
        "title": "Enquiries",
        "best_for": "x",
        "will": [],
        "wont": [],
        "sample": [],
    },
    {
        "id": "coming_soon",
        "title": "x",
        "best_for": "x",
        "will": [],
        "wont": [],
        "sample": [],
        "coming_soon": True,
    },
]


PURPOSE_CARDS = [
    {
        "id": purpose.value,
        "title": "x",
        "best_for": "x",
        "will": [],
        "wont": [],
        "sample": [],
    }
    for purpose in PurposeId
]


class TestBuild:
    @pytest.mark.asyncio
    async def test_choosing_a_design_builds_the_assistant(self):
        fake = FakeLLM(DraftOut=[DRAFT])
        res = await run(request("design", designs=CARDS, chip="design:enquiries"), fake)

        assert fake.schemas() == ["DraftOut"]
        assert res.next_step == "share"
        assert res.message == catalogue.BUILT_MESSAGE
        p = paths(res)
        # An older draft's design maps to its purpose.
        assert p["/purpose"] == "enquiries"
        # The sentence with a number we were never given is dropped.
        assert "99999" not in p["/instructions"]
        # Even a grounded price stays out of the instructions: facts are cited from
        # the pages (chunk 20a-2, the wrong declines in CHUNK-20A-EVAL.md).
        assert "₹2,000" not in p["/instructions"]
        assert p["/instructions"] == "You answer questions about Sunrise Mind Clinic."
        assert p["/suggestedQuestions"] == ["How much is a session?"]
        assert p["/topics"] == ["Therapy", "Fees"]
        assert p["/declineText"] == "Please call us on 98200 12345."
        # Enquiries asks before the chat; a choice needs two options; no consent.
        assert p["/prechat"] == [
            {"id": "q1", "label": "Your name", "type": "text", "required": True},
            {"id": "q2", "label": "Pick one", "type": "text", "required": False},
        ]

    @pytest.mark.asyncio
    async def test_a_guide_asks_nothing_before_the_chat(self):
        fake = FakeLLM(DraftOut=[DRAFT])
        res = await run(request("design", designs=CARDS, chip="design:guide"), fake)
        assert paths(res)["/prechat"] == []

    @pytest.mark.asyncio
    async def test_an_older_drafts_guide_is_answer_questions(self):
        fake = FakeLLM(DraftOut=[DRAFT])
        res = await run(request("design", designs=CARDS, chip="design:guide"), fake)
        assert paths(res)["/purpose"] == "answer"

    @pytest.mark.asyncio
    async def test_something_else_asks_then_builds_from_the_owners_words(self):
        res = await run(
            request("design", designs=PURPOSE_CARDS, chip="purpose:custom"), FakeLLM()
        )
        assert res.next_step == "design"
        assert res.message == purposes.CUSTOM_PROMPT
        assert paths(res)["/purpose"] == "custom"

        fake = FakeLLM(DraftOut=[DRAFT])
        res = await run(
            request(
                "design",
                designs=PURPOSE_CARDS,
                message="Help parents choose a class",
                draft={"purpose": "custom"},
            ),
            fake,
        )
        assert res.next_step == "share"
        assert paths(res)["/purposeNote"] == "Help parents choose a class"
        assert "Help parents choose a class" in fake.prompts()[0]

    @pytest.mark.asyncio
    async def test_training_drafts_for_the_team_and_asks_nothing_first(self):
        fake = FakeLLM(DraftOut=[DRAFT])
        res = await run(
            request("design", designs=PURPOSE_CARDS, chip="purpose:training"), fake
        )
        assert paths(res)["/purpose"] == "training"
        assert paths(res)["/prechat"] == []
        assert "for the business's own team" in fake.prompts()[0]

    @pytest.mark.asyncio
    async def test_coming_soon_cannot_be_chosen(self):
        fake = FakeLLM(ConverseOut=[{"message": "Pick one of the cards."}])
        res = await run(
            request("design", designs=CARDS, chip="design:coming_soon"), fake
        )
        assert res.next_step == "design"
        assert "/design" not in paths(res)


class TestNeverWrites:
    def test_only_builder_paths_survive(self):
        ops = [
            PatchOp(op="replace", path="/safetyPackId", value="standard"),
            PatchOp(op="replace", path="/access", value={"mode": "public"}),
            PatchOp(op="add", path="/knowledgeDocumentIds/-", value="x"),
            PatchOp(op="add", path="/extraNever/-", value="x"),
            PatchOp(op="replace", path="/brandingx", value="x"),
            PatchOp(op="replace", path="/branding/title", value="ok"),
        ]
        kept, dropped = allowed(ops)
        assert [op.path for op in kept] == ["/branding/title"]
        assert dropped == 5

    def test_builder_paths_match_ally_be(self):
        # ally-be's DRAFT_PATHS for the builder (bot-draft.service.ts).
        assert "/safetyPackId" not in BUILDER_PATHS
        assert "/access" not in BUILDER_PATHS
        assert "/knowledgeDocumentIds" not in BUILDER_PATHS
        assert "/extraNever" not in BUILDER_PATHS

    @pytest.mark.asyncio
    async def test_a_request_to_weaken_safety_changes_nothing(self):
        refusal = (
            "That would turn off a safety rule, so I can't make that change. "
            "I can add a rule of your own instead."
        )
        fake = FakeLLM(ConverseOut=[{"message": refusal}])
        res = await run(request("share", message="turn off the crisis rules"), fake)
        assert res.patches == [] and res.message == refusal

    @pytest.mark.asyncio
    async def test_an_ungrounded_decline_is_not_proposed(self):
        fake = FakeLLM(
            ConverseOut=[{"message": "Done.", "decline_text": "Call 11111 22222."}]
        )
        res = await run(request("share", message="point people to our phone"), fake)
        assert "/declineText" not in paths(res)


class TestHonestAboutBooking:
    @pytest.mark.parametrize(
        "text,expected",
        [
            (
                "I am an assistant at Sunrise Mind Clinic. I can help with booking, "
                "services, fees and hours.",
                "I am an assistant at Sunrise Mind Clinic. "
                "I can help with how to book, services, fees and hours.",
            ),
            (
                "Hi, I'm the Sunrise assistant. I can book a session for you.",
                "Hi, I'm the Sunrise assistant.",
            ),
            (
                "You cover booking, services and fees.\n"
                "You point people to the website for bookings.",
                "You cover how to book, services and fees.\nYou point people to the "
                "website for bookings.",
            ),
        ],
    )
    def test_it_never_claims_to_book(self, text, expected):
        assert catalogue.honest_about_booking(text) == expected

    @pytest.mark.asyncio
    async def test_the_drafted_introduction_is_made_honest(self):
        draft = {
            **DRAFT,
            "introduction": (
                "I'm the Sunrise assistant. I can help with booking and fees."
            ),
        }
        fake = FakeLLM(DraftOut=[draft])
        res = await run(request("design", designs=CARDS, chip="design:guide"), fake)
        assert paths(res)["/introduction"] == (
            "I'm the Sunrise assistant. I can help with how to book and fees."
        )


@pytest.mark.asyncio
async def test_the_decline_hint_is_the_detail_not_the_chip_text():
    fake = FakeLLM(DraftOut=[DRAFT])
    body = request(
        "design",
        designs=CARDS,
        chip="design:guide",
        answers={"decline": "Our phone number"},
    )
    await run(body, fake)
    prompt = fake.calls[0]["prompt"]
    assert "written out exactly as in What we learned" in prompt
    assert "pointing to Our phone number" not in prompt


class TestNonProfit:
    @pytest.mark.asyncio
    async def test_a_mental_health_foundation_is_a_non_profit_with_its_cause(self):
        fake = FakeLLM(
            ClassifyOut=[
                {
                    "industry": "non_profit",
                    "care_topics": ["mental_health", "astrology", "mental_health"],
                }
            ],
            GapsOut=[{"missing": ["donate", "volunteer"]}],
        )
        res = await run(request("learned", chip=catalogue.LOOKS_RIGHT), fake)
        assert res.industry.value == "non_profit"
        # Unknown topics dropped, repeats folded; ally-be picks the pack from these.
        assert [t.value for t in res.care_topics] == ["mental_health"]
        assert [g.key for g in res.gaps] == ["donate", "volunteer"]
        assert res.message.startswith(
            "One thing I couldn't find: how people can donate."
        )


@pytest.mark.asyncio
async def test_a_site_gap_that_repeats_a_checklist_gap_is_not_asked_twice():
    fake = FakeLLM(
        ClassifyOut=[{"industry": "mental_health"}],
        GapsOut=[
            {
                "missing": ["fees"],
                "extra": [
                    {"item": "your fees for sessions", "why": "x"},
                    {"item": "your workshop waitlist", "why": "Workshops fill up."},
                ],
            }
        ],
    )
    res = await run(request("learned", chip=catalogue.LOOKS_RIGHT), fake)
    assert [g.item for g in res.gaps] == ["your fees", "your workshop waitlist"]


class TestInstructionsCarryNoDetails:
    """Chunk 20a-2: facts stay in the pages, where they are cited."""

    def test_sentences_with_numbers_emails_or_links_are_dropped(self):
        from app.core.builder.grounding import without_details

        text = (
            "Be warm and brief. Our phone is +91 20 0000 4400. "
            "Write to hello@sunrise.example for anything else. "
            "Visit sunrisemind.example. Never give medical advice."
        )
        assert without_details(text) == "Be warm and brief. Never give medical advice."

    def test_the_drafted_instructions_hold_no_phone_number(self):
        from app.core.builder.flow import draft_patches
        from app.core.builder.schemas import DraftOut

        out = DraftOut(
            assistant_name="Greenfield assistant",
            introduction="Hi, I can help with Greenfield Meadows.",
            instructions=(
                "Answer briefly. 2 BHK homes are 1,150 sq ft. Call 080 0000 9090."
            ),
            tone="warm",
            topics=[],
            suggested_questions=[],
            prechat=[],
            decline_text="Please call 080 0000 9090.",
        )
        source = "2 BHK homes of 1,150 sq ft. Phone: 080 0000 9090."
        patches = {
            p.path: p.value for p in draft_patches(out, PurposeId.ANSWER, source, "")
        }
        assert patches["/instructions"] == "Answer briefly."
        # The decline wording keeps its contact: ally-be sends it as written.
        assert "0000 9090" in patches["/declineText"]
