"""The builder's steps: which sub-tasks run, the copy it uses, what it proposes, and
what it can never propose."""

from unittest.mock import patch

import pytest

from app.core.builder import catalogue
from app.core.builder.flow import BUILDER_PATHS, allowed, run_step
from app.schemas.builder import BuilderStepRequest, PatchOp
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
    async def test_the_last_answer_offers_designs(self):
        answers = {
            "fees": "x",
            "cancellation": "x",
            "audience": "Both",
            "languages": "English",
        }
        fake = FakeLLM(
            DesignsOut=[
                {
                    "designs": [
                        {
                            "id": "guide",
                            "title": "Client guide",
                            "best_for": "Questions",
                            "visitor_line": "How much is a session?",
                            "assistant_line": "Individual sessions cost ₹2,000.",
                        },
                        {"id": "enquiries", "title": "New client enquiries"},
                    ]
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
        assert res.message == catalogue.DESIGN_MESSAGE
        assert [d.id for d in res.designs] == ["guide", "enquiries", "coming_soon"]


class TestDesigns:
    @pytest.mark.asyncio
    async def test_booking_is_only_ever_coming_soon(self):
        fake = FakeLLM(
            DesignsOut=[
                {
                    "designs": [
                        {"id": "support", "title": "Help centre"},
                        {"id": "support", "title": "Again"},
                        {
                            "id": "guide",
                            "title": "Guide!",
                            "visitor_line": "Book me in",
                            "assistant_line": "Done, I've booked you for 5 pm.",
                        },
                    ]
                }
            ]
        )
        res = await run(request("design", industry="d2c"), fake)
        cards = res.designs
        assert [c.id for c in cards] == ["support", "guide", "coming_soon"]
        assert (
            cards[-1].coming_soon and cards[-1].best_for == catalogue.COMING_SOON_BODY
        )
        guide = cards[1]
        assert guide.title == "Guide"
        # The overpromising sample is replaced by the catalogue's.
        assert all("booked" not in line["text"] for line in guide.sample)
        for card in cards[:-1]:
            assert not any("book" in w.lower() for w in card.will)

    @pytest.mark.asyncio
    async def test_at_least_two_real_choices(self):
        fake = FakeLLM(DesignsOut=[{"designs": []}])
        res = await run(request("design"), fake)
        assert len([c for c in res.designs if not c.coming_soon]) == 2


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


class TestBuild:
    @pytest.mark.asyncio
    async def test_choosing_a_design_builds_the_assistant(self):
        fake = FakeLLM(DraftOut=[DRAFT])
        res = await run(request("design", designs=CARDS, chip="design:enquiries"), fake)

        assert fake.schemas() == ["DraftOut"]
        assert res.next_step == "share"
        assert res.message == catalogue.BUILT_MESSAGE
        p = paths(res)
        assert p["/design"] == "enquiries"
        # The sentence with a number we were never given is dropped.
        assert "99999" not in p["/instructions"]
        assert "₹2,000" in p["/instructions"]
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
