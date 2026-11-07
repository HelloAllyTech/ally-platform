"""Fact extraction (every fact sourced, or dropped), the copy deck, the prompts and
the BotDraft contract shared with ally-be."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.core.builder import catalogue, tasks
from app.prompts.contracts import PROMPT_CONTRACTS
from app.schemas.builder import BotDraft, ExtractRequest
from tests.core.builder.fakes import TASKS, FakeLLM

ROOT = Path(__file__).resolve().parents[4]
DECK = (ROOT / "docs/agents-v2/ONBOARDING-COPY.md").read_text(encoding="utf-8")
CONTRACT = ROOT / "ally-be/src/bot-draft/test/bot-draft.contract.json"

PAGES = [
    {"url": "https://a.example/", "title": "Home", "text": "We open 9 to 5."},
    {"url": "https://a.example/team", "title": "Team", "text": "Dr Rao, Dr Shah."},
]


class TestExtract:
    @pytest.mark.asyncio
    async def test_facts_without_a_page_from_the_batch_are_dropped_and_counted(self):
        fake = FakeLLM(
            ExtractOut=[
                {
                    "facts": [
                        {"section": "hours", "text": "Open 9 to 5.", "page": 1},
                        {
                            "section": "team",
                            "text": "Dr Rao is a psychiatrist.",
                            "page": 2,
                        },
                        {"section": "team", "text": "Dr Shah.", "page": 2},
                        {"section": "about", "text": "Founded 1990.", "page": 7},
                        {"section": "about", "text": "Unsourced.", "page": 0},
                        {"section": "hours", "text": "open 9 to 5", "page": 1},
                        {"section": "about", "text": "Already known.", "page": 1},
                    ]
                }
            ]
        )
        with patch(f"{TASKS}.generate_structured", fake):
            res = await tasks.extract(
                ExtractRequest(pages=PAGES, known=["Already known."])
            )
        assert res.dropped == 2
        assert [f.text for f in res.facts] == [
            "Open 9 to 5.",
            "Dr Rao is a psychiatrist.",
            "Dr Shah.",
        ]
        assert res.facts[1].source_url == "https://a.example/team"
        assert res.facts[1].source_title == "Team"
        assert res.findings == ["Found your opening hours", "Found 2 team members"]
        assert fake.calls[0]["task"] == "onboarding_extract_facts"
        # Pages are numbered, and the number is what a fact cites.
        assert "[Page 2] Team — https://a.example/team" in fake.calls[0]["prompt"]


class TestLenient:
    @pytest.mark.asyncio
    async def test_an_unknown_section_drops_one_fact_not_the_batch(self):
        fake = FakeLLM(
            ExtractOut=[
                {
                    "facts": [
                        {"section": "press", "text": "In the news.", "page": 1},
                        {"section": "hours", "text": "Open 9 to 5.", "page": 1},
                    ]
                }
            ]
        )
        with patch(f"{TASKS}.generate_structured", fake):
            res = await tasks.extract(ExtractRequest(pages=PAGES))
        assert [f.text for f in res.facts] == ["Open 9 to 5."]
        assert res.dropped == 0

    def test_unknown_labels_fall_back_instead_of_failing(self):
        from app.core.builder.schemas import ClassifyOut, DesignsOut, DraftOut

        assert ClassifyOut.model_validate({"industry": "ngo"}).industry.value == "other"
        assert (
            DesignsOut.model_validate({"designs": [{"id": "booking"}]})
            .designs[0]
            .id.value
            == "guide"
        )
        assert DraftOut.model_validate({"tone": "chirpy"}).tone.value == "warm"


class TestCopy:
    @pytest.mark.parametrize(
        "text",
        [
            catalogue.OPENING_MESSAGE,
            catalogue.DESCRIBE_PROMPT,
            catalogue.READING_DONE,
            catalogue.LOOKS_RIGHT,
            catalogue.GAP_MESSAGE.split(":")[0],
            catalogue.PROGRESS_NOTE,
            catalogue.AUDIENCE_QUESTION,
            catalogue.LANGUAGE_QUESTION,
            catalogue.LANGUAGE_NOTE,
            catalogue.DECLINE_QUESTION,
            catalogue.DESIGN_MESSAGE,
            catalogue.COMING_SOON_BODY,
            catalogue.BUILT_MESSAGE,
            *catalogue.FINDINGS.values(),
        ],
    )
    def test_every_fixed_line_is_in_the_deck(self, text):
        assert text in DECK

    @pytest.mark.parametrize(
        "chips",
        [
            catalogue.OPENING_CHIPS,
            catalogue.GAP_CHIPS,
            catalogue.AUDIENCE_CHIPS,
            catalogue.LANGUAGE_CHIPS,
            catalogue.DECLINE_CHIPS,
        ],
    )
    def test_chips_are_the_decks(self, chips):
        assert " · ".join(chips) in DECK

    def test_design_defaults_use_the_decks_example_titles(self):
        for design in catalogue.DESIGNS.values():
            assert design.default_title in DECK

    def test_every_checklist_item_reads_as_the_decks_pattern(self):
        for checks in catalogue.GAP_CHECKLISTS.values():
            for check in checks:
                assert check.item.startswith(
                    ("your ", "how ", "what ", "whether ", "which ", "the ", "when ")
                )
                assert check.why.endswith(".") and "!" not in check.why


class TestPrompts:
    @pytest.mark.parametrize(
        "code",
        [
            "ally_ai_builder_system",
            "ally_ai_builder_extract",
            "ally_ai_builder_classify",
            "ally_ai_builder_gaps",
            "ally_ai_builder_designs",
            "ally_ai_builder_draft",
        ],
    )
    def test_each_sub_task_has_a_registered_prompt(self, code):
        assert code in PROMPT_CONTRACTS

    def test_the_safety_refusal_is_the_decks(self):
        system = (ROOT / "ally-ai/app/prompts/builder/system.txt").read_text()
        refusal = (
            "That would turn off a safety rule, so I can't make that change. "
            "I can add a rule of your own instead."
        )
        assert refusal in system and refusal in DECK


class TestContract:
    def test_bot_draft_matches_ally_be(self):
        fixture = json.loads(CONTRACT.read_text())
        assert set(BotDraft.model_fields) == set(fixture)
        draft = BotDraft.model_validate(fixture)
        assert draft.model_dump(mode="json", exclude_none=False)["design"] == "guide"
        assert set(type(draft.branding).model_fields) == set(fixture["branding"])
        assert set(type(draft.access).model_fields) == set(fixture["access"])
